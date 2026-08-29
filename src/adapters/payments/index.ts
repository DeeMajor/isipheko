// Relative with explicit extensions, like `src/adapters/messaging/index.ts`:
// a scheduled script loading this under plain Node resolves no tsconfig aliases
// (docs/decisions.md M2-01 §8).
import type {
  HeldBalanceProvider,
  PaymentEvent,
  PaymentEventHandler,
  PaymentProvider,
} from '../../domain/payments/index.ts'

import { PayFastProvider, type PayFastConfig } from './payfast-provider.ts'
import { SimulatedPaymentProvider } from './simulated-provider.ts'

export {
  PayFastProvider,
  centsToZar,
  zarToCents,
  type PayFastConfig,
  type PayFastDeps,
} from './payfast-provider.ts'

export {
  PayFastSignatureError,
  payFastFormParameterString,
  payFastItnParameterString,
  payFastPostedSignature,
  payFastSignature,
  payFastSignatureMatches,
  urlencode,
} from './payfast-signature.ts'

export {
  SIMULATOR_SECRET,
  SIMULATOR_SIGNATURE_HEADER,
  SimulatedPaymentProvider,
  clearPaymentSimulator,
  simulatorSignature,
  simulatorState,
  type SimulatedProviderDeps,
} from './simulated-provider.ts'

/**
 * The same posture as `smsSender`, `identityVerifier` and `whatsAppSender`:
 * **no provider is chosen, and production refuses rather than pretending.**
 *
 * The reason is sharper here than for the senders. An unconfigured sender
 * delivers nothing, which is bad. An unconfigured payment provider that fell
 * back to the simulator would credit an organiser's balance with money nobody
 * paid, on a screen she makes promises against — and it would look exactly like
 * a working product until somebody went to the bank.
 *
 * Which provider ends up here is open. PayFast is checkout-only by its own
 * terms and cannot satisfy {@link HeldBalanceProvider} (see
 * `payfast-provider.ts`). Paystack's subaccount model can in principle, and is
 * blocked on three written answers — how a manual settlement is released, the
 * aggregation clause, and the legal opinion. See docs/paystack-analysis.md §6.
 */
export function paymentProvider(nodeEnv: string | undefined): HeldBalanceProvider {
  if (nodeEnv === 'production') {
    throw new Error(
      'No payment provider is configured (docs/paystack-analysis.md §6). Choose one, ' +
        'add the adapter, and wire it here — do not fall back to the simulator, which ' +
        'holds imaginary money and would credit an organiser for a payment nobody made.',
    )
  }

  return new SimulatedPaymentProvider()
}

export interface PayFastEnvironment {
  readonly PAYFAST_MERCHANT_ID?: string | undefined
  readonly PAYFAST_MERCHANT_KEY?: string | undefined
  readonly PAYFAST_PASSPHRASE?: string | undefined
  readonly PAYFAST_MODE?: string | undefined
}

/**
 * Constructed explicitly, never as a fallback, and it names the variable that
 * is missing rather than the fact that something is.
 *
 * The four variables are **optional** in `parseEnv`, not required in
 * production. Requiring them would refuse to start a deployment that is not
 * using PayFast at all, over a provider nothing calls yet. The refusal belongs
 * at the point of use — the same reasoning that keeps `ADMIN_PHONE_NUMBERS`
 * from being a boot failure (M3-07 §2).
 *
 * A passphrase is required rather than optional. PayFast permits an account
 * without one, and without one the signature is a checksum over data the sender
 * chose rather than a shared secret — which is not a security check, it is the
 * appearance of one.
 */
export function payFastProvider(environment: PayFastEnvironment): PaymentProvider {
  const missing = (
    ['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_PASSPHRASE'] as const
  ).filter((name) => (environment[name] ?? '') === '')

  if (missing.length > 0) {
    throw new Error(
      `PayFast is not configured. Set ${missing.join(', ')} — the values are on the ` +
        'merchant dashboard, and the passphrase is under Settings, "Salt Passphrase". ' +
        'They are deliberately optional at boot and required here.',
    )
  }

  const mode = environment.PAYFAST_MODE === 'live' ? 'live' : 'sandbox'

  const config: PayFastConfig = {
    merchantId: environment.PAYFAST_MERCHANT_ID ?? '',
    merchantKey: environment.PAYFAST_MERCHANT_KEY ?? '',
    passphrase: environment.PAYFAST_PASSPHRASE ?? '',
    mode,
  }

  return new PayFastProvider(config)
}

interface RecordedEvents {
  readonly events: PaymentEvent[]
}

const recorded: RecordedEvents = ((
  globalThis as Record<string, unknown>
).__isiphekoPaymentEvents ??= { events: [] }) as RecordedEvents

/**
 * Records what arrived, in order. Development and test only.
 *
 * **It is not the handler**, and has not been one since M5-03 — confirming a
 * contribution and appending the ledger entry is `src/lib/payments.ts`, which
 * is where knowing about the database is allowed. This runs beside it outside
 * production so `/api/payments/simulator` can show what the seam received,
 * including an event the ledger refused.
 *
 * This is what lets the simulator's round trip be asserted end to end without
 * anything downstream existing: the event was signed, posted over HTTP,
 * verified by the receiver, and reached the seam.
 */
export class RecordingEventHandler implements PaymentEventHandler {
  handle(event: PaymentEvent): Promise<void> {
    recorded.events.push(event)
    return Promise.resolve()
  }
}

/** Development and test only. There is no production caller. */
export function recordedPaymentEvents(): readonly PaymentEvent[] {
  return recorded.events
}

export function clearRecordedPaymentEvents(): void {
  recorded.events.length = 0
}
