import { describe, expect, it } from 'vitest'

import { PayFastProvider } from '@/adapters/payments'
import { SimulatedPaymentProvider } from '@/adapters/payments'
import { fromCents } from '@/domain/money'
import {
  amountMatches,
  type HeldBalanceProvider,
  type PaymentEvent,
  type PaymentProvider,
} from '@/domain/payments'

/**
 * The interface split, asserted by the compiler.
 *
 * **The `@ts-expect-error` below is the test**, in the same way M1-04's
 * archetype assertions are: `tsc --noEmit` covers this file and an unused
 * `@ts-expect-error` is itself an error, so the day `PayFastProvider` grows a
 * balance and a withdrawal, `pnpm typecheck` fails here.
 *
 * What it is guarding is PayFast's General Terms and Conditions 5.17:
 *
 * > (v) an aggregated Payment Transaction is not made for multiple suppliers;
 * >
 * > (vi) a Payment Transaction is not submitted for or on behalf of third party
 * > (i.e. other business entities or an entity that has not signed an Affiliate
 * > form)
 *
 * A held balance belonging to an organiser is what (vi) forbids. The split
 * makes that a compile error rather than a paragraph somebody has to have read.
 */

const CONFIG = {
  merchantId: '10000100',
  merchantKey: '46f0cd694581a',
  passphrase: 'jt7NOE43FZPn',
  mode: 'sandbox',
} as const

export function typeAssertions(): void {
  const payfast = new PayFastProvider(CONFIG)
  const simulated = new SimulatedPaymentProvider()

  // PayFast is a gateway, and a gateway is a PaymentProvider.
  const gateway: PaymentProvider = payfast
  void gateway

  // @ts-expect-error PayFast holds no balance for anybody but us. This is the
  // assertion the task is done by — General Terms 5.17(v) and (vi).
  const held: HeldBalanceProvider = payfast
  void held

  // The simulator does hold one, and satisfies both.
  const both: HeldBalanceProvider = simulated
  const narrow: PaymentProvider = simulated
  void both
  void narrow
}

const COMPLETED: PaymentEvent = {
  kind: 'pay-in-completed',
  reference: 'MTH-4K7B2X',
  providerReference: '1089250',
  amount: fromCents(50_000n),
  fee: null,
  net: null,
}

describe('the interface split', () => {
  it('gives PayFast the narrow interface and the simulator both', () => {
    expect(typeAssertions).toBeTypeOf('function')
  })

  it('does not put a control on either interface that only the simulator has', () => {
    const provider: HeldBalanceProvider = new SimulatedPaymentProvider()

    // `completePayIn` is a simulator control, not part of the contract. Reaching
    // it requires the concrete class, which is what stops a flow being written
    // against a method no real provider has.
    expect('completePayIn' in provider).toBe(true)
    expect(Object.keys(provider)).not.toContain('completePayIn')
  })
})

describe('amountMatches', () => {
  it('is exact, with no tolerance', () => {
    expect(amountMatches(fromCents(50_000n), COMPLETED)).toBe(true)
    expect(amountMatches(fromCents(50_001n), COMPLETED)).toBe(false)
    expect(amountMatches(fromCents(49_999n), COMPLETED)).toBe(false)
  })

  it('is false for anything that is not a completed pay-in', () => {
    expect(
      amountMatches(fromCents(50_000n), {
        kind: 'pay-in-cancelled',
        reference: 'MTH-4K7B2X',
        providerReference: '1089250',
      }),
    ).toBe(false)

    expect(
      amountMatches(fromCents(50_000n), {
        kind: 'withdrawal-completed',
        withdrawal: 'SIMW-1',
        beneficiary: 'BEN-1',
        amount: fromCents(50_000n),
      }),
    ).toBe(false)
  })
})

describe('the event types', () => {
  it('carry no timestamp, so no rule can be computed against a provider clock', () => {
    // The working agreement in CLAUDE.md: any timestamp a rule is computed
    // against is supplied by the application. The ledger hash covers
    // `created_at` (M2-01 §3) and the 72-hour hold reads it (M3-08 §3) — a
    // provider's clock would make both untestable at a fixed instant.
    for (const key of Object.keys(COMPLETED)) {
      expect(key).not.toMatch(/at$|date|time/i)
    }
  })

  it('carry nothing identifying a payer', () => {
    // Structural, not a convention: there is nowhere in the type to put a name,
    // a phone number or an email address, so an adapter cannot forward one
    // without changing the domain first (CLAUDE.md rule 4).
    for (const key of Object.keys(COMPLETED)) {
      expect(key).not.toMatch(/name|phone|email|contact|payer|customer/i)
    }
  })
})
