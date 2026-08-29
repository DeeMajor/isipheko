import { createHmac, randomUUID } from 'node:crypto'

import {
  add,
  fromCents,
  subtract,
  toCents,
  zero,
  type Money,
} from '../../domain/money/index.ts'
import {
  PaymentProviderError,
  type BeneficiaryReference,
  type HeldBalance,
  type HeldBalanceProvider,
  type PayInHandle,
  type PayInReference,
  type PayInRequest,
  type PaymentEvent,
  type ProviderReference,
  type WebhookDelivery,
  type WebhookVerification,
  type WithdrawalHandle,
  type WithdrawalRequest,
  type WithdrawalState,
} from '../../domain/payments/index.ts'

/**
 * The simulator: a {@link HeldBalanceProvider} that holds a balance per
 * beneficiary and releases it only when asked.
 *
 * It exists so the whole held-balance model can be walked locally — money in,
 * money held for an organiser, a withdrawal requested, a withdrawal settled —
 * before any real provider has answered the questions that gate one.
 *
 * ## It POSTs. It does not call anything directly.
 *
 * The single most important property of this file: **whatever a real provider
 * would POST, this POSTs**, over HTTP, to the `notifyUrl` it was given, signed,
 * to be verified by the same {@link verifyWebhook} a real notification goes
 * through. A simulator that reached into a repository would leave the receiver
 * route, the signature check and the handler seam untested — and those are the
 * three things a payments integration actually gets wrong. The shortcut would
 * make the tests green and the production path unexercised.
 *
 * ## Dev and test only
 *
 * `paymentProvider()` refuses to construct this in production, `/dev/payments`
 * 404s there, and so does the receiver at `/api/payments/simulator`. Three
 * separate refusals, because a simulator that credited a real organiser's
 * balance would be the most damaging bug this product could ship.
 *
 * ## What it does not simulate
 *
 * No fees, no reversals, no settlement delay, no partial payment. Each of those
 * is a real behaviour with real copy consequences, and a half-simulated one
 * teaches something false. They arrive when the flow that needs them does.
 *
 * State lives on `globalThis` for the reason `InMemorySmsSender` does: Next
 * reloads modules in development, and two copies of this module would mean the
 * receiver reading one map while the control surface wrote to the other.
 */

export const SIMULATOR_SIGNATURE_HEADER = 'x-isipheko-simulator-signature'

/**
 * Not a secret and not pretending to be one — it is compiled into a dev-only
 * adapter in a public repository. It is here because the *shape* of signature
 * verification is what needs exercising: a receiver that skipped the check
 * because the simulator did not sign would be a receiver whose check nobody had
 * ever seen run.
 */
export const SIMULATOR_SECRET = 'isipheko-simulator-not-a-secret'

interface PendingPayIn {
  readonly reference: PayInReference
  readonly amount: Money
  readonly beneficiary: BeneficiaryReference | null
  readonly notifyUrl: string
  /**
   * Where the payer goes afterwards. A real provider sends them there itself;
   * the control surface stands in for that, which is why it has to know.
   */
  readonly returnUrl: string
  readonly cancelUrl: string
  settled: boolean
}

interface Withdrawal {
  readonly reference: ProviderReference
  readonly beneficiary: BeneficiaryReference
  readonly amount: Money
  readonly notifyUrl: string
  state: WithdrawalState
}

interface Store {
  readonly payIns: Map<PayInReference, PendingPayIn>
  readonly balances: Map<BeneficiaryReference, { held: Money; paidOut: Money }>
  readonly withdrawals: Map<ProviderReference, Withdrawal>
  /** Withdrawal nonces already seen, per architecture §5.5. */
  readonly nonces: Map<string, ProviderReference>
  /** Where a beneficiary's withdrawal notifications go. Set by the first pay-in. */
  readonly notifyUrls: Map<BeneficiaryReference, string>
}

const store: Store = ((globalThis as Record<string, unknown>).__isiphekoPayments ??= {
  payIns: new Map(),
  balances: new Map(),
  withdrawals: new Map(),
  nonces: new Map(),
  notifyUrls: new Map(),
}) as Store

/** The wire format. Amounts are strings because `bigint` is not JSON. */
interface SimulatorNotification {
  readonly type: 'pay-in.completed' | 'pay-in.cancelled' | 'withdrawal.completed'
  readonly reference: string
  readonly providerReference: string
  readonly beneficiary?: string
  readonly amountCents?: string
}

export function simulatorSignature(rawBody: string): string {
  return createHmac('sha256', SIMULATOR_SECRET).update(rawBody, 'utf8').digest('hex')
}

function isNotification(value: unknown): value is SimulatorNotification {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>

  return (
    (candidate.type === 'pay-in.completed' ||
      candidate.type === 'pay-in.cancelled' ||
      candidate.type === 'withdrawal.completed') &&
    typeof candidate.reference === 'string' &&
    typeof candidate.providerReference === 'string'
  )
}

function balanceOf(beneficiary: BeneficiaryReference): { held: Money; paidOut: Money } {
  const existing = store.balances.get(beneficiary)
  if (existing !== undefined) return existing

  const created = { held: zero, paidOut: zero }
  store.balances.set(beneficiary, created)
  return created
}

export interface SimulatedProviderDeps {
  readonly fetch: typeof globalThis.fetch
  readonly newId: () => string
}

// Declared and assigned rather than a constructor parameter property — see
// `PayFastProvider` for why.
export class SimulatedPaymentProvider implements HeldBalanceProvider {
  private readonly deps: SimulatedProviderDeps

  constructor(
    deps: SimulatedProviderDeps = {
      fetch: globalThis.fetch.bind(globalThis),
      newId: randomUUID,
    },
  ) {
    this.deps = deps
  }

  // -------------------------------------------------------------------------
  // PaymentProvider
  // -------------------------------------------------------------------------

  startPayIn(request: PayInRequest): Promise<PayInHandle> {
    store.payIns.set(request.reference, {
      reference: request.reference,
      amount: request.amount,
      beneficiary: request.beneficiary,
      notifyUrl: request.notifyUrl,
      returnUrl: request.returnUrl,
      cancelUrl: request.cancelUrl,
      settled: false,
    })

    if (request.beneficiary !== null) {
      balanceOf(request.beneficiary)
      // A real provider knows where to send its own notifications. The
      // simulator learns it from the first pay-in, which is the only moment it
      // is told anything about the world outside itself.
      store.notifyUrls.set(request.beneficiary, request.notifyUrl)
    }

    return Promise.resolve({
      reference: request.reference,
      providerReference: null,
      redirect: {
        // A `follow` rather than a `post`, so that both branches of
        // `PayInRedirect` have an implementation somebody has run. The URL is
        // the dev control surface, which is where a person clicks "pay".
        kind: 'follow',
        url: `/dev/payments?reference=${encodeURIComponent(request.reference)}`,
      },
    })
  }

  verifyWebhook(delivery: WebhookDelivery): Promise<WebhookVerification> {
    const posted = delivery.headers[SIMULATOR_SIGNATURE_HEADER]

    if (posted === undefined || posted !== simulatorSignature(delivery.rawBody)) {
      return Promise.resolve({ ok: false, reason: 'bad-signature' })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(delivery.rawBody)
    } catch {
      return Promise.resolve({ ok: false, reason: 'unreadable' })
    }

    if (!isNotification(parsed)) {
      return Promise.resolve({ ok: false, reason: 'unreadable' })
    }

    return Promise.resolve(this.toEvent(parsed))
  }

  private toEvent(notification: SimulatorNotification): WebhookVerification {
    if (notification.type === 'pay-in.cancelled') {
      return {
        ok: true,
        event: {
          kind: 'pay-in-cancelled',
          reference: notification.reference,
          providerReference: notification.providerReference,
        },
      }
    }

    const cents = notification.amountCents
    if (cents === undefined || !/^\d+$/.test(cents)) {
      return { ok: false, reason: 'unreadable' }
    }
    const amount = fromCents(BigInt(cents))

    if (notification.type === 'pay-in.completed') {
      const event: PaymentEvent = {
        kind: 'pay-in-completed',
        reference: notification.reference,
        providerReference: notification.providerReference,
        amount,
        // The simulator takes nothing, and says so rather than reporting zero.
        // A fee of R0,00 and "this provider does not tell us" are different
        // facts and the domain type distinguishes them.
        fee: null,
        net: null,
      }
      return { ok: true, event }
    }

    if (notification.beneficiary === undefined) {
      return { ok: false, reason: 'unreadable' }
    }

    return {
      ok: true,
      event: {
        kind: 'withdrawal-completed',
        withdrawal: notification.providerReference,
        beneficiary: notification.beneficiary,
        amount,
      },
    }
  }

  // -------------------------------------------------------------------------
  // HeldBalanceProvider
  // -------------------------------------------------------------------------

  balanceFor(beneficiary: BeneficiaryReference): Promise<HeldBalance | null> {
    const balance = store.balances.get(beneficiary)

    // `null`, not a zero balance. A typo in a beneficiary reference and an
    // organiser nobody has contributed to are different answers, and only one
    // of them should reach a screen as "R0,00".
    return Promise.resolve(balance === undefined ? null : { ...balance })
  }

  // Every refusal below **rejects** rather than throwing synchronously, for the
  // reason `PayFastProvider.startPayIn` does: the signature returns a promise,
  // and a caller reaching for `.catch()` never sees a synchronous throw.
  requestWithdrawal(request: WithdrawalRequest): Promise<WithdrawalHandle> {
    const seen = store.nonces.get(request.nonce)
    if (seen !== undefined) {
      // Architecture §5.5: a retry carrying the same nonce is safe and returns
      // the same withdrawal. It is not an error, and treating it as one is how
      // a timeout becomes a second payout.
      const existing = store.withdrawals.get(seen)
      if (existing !== undefined) {
        return Promise.resolve({ reference: existing.reference, state: existing.state })
      }
      return Promise.reject(new PaymentProviderError('duplicate-nonce'))
    }

    const balance = store.balances.get(request.beneficiary)
    if (balance === undefined) {
      return Promise.reject(new PaymentProviderError('unknown-beneficiary'))
    }
    if (balance.held < request.amount) {
      return Promise.reject(new PaymentProviderError('insufficient-balance'))
    }

    const notifyUrl = store.notifyUrls.get(request.beneficiary)
    if (notifyUrl === undefined) {
      return Promise.reject(new PaymentProviderError('unknown-beneficiary'))
    }

    const reference = `SIMW-${this.deps.newId()}`

    // Held is reduced now, at the request, not at settlement. Otherwise two
    // requests against one balance both pass their check and the second is only
    // caught when it settles — by which time both have been promised.
    balance.held = subtract(balance.held, request.amount)

    const withdrawal: Withdrawal = {
      reference,
      beneficiary: request.beneficiary,
      amount: request.amount,
      notifyUrl,
      // **Settles only on request** — and not even then, immediately. The
      // request creates a pending withdrawal; `completeWithdrawal` is the
      // separate act, because a real settlement is asynchronous and a
      // simulator that completed synchronously would let a caller be written
      // that never handles `pending`.
      state: { kind: 'pending' },
    }

    store.withdrawals.set(reference, withdrawal)
    store.nonces.set(request.nonce, reference)

    return Promise.resolve({ reference, state: withdrawal.state })
  }

  withdrawalState(reference: ProviderReference): Promise<WithdrawalState> {
    const withdrawal = store.withdrawals.get(reference)

    return Promise.resolve(
      withdrawal?.state ?? { kind: 'failed', reason: 'provider-rejected' },
    )
  }

  // -------------------------------------------------------------------------
  // Controls — development and test only. Not on either interface.
  // -------------------------------------------------------------------------

  /** The payer paid. Credits the beneficiary and POSTs the notification. */
  async completePayIn(reference: PayInReference): Promise<void> {
    const payIn = store.payIns.get(reference)
    if (payIn === undefined || payIn.settled) return

    payIn.settled = true

    if (payIn.beneficiary !== null) {
      const balance = balanceOf(payIn.beneficiary)
      balance.held = add(balance.held, payIn.amount)
    }

    await this.post(payIn.notifyUrl, {
      type: 'pay-in.completed',
      reference: payIn.reference,
      providerReference: `SIMP-${this.deps.newId()}`,
      amountCents: toCents(payIn.amount).toString(),
    })
  }

  /** The payer walked away. */
  async cancelPayIn(reference: PayInReference): Promise<void> {
    const payIn = store.payIns.get(reference)
    if (payIn === undefined || payIn.settled) return

    payIn.settled = true

    await this.post(payIn.notifyUrl, {
      type: 'pay-in.cancelled',
      reference: payIn.reference,
      providerReference: `SIMP-${this.deps.newId()}`,
    })
  }

  /** The money reached the beneficiary's bank. */
  async completeWithdrawal(reference: ProviderReference): Promise<void> {
    const withdrawal = store.withdrawals.get(reference)
    if (withdrawal === undefined || withdrawal.state.kind !== 'pending') return

    withdrawal.state = { kind: 'completed' }

    const balance = balanceOf(withdrawal.beneficiary)
    balance.paidOut = add(balance.paidOut, withdrawal.amount)

    await this.post(withdrawal.notifyUrl, {
      type: 'withdrawal.completed',
      reference: withdrawal.reference,
      providerReference: withdrawal.reference,
      beneficiary: withdrawal.beneficiary,
      amountCents: toCents(withdrawal.amount).toString(),
    })
  }

  private async post(url: string, notification: SimulatorNotification): Promise<void> {
    const rawBody = JSON.stringify(notification)

    const response = await this.deps.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIMULATOR_SIGNATURE_HEADER]: simulatorSignature(rawBody),
      },
      body: rawBody,
    })

    if (!response.ok) {
      // A real provider retries. This one reports, loudly, in the only place a
      // developer is looking — a silent drop here would look exactly like a
      // handler that never ran.
      throw new PaymentProviderError('provider-unavailable')
    }
  }
}

/** Development and test only. There is no production caller. */
export function clearPaymentSimulator(): void {
  store.payIns.clear()
  store.balances.clear()
  store.withdrawals.clear()
  store.nonces.clear()
  store.notifyUrls.clear()
}

/** Development and test only — what `/dev/payments` and the E2E suite read. */
export function simulatorState(): {
  payIns: {
    reference: string
    amountCents: string
    settled: boolean
    returnUrl: string
    cancelUrl: string
  }[]
  balances: { beneficiary: string; heldCents: string; paidOutCents: string }[]
  withdrawals: { reference: string; amountCents: string; state: string }[]
} {
  return {
    payIns: [...store.payIns.values()].map((payIn) => ({
      reference: payIn.reference,
      amountCents: toCents(payIn.amount).toString(),
      settled: payIn.settled,
      returnUrl: payIn.returnUrl,
      cancelUrl: payIn.cancelUrl,
    })),
    balances: [...store.balances.entries()].map(([beneficiary, balance]) => ({
      beneficiary,
      heldCents: toCents(balance.held).toString(),
      paidOutCents: toCents(balance.paidOut).toString(),
    })),
    withdrawals: [...store.withdrawals.values()].map((withdrawal) => ({
      reference: withdrawal.reference,
      amountCents: toCents(withdrawal.amount).toString(),
      state: withdrawal.state.kind,
    })),
  }
}
