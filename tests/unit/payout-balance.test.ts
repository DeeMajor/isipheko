import { describe, expect, it } from 'vitest'

import { formatMoney, fromCents } from '@/domain/money'
import {
  SETTLEMENT_HOLD_MS,
  WITNESS_APPROVAL_THRESHOLD,
  needsWitnessApproval,
  splitBalance,
  type BalanceEntry,
} from '@/domain/payout'

/**
 * The money split, and the property the whole task turns on: **the 72-hour hold
 * fences the recent portion, never the whole balance.**
 *
 * A hold that froze everything whenever anything was recent would mean a family
 * who received one R50 contribution this morning cannot touch the R40 000 that
 * arrived last week. That is not a safety measure — it is a product that stops
 * working on the day it is used most, and it would be discovered by somebody
 * standing in a bank on the morning of a funeral.
 *
 * Every assertion here runs against a **fixed `now`**. The window is three days
 * wide, so a suite that used the wall clock would pass or fail according to the
 * day somebody ran it (CLAUDE.md's timestamp rule, M2-08b §6).
 */

const NOW = new Date('2026-08-18T09:00:00.000Z')

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000)

const credit = (rands: number, at: Date): BalanceEntry => ({
  amount: fromCents(BigInt(rands) * 100n),
  direction: 'credit',
  at,
})

const debit = (rands: number, at: Date): BalanceEntry => ({
  amount: fromCents(BigInt(rands) * 100n),
  direction: 'debit',
  at,
})

/** An in-kind entry: a tent, with no amount at all. */
const inKind = (at: Date): BalanceEntry => ({ amount: null, direction: 'credit', at })

describe('the hold fences the recent portion', () => {
  it('leaves the older money available when something arrived this morning', () => {
    // The headline case. R40 000 last week, R50 an hour ago.
    const split = splitBalance(
      [credit(40_000, hoursAgo(24 * 7)), credit(50, hoursAgo(1))],
      NOW,
    )

    expect(formatMoney(split.raised)).toBe('R40 050,00')
    expect(formatMoney(split.settling)).toBe('R50,00')
    expect(formatMoney(split.available)).toBe('R40 000,00')
  })

  it('never fences the whole balance while any of it has aged', () => {
    /*
     * Stated as a property rather than a case, because this is the mistake the
     * done-criterion names. Any mix where at least one entry is outside the
     * window must leave something available.
     */
    for (let recent = 1; recent <= 20; recent += 1) {
      const entries = [
        credit(100, hoursAgo(100)),
        ...Array.from({ length: recent }, (_, index) => credit(10, hoursAgo(index % 71))),
      ]

      const split = splitBalance(entries, NOW)
      expect(split.available > 0n, `${String(recent)} recent entries`).toBe(true)
    }
  })

  it('fences everything only when everything is recent', () => {
    const split = splitBalance([credit(500, hoursAgo(2)), credit(300, hoursAgo(70))], NOW)

    expect(formatMoney(split.settling)).toBe('R800,00')
    expect(formatMoney(split.available)).toBe('R0,00')
  })

  it('holds nothing when nothing is recent', () => {
    const split = splitBalance([credit(500, hoursAgo(100))], NOW)

    expect(formatMoney(split.available)).toBe('R500,00')
    expect(split.settling).toBe(0n)
    expect(split.clearsAt).toBeNull()
  })
})

describe('the edge of the window', () => {
  it('is 72 hours', () => {
    expect(SETTLEMENT_HOLD_MS).toBe(72 * 60 * 60 * 1000)
  })

  it('holds an entry one minute inside it', () => {
    const at = new Date(NOW.getTime() - SETTLEMENT_HOLD_MS + 60_000)
    expect(splitBalance([credit(100, at)], NOW).settling).toBe(100_00n)
  })

  it('releases an entry one minute outside it', () => {
    const at = new Date(NOW.getTime() - SETTLEMENT_HOLD_MS - 60_000)
    expect(splitBalance([credit(100, at)], NOW).settling).toBe(0n)
  })

  it('releases one exactly on the boundary', () => {
    // Arbitrary but stated: exactly 72 hours old has served the window. The
    // alternative leaves an amount fenced for a further millisecond, which
    // nobody can act on and every test would have to reproduce.
    const at = new Date(NOW.getTime() - SETTLEMENT_HOLD_MS)
    expect(splitBalance([credit(100, at)], NOW).settling).toBe(0n)
  })
})

describe('when it clears', () => {
  it('is 72 hours after the oldest fenced entry, not the newest', () => {
    // What an organiser is told is when they can act, which is when the *first*
    // of the fenced entries leaves — not when the last one does.
    const oldest = hoursAgo(70)
    const split = splitBalance([credit(100, hoursAgo(1)), credit(100, oldest)], NOW)

    expect(split.clearsAt).toEqual(new Date(oldest.getTime() + SETTLEMENT_HOLD_MS))
  })

  it('is null when nothing is fenced', () => {
    expect(splitBalance([], NOW).clearsAt).toBeNull()
    expect(splitBalance([credit(100, hoursAgo(200))], NOW).clearsAt).toBeNull()
  })
})

describe('what is not money', () => {
  it('leaves in-kind out of every figure', () => {
    // A tent is not money and cannot be paid out. Counting it would inflate a
    // number an organiser might act on.
    const split = splitBalance([credit(100, hoursAgo(100)), inKind(hoursAgo(1))], NOW)

    expect(formatMoney(split.raised)).toBe('R100,00')
    expect(split.settling).toBe(0n)
  })

  it('answers zero for an event with nothing on it', () => {
    const split = splitBalance([], NOW)

    expect(split.raised).toBe(0n)
    expect(split.settling).toBe(0n)
    expect(split.available).toBe(0n)
  })
})

describe('reversals', () => {
  it('come off the total', () => {
    const split = splitBalance(
      [credit(500, hoursAgo(100)), debit(200, hoursAgo(90))],
      NOW,
    )

    expect(formatMoney(split.raised)).toBe('R300,00')
    expect(formatMoney(split.available)).toBe('R300,00')
  })

  it('come off the fenced portion when the reversal is itself recent', () => {
    // Otherwise the hold would go on fencing money that is no longer there.
    const split = splitBalance([credit(500, hoursAgo(2)), debit(500, hoursAgo(1))], NOW)

    expect(split.raised).toBe(0n)
    expect(split.settling).toBe(0n)
    expect(split.available).toBe(0n)
  })

  it('never produce a negative figure on the screen', () => {
    /*
     * An old credit reversed today is a recent debit against money that was
     * never fenced, so the fenced subtotal goes below zero on the way through.
     * `Money` is a magnitude and would throw; the split clamps instead, because
     * an exception here is a 500 on the organiser's dashboard.
     */
    const split = splitBalance([credit(500, hoursAgo(200)), debit(500, hoursAgo(1))], NOW)

    expect(split.raised).toBe(0n)
    expect(split.settling).toBe(0n)
    expect(split.available).toBe(0n)
  })

  it('never lets the fenced portion exceed the total', () => {
    // available = raised - settling, and a negative available is the one number
    // on this screen that cannot be explained to anybody.
    const split = splitBalance(
      [credit(100, hoursAgo(1)), credit(400, hoursAgo(200)), debit(400, hoursAgo(2))],
      NOW,
    )

    expect(split.settling <= split.raised).toBe(true)
    expect(split.available >= 0n).toBe(true)
  })
})

describe('the witness threshold', () => {
  it('is R5 000, from the dashboard design', () => {
    expect(formatMoney(WITNESS_APPROVAL_THRESHOLD)).toBe('R5 000,00')
  })

  it('asks for a second signature above it and not at it', () => {
    expect(needsWitnessApproval(fromCents(5_000_01n))).toBe(true)
    expect(needsWitnessApproval(fromCents(5_000_00n))).toBe(false)
    expect(needsWitnessApproval(fromCents(0n))).toBe(false)
  })
})
