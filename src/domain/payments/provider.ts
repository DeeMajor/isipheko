import type { Money } from '../money/index.ts'

/**
 * The contract a payment provider satisfies. Architecture §5.1, as built.
 *
 * Same shape and same reasoning as `SmsSender`, `IdentityVerifier` and
 * `ObjectStore`: the interface lives in domain/, the implementations live in
 * adapters/, and no domain, application or database code knows which provider
 * is behind it (CLAUDE.md rule 10).
 *
 * ## Two interfaces, and the split is load-bearing
 *
 * {@link PaymentProvider} takes money in and tells us it arrived. That is all a
 * gateway does, and it is all some gateways are permitted to do.
 *
 * {@link HeldBalanceProvider} adds a balance held per beneficiary and a
 * withdrawal against it — the hosted model, where money reaches an organiser's
 * own bank account and we are not in the path.
 *
 * **The reason there are two rather than one is a contractual constraint, and
 * it is enforced here so that nobody has to remember it.** PayFast's General
 * Terms and Conditions 5.17 says, verbatim:
 *
 * > (v) an aggregated Payment Transaction is not made for multiple suppliers;
 * >
 * > (vi) a Payment Transaction is not submitted for or on behalf of third party
 * > (i.e. other business entities or an entity that has not signed an Affiliate
 * > form)
 *
 * A held balance belonging to somebody who is not us is exactly what (vi)
 * forbids, so `PayFastProvider` implements the narrow interface and cannot be
 * assigned where the wide one is required. **That is a compile error, not a
 * comment.** The alternative — one interface with methods that throw — moves a
 * fact known at build time into a runtime surprise on a payments path, which is
 * the worst place in the product to discover anything. See docs/decisions.md
 * M5-01 §1.
 *
 * ## Nothing here can carry a payer
 *
 * There is no name, no phone number, no email address and no message anywhere
 * in {@link PayInRequest}. That is structural rather than a convention: an
 * adapter has nowhere to put a contributor's details, so it cannot forward them
 * without changing this file first.
 *
 * A contributor never authenticates and is never asked for an address
 * (CLAUDE.md rule 4, M2-05 §8). Where a vendor demands one anyway — Paystack
 * requires `email` on its initialize call — the adapter derives an opaque,
 * undeliverable address from {@link PayInRequest.reference} and never sees
 * anything the contributor typed.
 *
 * ## No provider timestamps
 *
 * No event in this file carries a time. Every rule in this product is computed
 * against an application-supplied `now` — the ledger hash covers `created_at`
 * (M2-01 §3), and the digest cap and the 72-hour hold read columns the
 * application stamped (M2-08b, M3-08 §3). A provider's clock would make those
 * rules depend on somebody else's, and untestable at a fixed instant. The
 * handler stamps the time it wrote the row, which is the fact the ledger is
 * actually asserting.
 *
 * Pure: types and contracts. No I/O, no framework, no vendor vocabulary.
 */

/**
 * A provider's own identifier for something. Opaque — never parsed, never
 * pattern-matched, never shown to anybody.
 */
export type ProviderReference = string

/**
 * Our identifier for one pay-in, unique across the product, and the string that
 * appears on a bank statement. Today that is M2-02's `MTH-4K7B2X`.
 *
 * It is ours rather than the provider's because it is issued before the payer
 * has decided anything, and because it has to reconcile against a record that
 * exists whether or not the payment ever happens.
 */
export type PayInReference = string

/**
 * A beneficiary as the provider knows it. Opaque, and created outside this
 * interface — onboarding an organiser's bank account is its own task with its
 * own consent, evidence and review.
 */
export type BeneficiaryReference = string

/**
 * Carries a code and never an amount, a reference or a provider's own prose.
 *
 * Same discipline as {@link MoneyError} and `ColumnCipherError`: these messages
 * reach logs, a provider's message routinely quotes the value it was handed,
 * and amounts are hidden by default on a bereavement event (CLAUDE.md rule 8).
 */
export class PaymentProviderError extends Error {
  override readonly name = 'PaymentProviderError'

  // Declared and assigned rather than a constructor parameter property:
  // `scripts/` loads this under Node's strip-only type removal, which does not
  // support them. Same family of constraint as M2-01 §8's relative imports.
  readonly code: PaymentProviderErrorCode

  constructor(code: PaymentProviderErrorCode) {
    super(`Payment provider: ${code}`)
    this.code = code
  }
}

export type PaymentProviderErrorCode =
  | 'not-configured'
  | 'provider-unavailable'
  | 'provider-rejected'
  | 'unknown-beneficiary'
  /** This provider may not pay anybody but us — see `PayFastProvider`. */
  | 'beneficiary-not-supported'
  | 'insufficient-balance'
  | 'duplicate-nonce'

// ---------------------------------------------------------------------------
// Taking money in
// ---------------------------------------------------------------------------

export interface PayInRequest {
  readonly reference: PayInReference
  readonly amount: Money
  /**
   * What the payer sees named on the provider's page and on their statement.
   * The umcimbi, not the contributor and not the amount.
   */
  readonly description: string
  /**
   * Where the money is destined. `null` means the provider's single merchant
   * account — ours — which is the only thing a {@link PaymentProvider} that is
   * not a {@link HeldBalanceProvider} can be asked for.
   */
  readonly beneficiary: BeneficiaryReference | null
  /** Absolute URLs. The provider sends the payer back to one of these. */
  readonly returnUrl: string
  readonly cancelUrl: string
  /** Absolute URL the provider posts its notification to. */
  readonly notifyUrl: string
}

/**
 * Where to send the payer, and how.
 *
 * Two shapes because providers genuinely differ: Paystack answers with a URL to
 * follow, PayFast wants a form posted to it with every field it was given plus
 * a signature over them. Modelling only the first would mean the PayFast
 * adapter inventing somewhere to keep the fields.
 *
 * **`fields` is an ordered list of pairs, not an object.** PayFast's signature
 * is computed over the fields in the order they appear, so an object — whose
 * key order is a property of how it was built rather than a stated one — would
 * make a correct signature an accident.
 */
export type PayInRedirect =
  | { readonly kind: 'follow'; readonly url: string }
  | {
      readonly kind: 'post'
      readonly url: string
      readonly fields: readonly (readonly [string, string])[]
    }

export interface PayInHandle {
  readonly reference: PayInReference
  /**
   * `null` where the provider has not created anything yet. PayFast issues
   * `pf_payment_id` only once the payer has actually paid, so there is nothing
   * to record at this point and a placeholder would be a lie in a column.
   */
  readonly providerReference: ProviderReference | null
  readonly redirect: PayInRedirect
}

// ---------------------------------------------------------------------------
// What a provider tells us afterwards
// ---------------------------------------------------------------------------

/**
 * A notification as it arrived, before anybody has decided it is genuine.
 *
 * The **raw** body, not a parsed one: every signature scheme in use signs the
 * bytes, and a body that has been through a parser and back is a different
 * string. Parsing before verifying is also the order that lets a forged payload
 * reach a parser at all.
 */
export interface WebhookDelivery {
  readonly rawBody: string
  readonly headers: Readonly<Record<string, string>>
  /** The connecting address, where the runtime can tell us. */
  readonly sourceAddress: string | null
}

export type WebhookRejection =
  /** The signature did not verify. */
  | 'bad-signature'
  /** The notification did not come from the provider. */
  | 'untrusted-source'
  /** The provider itself did not confirm the notification on a callback. */
  | 'not-confirmed'
  /** The body was not in the shape the provider documents. */
  | 'unreadable'
  /** A well-formed notification about something this provider does not do. */
  | 'unsupported-event'

export type WebhookVerification =
  | { readonly ok: true; readonly event: PaymentEvent }
  | { readonly ok: false; readonly reason: WebhookRejection }

/**
 * What a provider can tell us happened. A closed set, deliberately — a provider
 * with an event we have no member for is a provider whose event we have not
 * decided how to treat, and the honest answer to that is `unsupported-event`
 * rather than a partially-handled union.
 */
export type PaymentEvent =
  | {
      readonly kind: 'pay-in-completed'
      readonly reference: PayInReference
      readonly providerReference: ProviderReference
      /**
       * What the payer paid. **Compare this against what was expected before
       * acting on it** — see {@link amountMatches}.
       */
      readonly amount: Money
      /** What the provider took. `null` where it does not say. */
      readonly fee: Money | null
      /** What reached the beneficiary. `null` where the provider does not say. */
      readonly net: Money | null
    }
  | {
      readonly kind: 'pay-in-cancelled'
      readonly reference: PayInReference
      readonly providerReference: ProviderReference
    }
  | {
      readonly kind: 'withdrawal-completed'
      readonly withdrawal: ProviderReference
      readonly beneficiary: BeneficiaryReference
      readonly amount: Money
    }

/**
 * Whether a notification is about the amount we were expecting.
 *
 * **This check belongs to the caller and cannot be done by the adapter**, and
 * the reason is an ordering one worth stating: you have to verify and parse a
 * notification before you know which record it is about, and you have to know
 * which record it is about before you know what to compare the amount to. An
 * adapter given that responsibility would need to read the database, which
 * would put a repository behind the payment interface.
 *
 * So of PayFast's four documented security checks, the adapter does three —
 * signature, source, and the confirmation callback — and this is the fourth,
 * done where the record is. See docs/decisions.md M5-01 §5.
 *
 * Exact equality, not a tolerance. PayFast's own reference implementation
 * allows a cent of drift because it compares floating-point decimals; this
 * product has no floats anywhere (CLAUDE.md rule 7), so there is nothing to
 * drift and a tolerance would only widen what an attacker may substitute.
 */
export function amountMatches(expected: Money, event: PaymentEvent): boolean {
  return event.kind === 'pay-in-completed' && event.amount === expected
}

/**
 * What happens to a verified event.
 *
 * The seam, and today it does not credit anything: crediting a contribution and
 * appending to the ledger is M5-03, and a handler that wrote to the chain
 * before the flow existed would be writing entries nothing could read.
 */
export interface PaymentEventHandler {
  handle(event: PaymentEvent): Promise<void>
}

// ---------------------------------------------------------------------------
// The two interfaces
// ---------------------------------------------------------------------------

/**
 * A gateway. Takes money into one merchant account and says so afterwards.
 *
 * This is the whole of what a provider bound by PayFast's 5.17(vi) may do, and
 * it is the interface a checkout-only integration implements.
 */
export interface PaymentProvider {
  startPayIn(request: PayInRequest): Promise<PayInHandle>

  /**
   * Asynchronous because verification is not always local: PayFast's fourth
   * check posts the notification back to PayFast and waits to be told it is
   * genuine.
   */
  verifyWebhook(delivery: WebhookDelivery): Promise<WebhookVerification>
}

export interface HeldBalance {
  /** Allocated to this beneficiary and not yet paid out. */
  readonly held: Money
  /** Paid out to this beneficiary, over the life of the account. */
  readonly paidOut: Money
}

export interface WithdrawalRequest {
  readonly beneficiary: BeneficiaryReference
  readonly amount: Money
  /**
   * Idempotency, per architecture §5.5. Stored before the call, and a retry
   * carries the **same** nonce — that is what makes a retry safe rather than a
   * second payment. A provider that has seen it before must refuse.
   */
  readonly nonce: string
}

export interface WithdrawalHandle {
  readonly reference: ProviderReference
  readonly state: WithdrawalState
}

/**
 * `completed` is not necessarily final. Architecture §5.4 records that a
 * settled payment can later be reversed — a closed destination account, a
 * recalled credit — so nothing in this product may tell an organiser the money
 * has definitely arrived on the strength of this alone.
 */
export type WithdrawalState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly reason: WithdrawalFailure }

export type WithdrawalFailure =
  | 'insufficient-balance'
  | 'beneficiary-unknown'
  | 'beneficiary-not-payable'
  | 'provider-rejected'

/**
 * A provider that holds a balance for somebody who is not us, and releases it
 * when asked.
 *
 * **PayFast cannot satisfy this and must not be made to** — 5.17(v) and (vi),
 * quoted at the top of this file. If a future provider can only do part of it,
 * that is a third interface and a conversation, not a stub that throws.
 */
export interface HeldBalanceProvider extends PaymentProvider {
  /** `null` for a beneficiary the provider does not have — not a zero balance. */
  balanceFor(beneficiary: BeneficiaryReference): Promise<HeldBalance | null>

  requestWithdrawal(request: WithdrawalRequest): Promise<WithdrawalHandle>

  withdrawalState(reference: ProviderReference): Promise<WithdrawalState>
}
