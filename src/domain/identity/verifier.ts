/**
 * The contract for checking that somebody is who they say they are.
 *
 * Same shape and same reasoning as `PaymentProvider` (§5.1), `SmsSender` and
 * `ObjectStore`: the interface lives in domain/, the implementations live in
 * adapters/, and no domain or application code knows which vendor is behind it.
 *
 * **No vendor has been chosen** (architecture §15 item 5, implementation-plan
 * Part J item 2). Three are on the table and they do not have the same shape:
 *
 *   * VerifyNow and Datanamix return the official Home Affairs photograph, so
 *     the comparison against a live selfie happens *here* — which means a
 *     capture step, an upload, and images we would then be responsible for not
 *     keeping.
 *   * Didit runs liveness and face match inside its own hosted flow, so no
 *     image ever reaches us and the step is a redirect and a result.
 *
 * That difference is a difference in the *flow*, not in the credential, so this
 * interface is built to accept either answer without presupposing one:
 * {@link VerificationStart} is either an inline result or somewhere to send the
 * organiser, and the liveness and face-match findings are flags on the outcome
 * that a provider which does not offer them reports as `null`.
 *
 * **Nothing in this file can carry an image.** There is no field of type bytes,
 * no base64, no URL to a photograph. That is deliberate and structural: an
 * adapter that receives a Home Affairs photograph has nowhere in this type to
 * put it, so it has to drop it on the way in rather than remember to (§7.3).
 *
 * Today's honesty about that criterion is worth stating plainly: **no image
 * reaches storage or logs because no image is ever captured.** If the vendor
 * eventually chosen requires selfie capture, that criterion has to be earned
 * again in the task that builds it — it does not inherit from here.
 */

/** An opaque handle from the provider. Never an ID number, never a person. */
export type VerificationReference = string

export interface VerificationRequest {
  /**
   * Plaintext, and the only place in the product it exists. It lives in this
   * argument for the length of one call and is never returned, stored or
   * logged — what persists is `SHA256(number + pepper)` on the organiser row.
   */
  readonly idNumber: string
  /** What the organiser calls themselves, for the provider to match. */
  readonly claimedName: string
  /**
   * Idempotency, the same posture as a disbursement nonce (§5.5). A retry
   * carrying the same nonce must not become a second billable check.
   */
  readonly nonce: string
}

/**
 * What the provider actually established. `null` means *this provider does not
 * offer that check*, which is different from "it failed" — a provider doing
 * document matching only reports `null` for liveness, and a page must not read
 * that as a person who failed a liveness test.
 */
export interface VerificationChecks {
  readonly identityDocumentMatch: boolean | null
  readonly nameMatch: boolean | null
  readonly liveness: boolean | null
  readonly faceMatch: boolean | null
}

/**
 * Codes, never prose. A provider's own message routinely quotes the value it
 * was given, and these reach the audit log and a query string (rule 8) — the
 * same reason `notifications.last_error_code` holds a code.
 */
export type VerificationFailure =
  | 'no-match'
  | 'name-mismatch'
  | 'liveness-failed'
  | 'face-mismatch'
  | 'deceased'
  | 'provider-rejected'
  | 'provider-unavailable'
  /** Set by us, not by a provider: this identity is already verified elsewhere. */
  | 'duplicate-identity'
  /** Set by us: still pending long after any provider should have answered. */
  | 'timed-out'

export type VerificationOutcome =
  | {
      readonly status: 'pending'
      readonly reference: VerificationReference
    }
  | {
      readonly status: 'verified'
      readonly reference: VerificationReference
      readonly checks: VerificationChecks
    }
  | {
      readonly status: 'failed'
      readonly reference: VerificationReference
      readonly reason: VerificationFailure
      readonly checks: VerificationChecks
    }

/**
 * What starting a check gives back.
 *
 * `inline` covers a provider we call directly — the ordinary case, and the only
 * one built today. `redirect` covers a hosted flow, where the organiser goes to
 * the vendor for liveness and comes back; the result arrives by polling the
 * reference or by a callback writing it, and the polling path works for both.
 */
export type VerificationStart =
  | { readonly kind: 'inline'; readonly outcome: VerificationOutcome }
  | {
      readonly kind: 'redirect'
      readonly reference: VerificationReference
      readonly url: string
    }

export interface IdentityVerifier {
  /** Recorded against the attempt, so a change of vendor is visible in the record. */
  readonly provider: string
  start(request: VerificationRequest): Promise<VerificationStart>
  poll(reference: VerificationReference): Promise<VerificationOutcome>
}

export class IdentityVerifierError extends Error {
  override readonly name = 'IdentityVerifierError'
}
