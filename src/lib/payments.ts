import {
  RecordingEventHandler,
  SimulatedPaymentProvider,
  paymentProvider,
} from '@/adapters/payments'
import { prisma } from '@/db/client'
import { confirmByProvider } from '@/db/repositories/contribution'
import type { PrismaClient } from '@/db/generated/client'
import type { ContributionRoute } from '@/domain/contribution'
import type {
  HeldBalanceProvider,
  PaymentEvent,
  PaymentEventHandler,
} from '@/domain/payments'
import { toCents } from '@/domain/money'
import { parseReference } from '@/domain/reference'
import { env } from '@/lib/env'

/**
 * Where the payment interface meets this application.
 *
 * The same layer as `src/lib/notify.ts` and `src/lib/identity.ts`: the domain
 * declares a contract, `src/adapters/` implements it, and this is the one place
 * allowed to know both which implementation is in use and what the routes are
 * called. Neither the flow nor the domain learns either.
 */

/** The provider this deployment is using. Throws in production (M5-01). */
export function provider(): HeldBalanceProvider {
  return paymentProvider(env.NODE_ENV)
}

/**
 * Where a provider posts its notifications.
 *
 * **This is the one `instanceof` in the payment path, and it is deliberate.**
 * Each provider has a receiver route of its own — PayFast's four security
 * checks are not the simulator's, and a shared route would have to work out who
 * sent a body before it could verify it, which is backwards (M5-01 §12). So the
 * mapping has to exist somewhere, and this file is where knowing both halves is
 * allowed. A `notifyPath` on the domain interface would have put a URL of ours
 * into a contract about money.
 */
export function notifyUrlFor(instance: HeldBalanceProvider): string {
  const path =
    instance instanceof SimulatedPaymentProvider
      ? '/api/payments/simulator'
      : '/api/payments/payfast'

  return `${env.NEXT_PUBLIC_APP_URL}${path}`
}

/**
 * Where the provider sends somebody back to.
 *
 * **The contribution id travels in the return URL**, and that is a divergence
 * from M2-04 §3 worth naming: undo is a capability in a cookie and never in a
 * URL. This is not that. It carries no authority — the done step reads the
 * photo, the visibility and the payment status off the row and changes nothing
 * — and there is no cookie that survives a round trip through a provider on
 * another origin. See docs/decisions.md M5-02 §3.
 */
export function checkoutUrls(
  slug: string,
  route: ContributionRoute,
  contributionId: string,
): { returnUrl: string; cancelUrl: string } {
  const base = `${env.NEXT_PUBLIC_APP_URL}/e/${encodeURIComponent(slug)}/contribute`
  const query = `route=${encodeURIComponent(route)}`

  return {
    returnUrl: `${base}?${query}&step=done&c=${encodeURIComponent(contributionId)}`,
    // Back to the pay step, not to the start. Somebody who changed their mind
    // at the provider has not changed their mind about the amount or their
    // name, and making them type it again is a punishment for hesitating.
    cancelUrl: `${base}?${query}&step=pay&c=${encodeURIComponent(contributionId)}`,
  }
}

/**
 * What a verified notification does to the record.
 *
 * The seam M5-01 left recording and nothing else. It confirms the contribution
 * and appends the ledger entry, in one transaction, through
 * `confirmByProvider` — the same append the organiser's confirmation uses.
 *
 * ## Nothing here decides whether the notification is genuine
 *
 * That happened in the adapter, before this was called: signature, source, and
 * the provider's own confirmation. What is left is the fourth of PayFast's four
 * checks — is this the amount we were expecting — and that is inside
 * `confirmByProvider`, where the record is.
 *
 * ## A cancellation does nothing, deliberately
 *
 * Somebody who backed out at the checkout is somebody who changed their mind,
 * which is the same thing as walking away from the pay step. The row stays
 * pending and the fourteen-day sweep voids it (M2-05 §6). Marking it void here
 * would also make a cancel-then-pay sequence unrecoverable, and providers do
 * not guarantee the order two notifications arrive in.
 *
 * ## A settled withdrawal does nothing yet
 *
 * The debit belongs to a payout, and there are no payout rows to attach it to
 * — `payouts` is empty and nothing writes it (M3-08 §12). Recorded and not
 * acted on until M5-09. Writing a debit against no payout would put a movement
 * on the chain that no record explains.
 */
export class LedgerPaymentHandler implements PaymentEventHandler {
  private readonly db: PrismaClient
  private readonly clock: () => Date

  constructor(db: PrismaClient, clock: () => Date = () => new Date()) {
    this.db = db
    this.clock = clock
  }

  async handle(event: PaymentEvent): Promise<void> {
    if (event.kind !== 'pay-in-completed') return

    const reference = parseReference(event.reference)
    if (reference === null) return

    await confirmByProvider(this.db, {
      prefix: reference.prefix,
      code: reference.code,
      providerReference: event.providerReference,
      amountCents: toCents(event.amount),
      // The application's clock, never the provider's. No event in
      // `src/domain/payments/` carries a time, for exactly this reason.
      now: this.clock(),
    })
  }
}

/** Two handlers, in order, and the first one still runs if the second throws. */
class ChainedHandler implements PaymentEventHandler {
  private readonly handlers: readonly PaymentEventHandler[]

  constructor(...handlers: readonly PaymentEventHandler[]) {
    this.handlers = handlers
  }

  async handle(event: PaymentEvent): Promise<void> {
    for (const handler of this.handlers) await handler.handle(event)
  }
}

/**
 * The handler this deployment uses.
 *
 * **It no longer throws in production**, which is the whole of what M5-03
 * changed: there is now something for a verified notification to do, so the
 * refusal M5-01 put here — a receiver that accepted a real notification and
 * discarded it — no longer describes anything.
 *
 * Outside production the recorder runs **first**, so `/api/payments/simulator`
 * shows what the seam received whether or not the ledger accepted it. An event
 * that arrived and was refused is a thing a developer needs to be able to see.
 */
export function eventHandler(): PaymentEventHandler {
  const ledger = new LedgerPaymentHandler(prisma)

  return env.NODE_ENV === 'production'
    ? ledger
    : new ChainedHandler(new RecordingEventHandler(), ledger)
}
