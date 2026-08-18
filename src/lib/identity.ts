import { createHash } from 'node:crypto'

import { identityVerifier } from '@/adapters/identity'
import { CONSENT_KEY, CONSENT_VERSION, consentStatement } from '@/copy/verify'
import { prisma } from '@/db/client'
import { hashIdNumber } from '@/db/encryption'
import { setOrganiserName } from '@/db/repositories/event'
import {
  applyVerificationOutcome,
  claimPollSlot,
  failVerification,
  identityTaken,
  latestVerification,
  organiserIdentityState,
  recordConsent,
  setProviderReference,
  startVerification,
  type VerificationRecord,
} from '@/db/repositories/identity'
import {
  MIN_PROVIDER_POLL_INTERVAL_MS,
  canStartVerification,
  hasTimedOut,
  isRetryable,
  nextPollSeconds,
  parseSaIdNumber,
  shouldPollProvider,
  type SaIdRejection,
  type StartRejection,
  type VerificationFailure,
  type VerificationOutcome,
} from '@/domain/identity'
import { env } from '@/lib/env'
import { recordIdentityEvent, type RequestFingerprint } from '@/lib/audit'

/**
 * The identity check, wired up (M3-01, architecture §7).
 *
 * **This is the only file in the product where an ID number exists in
 * plaintext**, and it exists here as a function argument for the length of one
 * provider call. It is hashed before anything is written, it is never returned,
 * never redirected with, never put in a query string, and never logged. Nothing
 * in this file calls `console`, and `tests/unit/identity-no-pii.test.ts` reads
 * it to make sure that stays true — the same posture, and the same kind of test,
 * as the one-time code in M1-06 §7.
 *
 * The check is never blocked on. Submitting starts it and returns; the pending
 * page reloads itself on a widening interval and each reload asks the provider
 * at most once. A hundred-and-twenty-second answer (§5.6) is a dozen reloads and
 * nothing else.
 */

/**
 * The 32 bytes the environment validated.
 *
 * **Architecture §7.3 puts this in a KMS and it is an environment variable**,
 * the same stopgap M1-02 §5 recorded for the column key and for the same reason
 * — no KMS has been chosen. What makes that survivable is that `hashIdNumber`
 * takes the pepper as an argument, so the seam is already where it needs to be:
 * moving to a KMS is a change to this function and nothing else.
 */
function pepper(): Buffer {
  return Buffer.from(env.ID_NUMBER_PEPPER, 'base64')
}

/**
 * The exact words agreed to, so the stored consent can be read back against the
 * sentence that was on screen rather than against whatever it says today.
 */
function consentHash(): string {
  return createHash('sha256').update(consentStatement, 'utf8').digest('hex')
}

export type VerifyView =
  | {
      readonly kind: 'idle'
      readonly needsName: boolean
      readonly blocked: StartRejection | null
      readonly idError: SaIdRejection | null
    }
  | { readonly kind: 'pending'; readonly refreshSeconds: number }
  | { readonly kind: 'verified'; readonly verifiedAt: Date | null }
  | {
      readonly kind: 'failed'
      readonly reason: VerificationFailure
      readonly retryable: boolean
      readonly needsName: boolean
    }

/**
 * What the page should show, having first chased any answer that is owed.
 *
 * Reading the page is what drives the check forward. That is deliberate: there
 * is no queue in this product (M1-06 §4, M2-08 §1) and a cron would be the wrong
 * shape anyway, because somebody is standing there waiting. The provider is
 * called at most once per {@link MIN_PROVIDER_POLL_INTERVAL_MS}, claimed with a
 * conditional update, so two open tabs cost one call.
 */
export async function verifyView(
  organiserId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<VerifyView> {
  const state = await organiserIdentityState(prisma, { organiserId, now })
  if (state === null)
    return { kind: 'idle', needsName: true, blocked: null, idError: null }

  if (state.status === 'verified') {
    return { kind: 'verified', verifiedAt: state.verifiedAt }
  }

  const latest = await latestVerification(prisma, { organiserId })

  if (latest !== null && latest.status === 'pending') {
    const settled = await advance(latest, now)

    if (settled === null) {
      return {
        kind: 'pending',
        refreshSeconds: nextPollSeconds(now.getTime() - latest.startedAt.getTime()),
      }
    }

    return settled
  }

  if (latest !== null && latest.status === 'failed' && latest.failureReason !== null) {
    return {
      kind: 'failed',
      reason: latest.failureReason,
      retryable: isRetryable(latest.failureReason),
      needsName: state.displayName === null,
    }
  }

  return {
    kind: 'idle',
    needsName: state.displayName === null,
    blocked: null,
    idError: null,
  }
}

/**
 * Chases a pending check once. Returns the view it settled into, or null if it
 * is still pending.
 */
async function advance(
  record: VerificationRecord,
  now: Date,
): Promise<VerifyView | null> {
  if (hasTimedOut(record.startedAt, now)) {
    await failVerification(prisma, { record, reason: 'timed-out', now })
    return { kind: 'failed', reason: 'timed-out', retryable: true, needsName: false }
  }

  if (record.providerReference === null) return null
  if (!shouldPollProvider(record.lastPolledAt, now)) return null

  const claimed = await claimPollSlot(prisma, {
    id: record.id,
    now,
    minIntervalMs: MIN_PROVIDER_POLL_INTERVAL_MS,
  })
  if (!claimed) return null

  let outcome: VerificationOutcome
  try {
    outcome = await identityVerifier(env.NODE_ENV).poll(record.providerReference)
  } catch {
    // Deliberately not logged and deliberately not rethrown with the provider's
    // own error: a vendor's message routinely quotes what it was given, and what
    // it was given here is an ID number. A provider that threw is a provider
    // that did not answer, and the next reload asks again.
    return null
  }

  const applied = await applyVerificationOutcome(prisma, { record, outcome, now })

  if (applied.status === 'unchanged') return null
  if (applied.status === 'verified') return { kind: 'verified', verifiedAt: now }

  // The reason comes from what was written, not from the outcome we carried: a
  // check that passed at the provider and then met the unique index on the
  // identity is stored as a duplicate, and saying anything else would tell
  // somebody Home Affairs did not answer when Home Affairs answered fine.
  return {
    kind: 'failed',
    reason: applied.reason,
    retryable: isRetryable(applied.reason),
    needsName: false,
  }
}

export type StartResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly idError: SaIdRejection }
  | { readonly ok: false; readonly blocked: StartRejection }
  | { readonly ok: false; readonly nameRequired: true }

/**
 * Consent, then a check.
 *
 * The order is the point and it is enforced twice — here, and by the NOT NULL
 * foreign key from an attempt to a consent, which is a different system and can
 * be observed refusing (docs/decisions.md M2-05 §7).
 */
export async function startIdentityCheck({
  organiserId,
  idNumberInput,
  claimedNameInput,
  consented,
  fingerprint,
  now = new Date(),
}: {
  organiserId: string
  /** Plaintext, and it goes no further than this function. */
  idNumberInput: string
  claimedNameInput: string
  consented: boolean
  fingerprint: RequestFingerprint
  now?: Date
}): Promise<StartResult> {
  const state = await organiserIdentityState(prisma, { organiserId, now })
  if (state === null) return { ok: false, blocked: 'already-verified' }

  const decision = canStartVerification({
    status: state.status,
    attemptsInWindow: state.attemptsInWindow,
    hasConsent: consented,
  })

  if (!decision.ok) {
    await recordIdentityEvent({
      action: 'identity.check.refused',
      organiserId,
      fingerprint,
      metadata: { reason: decision.reason, attempts: state.attemptsInWindow },
    })

    return { ok: false, blocked: decision.reason }
  }

  const claimedName =
    claimedNameInput.trim() === '' ? (state.displayName ?? '') : claimedNameInput.trim()
  if (claimedName === '') return { ok: false, nameRequired: true }

  // Everything checkable for free is checked before anything costs R30 (§7.1).
  const parsed = parseSaIdNumber(idNumberInput)
  if (!parsed.ok) return { ok: false, idError: parsed.reason }

  const idNumberHash = hashIdNumber(parsed.value, pepper())

  if (state.displayName === null) {
    await setOrganiserName(prisma, organiserId, claimedName)
  }

  const consent = await recordConsent(prisma, {
    organiserId,
    copyKey: CONSENT_KEY,
    copyVersion: CONSENT_VERSION,
    copyHash: consentHash(),
    ipHash: fingerprint.ipHash,
    userAgentHash: fingerprint.userAgentHash,
  })

  await recordIdentityEvent({
    action: 'identity.consent.captured',
    organiserId,
    fingerprint,
    metadata: { copyKey: CONSENT_KEY, copyVersion: CONSENT_VERSION },
  })

  const verifier = identityVerifier(env.NODE_ENV)

  const record = await startVerification(prisma, {
    organiserId,
    consentId: consent.id,
    provider: verifier.provider,
    providerReference: null,
    idNumberHash,
  })

  // Checked after the attempt exists so that an enumeration attempt leaves a
  // record and counts against the three a day, and before the provider is
  // called so that it costs nothing. What the organiser is told does not confirm
  // that somebody else holds this identity — that would be an oracle.
  if (await identityTaken(prisma, { idNumberHash, organiserId })) {
    await failVerification(prisma, { record, reason: 'duplicate-identity', now })
    await recordIdentityEvent({
      action: 'identity.check.failed',
      organiserId,
      fingerprint,
      metadata: { reason: 'duplicate-identity', provider: verifier.provider },
    })

    return { ok: true }
  }

  await recordIdentityEvent({
    action: 'identity.check.started',
    organiserId,
    fingerprint,
    metadata: { provider: verifier.provider, attempt: state.attemptsInWindow + 1 },
  })

  try {
    // The nonce is the attempt id: a resubmitted form resumes this check rather
    // than becoming a second billable one (§5.5).
    const started = await verifier.start({
      idNumber: parsed.value,
      claimedName,
      nonce: record.id,
    })

    if (started.kind === 'redirect') {
      await setProviderReference(prisma, {
        id: record.id,
        providerReference: started.reference,
      })
      return { ok: true }
    }

    await setProviderReference(prisma, {
      id: record.id,
      providerReference: started.outcome.reference,
    })

    const applied = await applyVerificationOutcome(prisma, {
      record: { ...record, providerReference: started.outcome.reference },
      outcome: started.outcome,
      now,
    })

    if (applied.status !== 'unchanged') {
      await recordIdentityEvent({
        action:
          applied.status === 'verified'
            ? 'identity.check.verified'
            : 'identity.check.failed',
        organiserId,
        fingerprint,
        metadata: {
          provider: verifier.provider,
          ...(applied.status === 'failed' ? { reason: applied.reason } : {}),
        },
      })
    }
  } catch {
    // Same reasoning as the polling path: the provider's own error may quote the
    // number it was given, so it is neither logged nor rethrown. The attempt
    // stays pending and the page will chase it.
    return { ok: true }
  }

  return { ok: true }
}
