import { SimulatedPaymentProvider, paymentProvider } from '@/adapters/payments'
import type { HeldBalanceProvider } from '@/domain/payments'
import type { ContributionRoute } from '@/domain/contribution'
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
