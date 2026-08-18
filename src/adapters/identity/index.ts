import type { IdentityVerifier } from '../../domain/identity/index.ts'

import { InMemoryIdentityVerifier } from './in-memory-verifier.ts'

export {
  InMemoryIdentityVerifier,
  clearIdentityStore,
  rawVendorResponses,
  type InMemoryVerifierOptions,
} from './in-memory-verifier.ts'

/**
 * The verifier the application uses.
 *
 * **No vendor has been chosen** — architecture §15 item 5, implementation-plan
 * Part J item 2. VerifyNow (~R29.90 a Home Affairs check), Didit (~$0.33 for an
 * ID, liveness and face-match bundle, 500 free a month) and Datanamix are the
 * candidates, and quotes are outstanding.
 *
 * Production **throws**, the same posture as `smsSender` and for the same
 * reason: a verifier that quietly answered "verified" would put a badge on a
 * page that nobody checked, which is the one thing worse than no badge at all
 * (M1-08 §5). Failing at the point of the missing configuration is the only
 * honest option until an adapter exists.
 */
export function identityVerifier(nodeEnv: string | undefined): IdentityVerifier {
  if (nodeEnv === 'production') {
    throw new Error(
      'No identity verification provider is configured (implementation-plan Part J item 2). ' +
        'Choose one, add the adapter, and wire it here — do not fall back to the in-memory ' +
        'verifier, which checks nothing and would mark somebody verified who is not.',
    )
  }

  return new InMemoryIdentityVerifier()
}
