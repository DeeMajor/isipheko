import type {
  IdentityVerifier,
  VerificationChecks,
  VerificationOutcome,
  VerificationReference,
  VerificationRequest,
  VerificationStart,
} from '../../domain/identity/index.ts'

/**
 * The development and test verifier. It talks to nobody and costs nothing.
 *
 * **It exists to prove one thing that a real provider will make true and this
 * one can make testable:** a Home Affairs response carries the official
 * photograph and echoes the ID number, and neither may survive the adapter
 * boundary (§7.3). So this implementation deliberately *builds* a response
 * carrying both — a synthetic photograph and the plaintext number it was given
 * — and then maps to a `VerificationOutcome`, which has nowhere to put either.
 *
 * The raw responses are kept in memory so a test can assert the payload really
 * did contain them and that nothing downstream ever did. That store is the
 * `lastSmsTo` pattern (M1-06 §6): dev and test only, never written anywhere,
 * with no production caller.
 *
 * The "photograph" is sixteen bytes of ASCII saying it is not a photograph. A
 * fixture that was a real image would be a real image sitting in the repository
 * of a product whose rule is that it never holds one.
 *
 * ## Sandbox conventions
 *
 * Behaviour is keyed on digits 7–10 of the ID number — the sequence block,
 * which is free to choose and does not disturb the check digit. Stitch does the
 * same thing with account numbers ending in zero (§12), and the reason is the
 * same: a fixture should say what it is testing.
 *
 * | sequence | what happens                                            |
 * | -------- | ------------------------------------------------------- |
 * | `0000`   | verified on the first poll                              |
 * | `0001`   | pending past 120 seconds, then verified                 |
 * | `0002`   | failed — `no-match`                                     |
 * | `0003`   | failed — `name-mismatch`                                |
 * | `0004`   | a hosted redirect flow, then verified                   |
 * | `0005`   | the provider is unavailable                             |
 * | anything | verified after one pending poll — the ordinary case     |
 */

/** Long enough that the 120-second case in §5.6 is genuinely exercised. */
const SLOW_PENDING_MS = 130_000

interface VendorResponse {
  readonly reference: string
  readonly status: 'PENDING' | 'VERIFIED' | 'FAILED'
  /**
   * Present exactly as a real Home Affairs response would have it, and dropped
   * exactly as a real adapter must.
   */
  readonly photoBase64: string | null
  /** Echoed back by the provider, as VerifyNow and Didit both do. */
  readonly idNumber: string
  readonly reason: string | null
  readonly matches: {
    readonly identityDocument: boolean
    readonly name: boolean
  }
}

interface PendingCheck {
  readonly idNumber: string
  readonly claimedName: string
  readonly startedAt: number
  readonly sequence: string
  polls: number
}

interface VerifierStore {
  readonly checks: Map<VerificationReference, PendingCheck>
  readonly raw: VendorResponse[]
}

const store: VerifierStore = ((
  globalThis as Record<string, unknown>
).__isiphekoIdentity ??= {
  checks: new Map<VerificationReference, PendingCheck>(),
  raw: [],
}) as VerifierStore

const SYNTHETIC_PHOTO = Buffer.from('not-a-real-photo').toString('base64')

function sequenceOf(idNumber: string): string {
  return idNumber.slice(6, 10)
}

/**
 * Everything the adapter is allowed to keep. Note what is *not* read: the
 * photograph and the echoed ID number are both on `response` and neither
 * appears below, which is the whole point of this function existing separately
 * from the response that feeds it.
 */
function toOutcome(response: VendorResponse): VerificationOutcome {
  const checks: VerificationChecks = {
    identityDocumentMatch: response.matches.identityDocument,
    nameMatch: response.matches.name,
    // This provider offers neither. `null` says "not checked", which a page
    // must not read as a person who failed a liveness test.
    liveness: null,
    faceMatch: null,
  }

  if (response.status === 'PENDING') {
    return { status: 'pending', reference: response.reference }
  }

  if (response.status === 'VERIFIED') {
    return { status: 'verified', reference: response.reference, checks }
  }

  return {
    status: 'failed',
    reference: response.reference,
    reason: response.reason === 'name-mismatch' ? 'name-mismatch' : 'no-match',
    checks,
  }
}

export interface InMemoryVerifierOptions {
  /** Injectable so a 130-second pending costs a test no time at all. */
  readonly now?: () => number
}

export class InMemoryIdentityVerifier implements IdentityVerifier {
  readonly provider = 'in-memory'

  private readonly now: () => number

  constructor(options: InMemoryVerifierOptions = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  start(request: VerificationRequest): Promise<VerificationStart> {
    const sequence = sequenceOf(request.idNumber)

    // The nonce is the reference, which is what idempotency buys (§5.5): a
    // retried submission carrying the same nonce resumes the same check rather
    // than starting a second billable one.
    const reference = `in-memory:${request.nonce}`

    if (!store.checks.has(reference)) {
      store.checks.set(reference, {
        idNumber: request.idNumber,
        claimedName: request.claimedName,
        startedAt: this.now(),
        sequence,
        polls: 0,
      })
    }

    if (sequence === '0005') {
      return Promise.resolve({
        kind: 'inline',
        outcome: {
          status: 'failed',
          reference,
          reason: 'provider-unavailable',
          checks: {
            identityDocumentMatch: null,
            nameMatch: null,
            liveness: null,
            faceMatch: null,
          },
        },
      })
    }

    // The hosted-flow shape, unused today and here so that choosing a vendor
    // like Didit is an adapter rather than a change to the flow.
    if (sequence === '0004') {
      return Promise.resolve({
        kind: 'redirect',
        reference,
        url: `https://identity.example/hosted/${encodeURIComponent(reference)}`,
      })
    }

    if (sequence === '0000') {
      return Promise.resolve({ kind: 'inline', outcome: this.answer(reference) })
    }

    return Promise.resolve({
      kind: 'inline',
      outcome: { status: 'pending', reference },
    })
  }

  poll(reference: VerificationReference): Promise<VerificationOutcome> {
    return Promise.resolve(this.answer(reference))
  }

  private answer(reference: VerificationReference): VerificationOutcome {
    const check = store.checks.get(reference)

    if (check === undefined) {
      return {
        status: 'failed',
        reference,
        reason: 'provider-rejected',
        checks: {
          identityDocumentMatch: null,
          nameMatch: null,
          liveness: null,
          faceMatch: null,
        },
      }
    }

    check.polls += 1

    const response: VendorResponse = {
      reference,
      status: this.statusFor(check),
      // A real Home Affairs response carries the photograph on every answer.
      photoBase64: SYNTHETIC_PHOTO,
      idNumber: check.idNumber,
      reason: check.sequence === '0003' ? 'name-mismatch' : null,
      matches: {
        identityDocument: check.sequence !== '0002',
        name: check.sequence !== '0003',
      },
    }

    store.raw.push(response)

    return toOutcome(response)
  }

  private statusFor(check: PendingCheck): VendorResponse['status'] {
    if (check.sequence === '0002' || check.sequence === '0003') return 'FAILED'

    if (check.sequence === '0001') {
      return this.now() - check.startedAt >= SLOW_PENDING_MS ? 'VERIFIED' : 'PENDING'
    }

    if (check.sequence === '0000') return 'VERIFIED'

    // The ordinary case: one pending answer, then a result. A verifier that
    // answered instantly would let the polling path ship untested.
    return check.polls > 1 ? 'VERIFIED' : 'PENDING'
  }
}

/**
 * The raw provider responses, for tests only. There is no production caller and
 * no route reads it.
 *
 * It exists so `tests/unit/identity-no-pii.test.ts` can assert the thing that
 * matters: the payload really did carry a photograph and a plaintext ID number,
 * and neither reached the outcome, the database, the audit log or a log line.
 */
export function rawVendorResponses(): readonly VendorResponse[] {
  return store.raw
}

export function clearIdentityStore(): void {
  store.checks.clear()
  store.raw.length = 0
}
