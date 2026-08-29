import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import { organiserForPhone } from '@/db/repositories/auth'
import { confirmByProvider, startContribution } from '@/db/repositories/contribution'
import { createDraft } from '@/db/repositories/event'
import { entriesForChain } from '@/db/repositories/ledger'
import type { PrismaClient } from '@/db/generated/client'
import { verifyChain } from '@/domain/ledger'
import { fromCents } from '@/domain/money'
import { formatReference } from '@/domain/reference'
import { splitBalance } from '@/domain/payout'
import { LedgerPaymentHandler } from '@/lib/payments'

import { clientFor } from '../setup/prisma'

/**
 * The payment confirming itself, against a real Postgres (M5-03).
 *
 * The property that matters most here is **a replayed notification writes one
 * entry**. Every provider retries until it is acknowledged — PayFast for 72
 * hours, Paystack every three minutes and then hourly — so a second delivery of
 * a payment already on the chain is the ordinary case rather than an attack.
 * The ledger is append-only (rule 3), so a duplicate is not something a later
 * correction can tidy away: it is two credits for one payment, permanently, and
 * the only remedy is a reversal that says the record was wrong.
 *
 * Nothing is mocked. The chain, the hashes, the transaction and the unique
 * constraints are the real ones.
 */

let app: PrismaClient
let organiserId: string
let counter = 0

const NOW = new Date('2026-08-20T09:00:00.000Z')

beforeAll(async () => {
  app = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(
    app,
    `+2787${String(++counter).padStart(7, '0')}`,
  )
  organiserId = organiser.id
})

afterAll(async () => {
  await app.$disconnect()
})

async function hostedEvent(): Promise<{ id: string; title: string }> {
  const draft = await createDraft(app, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: null,
    eventDate: null,
  })

  await app.event.update({ where: { id: draft.id }, data: { mode: 'hosted' } })
  return { id: draft.id, title: 'Nokuthula Mthembu' }
}

async function pendingContribution(
  eventId: string,
  title: string,
  amount = 50_000n,
): Promise<{ id: string; prefix: string; code: string; reference: string }> {
  const started = await startContribution(app, {
    eventId,
    eventTitle: title,
    type: 'cash',
    amountCents: fromCents(amount),
    contributorName: 'Thandi Ngcobo',
    contributorPhoneE164: null,
    visibility: 'name_only',
    reportedIpHash: null,
  })

  return {
    id: started.id,
    prefix: started.refPrefix,
    code: started.refCode,
    reference: formatReference({ prefix: started.refPrefix, code: started.refCode }),
  }
}

describe('a payment confirming itself', () => {
  it('writes the contribution and the ledger entry, and the chain verifies', async () => {
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    const outcome = await confirmByProvider(app, {
      prefix: contribution.prefix,
      code: contribution.code,
      providerReference: 'SIMP-0001',
      amountCents: 50_000n,
      now: NOW,
    })

    expect(outcome.ok).toBe(true)

    const row = await app.contribution.findUniqueOrThrow({
      where: { id: contribution.id },
    })
    expect(row.status).toBe('confirmed')
    expect(row.confirmedAt).toEqual(NOW)
    expect(row.pspPaymentId).toBe('SIMP-0001')

    // The row was created before anybody knew how it would be paid, so this is
    // the moment it becomes true.
    expect(row.verificationSource).toBe('psp_webhook')

    const entries = await entriesForChain(app, { eventId: event.id })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entryType).toBe('contribution')
    expect(entries[0]?.direction).toBe('credit')
    expect(entries[0]?.amountCents).toBe(fromCents(50_000n))
    expect(entries[0]?.contributionId).toBe(contribution.id)

    expect(verifyChain(event.id, entries).problems).toEqual([])
  })

  it('stamps the ledger with the application’s clock, not the provider’s', async () => {
    // The hash covers `created_at` (M2-01 §3) and the 72-hour hold reads it
    // (M3-08 §3). No event in `src/domain/payments/` carries a time at all, so
    // there is nothing here a provider's clock could reach.
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    await confirmByProvider(app, {
      prefix: contribution.prefix,
      code: contribution.code,
      providerReference: 'SIMP-CLOCK',
      amountCents: 50_000n,
      now: NOW,
    })

    const [entry] = await entriesForChain(app, { eventId: event.id })
    expect(entry?.createdAt).toEqual(NOW)
  })

  it('is what the organiser’s balance is computed from', async () => {
    // `splitBalance` reads the ledger, never `contributions` (M3-08 §4). One
    // act, one moment, and no second definition of what counts.
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    await confirmByProvider(app, {
      prefix: contribution.prefix,
      code: contribution.code,
      providerReference: 'SIMP-BALANCE',
      amountCents: 50_000n,
      now: NOW,
    })

    const entries = await entriesForChain(app, { eventId: event.id })
    const balance = splitBalance(
      entries.map((entry) => ({
        amount: entry.amountCents,
        direction: entry.direction,
        at: entry.createdAt,
      })),
      new Date(NOW.getTime() + 96 * 60 * 60 * 1000),
    )

    expect(balance.raised).toBe(fromCents(50_000n))
    expect(balance.available).toBe(fromCents(50_000n))
  })
})

describe('a replayed notification', () => {
  it('writes exactly one entry, however many times it arrives', async () => {
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    const notification = {
      prefix: contribution.prefix,
      code: contribution.code,
      providerReference: 'SIMP-REPLAY',
      amountCents: 50_000n,
      now: NOW,
    }

    const first = await confirmByProvider(app, notification)
    const second = await confirmByProvider(app, notification)
    const third = await confirmByProvider(app, notification)

    expect(first.ok).toBe(true)

    // Not an error. A provider retrying until it is acknowledged is the
    // ordinary case, and an alert nobody can act on is worse than silence.
    expect(second).toEqual({ ok: false, reason: 'already-recorded' })
    expect(third).toEqual({ ok: false, reason: 'already-recorded' })

    const entries = await entriesForChain(app, { eventId: event.id })
    expect(entries).toHaveLength(1)
    expect(verifyChain(event.id, entries).problems).toEqual([])
  })

  it('writes one entry when two deliveries race, and neither call throws', async () => {
    /*
     * Two of a provider's retries in flight at once. Both get past the read
     * above — neither has committed yet — so the **conditional update** is what
     * decides: it requires the row to still be pending and to carry no payment
     * id, and the loser's `count` comes back zero.
     *
     * **"Neither throws" is the assertion that makes the guard observable.**
     * The unique index on `psp_payment_id` would catch this either way, so a
     * test that only counted entries passes with the guard removed — the loser
     * simply fails with a constraint violation instead. That is the M2-05 §7
     * trap: a guard whose removal no test notices. What differs is the shape of
     * the answer. With the guard, a retry is told the payment is already
     * recorded and the route answers 200. Without it, the repository throws,
     * the route answers 500, and the provider keeps retrying a payment that is
     * already on the chain.
     */
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    const notification = {
      prefix: contribution.prefix,
      code: contribution.code,
      providerReference: 'SIMP-RACE',
      amountCents: 50_000n,
      now: NOW,
    }

    const outcomes = await Promise.allSettled([
      confirmByProvider(app, notification),
      confirmByProvider(app, notification),
    ])

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])

    const results = outcomes.flatMap((outcome) =>
      outcome.status === 'fulfilled' ? [outcome.value] : [],
    )

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(
      results.filter((result) => !result.ok && result.reason === 'already-recorded'),
    ).toHaveLength(1)

    const entries = await entriesForChain(app, { eventId: event.id })
    expect(entries).toHaveLength(1)
    expect(verifyChain(event.id, entries).problems).toEqual([])
  })

  it('will not write over a payment id the row already carries', async () => {
    /*
     * **The conditional update, tested at the level it operates.**
     *
     * The read and the write are separate statements. Between them the row can
     * change — the organiser could confirm the same contribution by hand, or a
     * second notification could land — and under read-committed the read is
     * already stale by the time the update runs. The `where` clause is what
     * makes the write safe against that: it requires the row to *still* be
     * pending and to carry no payment id.
     *
     * The state below is set directly, and **is not reachable through the
     * application today**: nothing records a payment id without confirming.
     * That is the point. Every deterministic path is caught earlier — by the
     * `already-recorded` return or the status check — and every concurrent one
     * is caught later by the unique index, so without this the guard would be a
     * clause whose removal no test notices, which is the M2-05 §7 trap exactly.
     */
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    await app.contribution.update({
      where: { id: contribution.id },
      data: { pspPaymentId: 'SIMP-SOMEBODY-ELSE' },
    })

    const outcome = await confirmByProvider(app, {
      prefix: contribution.prefix,
      code: contribution.code,
      providerReference: 'SIMP-LATE',
      amountCents: 50_000n,
      now: NOW,
    })

    expect(outcome).toEqual({ ok: false, reason: 'already-recorded' })

    // Nothing written, and the id it already had is untouched.
    const row = await app.contribution.findUniqueOrThrow({
      where: { id: contribution.id },
    })
    expect(row.status).toBe('pending')
    expect(row.pspPaymentId).toBe('SIMP-SOMEBODY-ELSE')
    expect(await entriesForChain(app, { eventId: event.id })).toEqual([])
  })
})

describe('a notification that does not match the record', () => {
  it('refuses an amount we were not expecting, and confirms nothing', async () => {
    /*
     * The fourth of PayFast's four security checks, and the one an adapter
     * cannot do: knowing what to compare against means knowing which record the
     * notification is about (M5-01 §5). Exact, with no tolerance — this product
     * has no floats for anything to drift by (rule 7).
     */
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    const outcome = await confirmByProvider(app, {
      prefix: contribution.prefix,
      code: contribution.code,
      providerReference: 'SIMP-WRONG',
      amountCents: 1n,
      now: NOW,
    })

    expect(outcome).toEqual({ ok: false, reason: 'amount-mismatch' })

    const row = await app.contribution.findUniqueOrThrow({
      where: { id: contribution.id },
    })
    expect(row.status).toBe('pending')
    expect(await entriesForChain(app, { eventId: event.id })).toEqual([])
  })

  it('refuses a reference nobody was issued', async () => {
    const outcome = await confirmByProvider(app, {
      prefix: 'ZZZ',
      code: '000000',
      providerReference: 'SIMP-NOBODY',
      amountCents: 50_000n,
      now: NOW,
    })

    expect(outcome).toEqual({ ok: false, reason: 'not-found' })
  })

  it('refuses a contribution that is no longer pending', async () => {
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    await confirmByProvider(app, {
      prefix: contribution.prefix,
      code: contribution.code,
      providerReference: 'SIMP-FIRST',
      amountCents: 50_000n,
      now: NOW,
    })

    // A different payment id against a row already paid: not a retry, and not
    // something to write a second credit for.
    const outcome = await confirmByProvider(app, {
      prefix: contribution.prefix,
      code: contribution.code,
      providerReference: 'SIMP-SECOND',
      amountCents: 50_000n,
      now: NOW,
    })

    expect(outcome).toEqual({ ok: false, reason: 'not-pending' })
    expect(await entriesForChain(app, { eventId: event.id })).toHaveLength(1)
  })
})

describe('the handler', () => {
  const handler = () => new LedgerPaymentHandler(app, () => NOW)

  it('confirms a completed pay-in', async () => {
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    await handler().handle({
      kind: 'pay-in-completed',
      reference: contribution.reference,
      providerReference: 'SIMP-HANDLER',
      amount: fromCents(50_000n),
      fee: null,
      net: null,
    })

    const entries = await entriesForChain(app, { eventId: event.id })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.createdAt).toEqual(NOW)
  })

  it('does nothing with a cancellation', async () => {
    /*
     * Somebody who backed out at the checkout changed their mind, which is the
     * same as walking away from the pay step: the row stays pending and the
     * fourteen-day sweep voids it (M2-05 §6).
     *
     * Marking it void here would also make cancel-then-pay unrecoverable, and
     * no provider guarantees the order two notifications arrive in.
     */
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    await handler().handle({
      kind: 'pay-in-cancelled',
      reference: contribution.reference,
      providerReference: 'SIMP-CANCEL',
    })

    const row = await app.contribution.findUniqueOrThrow({
      where: { id: contribution.id },
    })
    expect(row.status).toBe('pending')
    expect(await entriesForChain(app, { eventId: event.id })).toEqual([])
  })

  it('does nothing with a settled withdrawal, because there is no payout to attach it to', async () => {
    // `payouts` is empty and nothing writes it (M3-08 §12). A debit against no
    // payout would put a movement on the chain that no record explains. M5-09.
    const event = await hostedEvent()
    const contribution = await pendingContribution(event.id, event.title)

    await handler().handle({
      kind: 'pay-in-completed',
      reference: contribution.reference,
      providerReference: 'SIMP-BEFORE-WITHDRAWAL',
      amount: fromCents(50_000n),
      fee: null,
      net: null,
    })

    await handler().handle({
      kind: 'withdrawal-completed',
      withdrawal: 'SIMW-0001',
      beneficiary: organiserId,
      amount: fromCents(50_000n),
    })

    const entries = await entriesForChain(app, { eventId: event.id })
    expect(entries).toHaveLength(1)
    expect(entries.every((entry) => entry.direction === 'credit')).toBe(true)
  })

  it('ignores a reference that is not one of ours', async () => {
    // Refused before a query, because a malformed reference is not a lookup
    // that failed — it is a notification about something we never issued.
    await expect(
      handler().handle({
        kind: 'pay-in-completed',
        reference: 'not a reference',
        providerReference: 'SIMP-JUNK',
        amount: fromCents(50_000n),
        fee: null,
        net: null,
      }),
    ).resolves.toBeUndefined()
  })
})
