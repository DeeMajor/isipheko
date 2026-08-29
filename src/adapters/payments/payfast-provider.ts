import { lookup } from 'node:dns/promises'

import { fromCents, type Money, toCents } from '../../domain/money/index.ts'
import {
  PaymentProviderError,
  type PayInHandle,
  type PayInRequest,
  type PaymentEvent,
  type PaymentProvider,
  type WebhookDelivery,
  type WebhookVerification,
} from '../../domain/payments/index.ts'

import {
  payFastFormParameterString,
  payFastSignature,
  payFastSignatureMatches,
} from './payfast-signature.ts'

/**
 * PayFast — **checkout only**, and that is a contractual boundary rather than a
 * scoping decision.
 *
 * PayFast's General Terms and Conditions 5.17 says, verbatim:
 *
 * > (v) an aggregated Payment Transaction is not made for multiple suppliers;
 * >
 * > (vi) a Payment Transaction is not submitted for or on behalf of third party
 * > (i.e. other business entities or an entity that has not signed an Affiliate
 * > form)
 *
 * So this adapter takes money into **one** merchant account — ours — and does
 * nothing else. It implements {@link PaymentProvider} and deliberately not
 * `HeldBalanceProvider`: there is no balance held for an organiser here, no
 * withdrawal, and no beneficiary that is not us. {@link startPayIn} refuses a
 * request naming one rather than quietly ignoring it, because a silent drop
 * would send a contributor's money to the wrong account.
 *
 * PayFast's Split Payments product would settle a portion to a **second PayFast
 * merchant**, which means every organiser registering as a merchant — a
 * grieving family filling in a merchant application before anyone can
 * contribute. It is not a way around (v) and (vi); it is the shape those
 * clauses describe. See docs/paystack-analysis.md.
 *
 * ## What it cannot do about payment methods
 *
 * The task asks for card and instant EFT. PayFast's `payment_method` field
 * selects exactly **one** method and hides the rest, so "these two and no
 * others" is not expressible in the request. The field is therefore left unset,
 * which shows every method the merchant account has enabled, and **which
 * methods are enabled is an account setting rather than a line of code**.
 * Saying so here rather than sending `payment_method=cc` and calling it done:
 * that would ship a checkout where nobody could pay by EFT.
 *
 * ## The four security checks
 *
 * PayFast documents four, and three of them are here. The fourth — comparing
 * the amount to what we expected — cannot be, because it needs the record the
 * notification is about, and looking that up would put a repository behind the
 * payment interface. `amountMatches` in `src/domain/payments/provider.ts` is
 * that check, done by the handler where the record is.
 */

export interface PayFastConfig {
  readonly merchantId: string
  readonly merchantKey: string
  readonly passphrase: string
  readonly mode: 'sandbox' | 'live'
}

const HOSTS: Readonly<Record<PayFastConfig['mode'], string>> = {
  sandbox: 'sandbox.payfast.co.za',
  live: 'www.payfast.co.za',
}

/**
 * Every host PayFast posts notifications from, per their documentation. The
 * live host is not the only one: `w1w` and `w2w` are their notification senders
 * and a check against `www` alone rejects real payments.
 */
const NOTIFYING_HOSTS: readonly string[] = [
  'www.payfast.co.za',
  'w1w.payfast.co.za',
  'w2w.payfast.co.za',
  'sandbox.payfast.co.za',
]

/**
 * PayFast also publishes fixed ranges. They are not used for the check — their
 * documented method is a DNS lookup, and a hard-coded range goes stale silently
 * on the day they add capacity — but they are recorded so that somebody
 * debugging a rejected notification has something to compare against:
 *
 *   197.97.145.144/28 · 41.74.179.192/27 · 102.216.36.0/28 ·
 *   102.216.36.128/28 · 144.126.193.139
 */

/** Five minutes. Long enough to spare the resolver, short enough to follow a change. */
const HOST_CACHE_MS = 5 * 60 * 1000

interface HostCache {
  readonly addresses: ReadonlySet<string>
  readonly at: number
}

export interface PayFastDeps {
  /** Injected so the postback can be exercised without reaching PayFast. */
  readonly fetch: typeof globalThis.fetch
  /** Injected so the host check can be exercised without a resolver. */
  readonly resolveHost: (host: string) => Promise<readonly string[]>
  /** Application time, never a wall clock read inside the adapter. */
  readonly now: () => number
}

async function resolveWithDns(host: string): Promise<readonly string[]> {
  const results = await lookup(host, { all: true })
  return results.map((result) => result.address)
}

/**
 * `"200.00"` to 20000 cents, without a float ever existing (CLAUDE.md rule 7).
 *
 * PayFast sends decimals as strings in the body. `parseFloat` on `"195.40"` is
 * the ordinary way to do this and is exactly what rule 7 exists to prevent, so
 * the string is split and reassembled as `bigint`.
 *
 * `amount_fee` arrives negative — it is a deduction. Money is a magnitude
 * (M1-03), so the sign is dropped here and the direction is carried by which
 * field it came from.
 */
export function zarToCents(decimal: string): Money | null {
  const trimmed = decimal.trim().replace(/^-/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null

  const [whole = '0', fraction = ''] = trimmed.split('.')

  try {
    return fromCents(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')))
  } catch {
    return null
  }
}

/** Cents to the `"200.00"` PayFast wants. Two places, always, no thousands separator. */
export function centsToZar(amount: Money): string {
  const cents = toCents(amount)
  return `${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, '0')}`
}

function parseBody(rawBody: string): Map<string, string> {
  const fields = new Map<string, string>()

  for (const pair of rawBody.split('&')) {
    if (pair === '') continue
    const index = pair.indexOf('=')
    const name = index === -1 ? pair : pair.slice(0, index)
    const value = index === -1 ? '' : pair.slice(index + 1)
    fields.set(decodeURIComponent(name), decodeURIComponent(value.replace(/\+/g, ' ')))
  }

  return fields
}

// Fields are declared and assigned rather than written as constructor
// parameter properties: `scripts/` loads adapters under Node's strip-only type
// removal, which does not support them. Same family of constraint as M2-01 §8's
// relative imports with explicit extensions.
export class PayFastProvider implements PaymentProvider {
  private hostCache: HostCache | null = null
  private readonly config: PayFastConfig
  private readonly deps: PayFastDeps

  constructor(
    config: PayFastConfig,
    deps: PayFastDeps = {
      fetch: globalThis.fetch.bind(globalThis),
      resolveHost: resolveWithDns,
      now: () => Date.now(),
    },
  ) {
    this.config = config
    this.deps = deps

    if (
      config.merchantId === '' ||
      config.merchantKey === '' ||
      config.passphrase === ''
    ) {
      throw new PaymentProviderError('not-configured')
    }
  }

  startPayIn(request: PayInRequest): Promise<PayInHandle> {
    if (request.beneficiary !== null) {
      // Refused rather than ignored. Silently dropping it would settle a
      // contribution into our own account while the caller believed it had
      // gone to the family — General Terms 5.17(vi), and the worst possible
      // way to breach it.
      //
      // **Rejected, not thrown.** The signature returns a promise, and a caller
      // reaching for `.catch()` would miss a synchronous throw entirely — on
      // the one path where being missed means money reaching the wrong account.
      return Promise.reject(new PaymentProviderError('beneficiary-not-supported'))
    }

    // PayFast's documented attribute order. **Not alphabetical** — their API
    // signature format is, and using that order here produces a signature their
    // checkout rejects.
    const fields: (readonly [string, string])[] = [
      ['merchant_id', this.config.merchantId],
      ['merchant_key', this.config.merchantKey],
      ['return_url', request.returnUrl],
      ['cancel_url', request.cancelUrl],
      ['notify_url', request.notifyUrl],
      ['m_payment_id', request.reference],
      ['amount', centsToZar(request.amount)],
      ['item_name', request.description],
    ]

    const signature = payFastSignature(
      payFastFormParameterString(fields),
      this.config.passphrase,
    )

    return Promise.resolve({
      reference: request.reference,
      // PayFast issues `pf_payment_id` only once somebody has actually paid.
      // A placeholder here would be a value in a column that names nothing.
      providerReference: null,
      redirect: {
        kind: 'post',
        url: `https://${HOSTS[this.config.mode]}/eng/process`,
        fields: [...fields, ['signature', signature] as const],
      },
    })
  }

  async verifyWebhook(delivery: WebhookDelivery): Promise<WebhookVerification> {
    // 1. The signature.
    const signature = payFastSignatureMatches(delivery.rawBody, this.config.passphrase)
    if (signature !== 'ok') return { ok: false, reason: signature }

    // 2. The source. Checked before the callback so that a flood of forged
    //    notifications cannot make us call PayFast once per forgery.
    if (!(await this.fromPayFast(delivery.sourceAddress))) {
      return { ok: false, reason: 'untrusted-source' }
    }

    // 3. The amount is the caller's — see the class note and `amountMatches`.

    // 4. PayFast's own confirmation. The whole body goes back as it arrived.
    if (!(await this.confirmedByPayFast(delivery.rawBody))) {
      return { ok: false, reason: 'not-confirmed' }
    }

    return this.toEvent(parseBody(delivery.rawBody))
  }

  private toEvent(fields: Map<string, string>): WebhookVerification {
    const reference = fields.get('m_payment_id') ?? ''
    const providerReference = fields.get('pf_payment_id') ?? ''
    const status = fields.get('payment_status') ?? ''

    if (reference === '' || providerReference === '') {
      return { ok: false, reason: 'unreadable' }
    }

    if (status === 'CANCELLED') {
      return {
        ok: true,
        event: { kind: 'pay-in-cancelled', reference, providerReference },
      }
    }

    // PayFast documents exactly two statuses. Anything else is a notification
    // about something we have not decided how to treat, which is not the same
    // as one we failed to read.
    if (status !== 'COMPLETE') return { ok: false, reason: 'unsupported-event' }

    const amount = zarToCents(fields.get('amount_gross') ?? '')
    if (amount === null) return { ok: false, reason: 'unreadable' }

    const event: PaymentEvent = {
      kind: 'pay-in-completed',
      reference,
      providerReference,
      amount,
      fee: zarToCents(fields.get('amount_fee') ?? ''),
      net: zarToCents(fields.get('amount_net') ?? ''),
    }

    return { ok: true, event }
  }

  private async fromPayFast(sourceAddress: string | null): Promise<boolean> {
    if (sourceAddress === null) return false

    const cache = this.hostCache
    if (cache !== null && this.deps.now() - cache.at < HOST_CACHE_MS) {
      return cache.addresses.has(sourceAddress)
    }

    const addresses = new Set<string>()

    for (const host of NOTIFYING_HOSTS) {
      try {
        for (const address of await this.deps.resolveHost(host)) addresses.add(address)
      } catch {
        // One host failing to resolve must not reject a notification the other
        // three would have accepted. A total failure leaves the set empty,
        // which rejects — the correct direction to fail in.
      }
    }

    this.hostCache = { addresses, at: this.deps.now() }
    return addresses.has(sourceAddress)
  }

  private async confirmedByPayFast(rawBody: string): Promise<boolean> {
    try {
      const response = await this.deps.fetch(
        `https://${HOSTS[this.config.mode]}/eng/query/validate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: rawBody,
        },
      )

      if (!response.ok) return false

      return (await response.text()).trim().startsWith('VALID')
    } catch {
      // Unreachable is not the same as invalid, but it has to be treated as
      // one: acting on an unconfirmed notification is the failure this check
      // exists to prevent. PayFast retries for hours, so a transient outage
      // costs a delay rather than a contribution.
      return false
    }
  }
}
