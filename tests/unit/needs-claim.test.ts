import { describe, expect, it } from 'vitest'

import {
  CLAIM_HOLD_MS,
  CLAIM_WARNING_MS,
  allowsPartialClaim,
  canConfirmDelivery,
  canWithdraw,
  checkClaim,
  claimExpiresAt,
  hasLapsed,
  holdsQuantity,
  isExpiringSoon,
  isFullyClaimed,
  remainingQuantity,
  type NeedItemState,
} from '@/domain/needs'

const NOW = new Date('2026-08-16T12:00:00.000Z')
const hours = (n: number) => new Date(NOW.getTime() + n * 60 * 60 * 1000)

const tent: NeedItemState = { status: 'active', quantityRequired: 1, quantityClaimed: 0 }
const meat: NeedItemState = {
  status: 'active',
  quantityRequired: 20,
  quantityClaimed: 12,
}

describe('what remains', () => {
  it('counts down as it is claimed', () => {
    expect(remainingQuantity(tent)).toBe(1)
    expect(remainingQuantity(meat)).toBe(8)
    expect(isFullyClaimed({ ...meat, quantityClaimed: 20 })).toBe(true)
  })

  it('never goes below zero, however the counter got there', () => {
    // If a decrement ever ran twice, the board should read "taken", not "-3
    // remaining". The CHECK stops it reaching the database; this stops it
    // reaching a page.
    expect(remainingQuantity({ ...meat, quantityClaimed: 25 })).toBe(0)
  })
})

describe('partial claiming', () => {
  it('is allowed exactly when more than one is needed', () => {
    // Derived, never stored. A second field that must agree with this one is a
    // field that eventually will not.
    expect(allowsPartialClaim(tent)).toBe(false)
    expect(allowsPartialClaim(meat)).toBe(true)
  })

  it('takes part of what is left', () => {
    expect(checkClaim(meat, 5)).toEqual({ ok: true })
    expect(checkClaim(meat, 8)).toEqual({ ok: true })
  })

  it('refuses more than remains', () => {
    expect(checkClaim(meat, 9)).toEqual({ ok: false, reason: 'more-than-remains' })
  })

  it('is all or nothing on a single thing', () => {
    // A tent taken half-way is not half a tent.
    expect(checkClaim(tent, 1)).toEqual({ ok: true })
    expect(checkClaim({ ...tent, quantityRequired: 1 }, 2)).toEqual({
      ok: false,
      reason: 'all-or-nothing',
    })
  })
})

describe('claims that make no sense', () => {
  it.each([
    [0, 'at-least-one'],
    [-3, 'at-least-one'],
    [1.5, 'not-a-whole-number'],
    [Number.NaN, 'not-a-whole-number'],
  ])('refuses a quantity of %s', (quantity, reason) => {
    expect(checkClaim(meat, quantity)).toEqual({ ok: false, reason })
  })

  it('refuses an item nobody has approved yet', () => {
    expect(checkClaim({ ...meat, status: 'suggested' }, 1)).toEqual({
      ok: false,
      reason: 'not-open',
    })
    expect(checkClaim({ ...meat, status: 'declined' }, 1)).toEqual({
      ok: false,
      reason: 'not-open',
    })
  })

  it('refuses an item already taken', () => {
    expect(checkClaim({ ...meat, quantityClaimed: 20 }, 1)).toEqual({
      ok: false,
      reason: 'already-taken',
    })
  })
})

describe('the hold', () => {
  it('is seven days', () => {
    expect(CLAIM_HOLD_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(claimExpiresAt(NOW)).toEqual(hours(24 * 7))
  })

  it('warns at 48 hours, matching the notification matrix', () => {
    expect(CLAIM_WARNING_MS).toBe(48 * 60 * 60 * 1000)

    const claim = { status: 'claimed' as const, expiresAt: hours(24) }
    expect(isExpiringSoon(claim, NOW)).toBe(true)
    expect(isExpiringSoon({ status: 'claimed', expiresAt: hours(72) }, NOW)).toBe(false)
  })

  it('does not warn about a claim that has already gone', () => {
    expect(isExpiringSoon({ status: 'claimed', expiresAt: hours(-1) }, NOW)).toBe(false)
    expect(isExpiringSoon({ status: 'withdrawn', expiresAt: hours(24) }, NOW)).toBe(false)
  })

  it('lapses the moment it expires, not when a job notices', () => {
    // A claim that lapsed an hour ago must not block somebody now.
    expect(hasLapsed({ status: 'claimed', expiresAt: hours(-1) }, NOW)).toBe(true)
    expect(hasLapsed({ status: 'claimed', expiresAt: NOW }, NOW)).toBe(true)
    expect(hasLapsed({ status: 'claimed', expiresAt: hours(1) }, NOW)).toBe(false)
  })

  it('does not lapse something already settled', () => {
    expect(hasLapsed({ status: 'delivered', expiresAt: hours(-1) }, NOW)).toBe(false)
    expect(hasLapsed({ status: 'withdrawn', expiresAt: hours(-1) }, NOW)).toBe(false)
  })
})

describe('what a claim still holds', () => {
  it('keeps the quantity while it is claimed or delivered', () => {
    // Delivered means the thing arrived. The item is no less taken for it.
    expect(holdsQuantity('claimed')).toBe(true)
    expect(holdsQuantity('delivered')).toBe(true)
  })

  it('gives it back when it expires or is withdrawn', () => {
    expect(holdsQuantity('expired')).toBe(false)
    expect(holdsQuantity('withdrawn')).toBe(false)
  })

  it('can only be withdrawn or confirmed while it is live', () => {
    expect(canWithdraw('claimed')).toBe(true)
    expect(canWithdraw('delivered')).toBe(false)
    expect(canConfirmDelivery('claimed')).toBe(true)
    // Confirming an expired claim would silently re-reserve a quantity somebody
    // else may already have taken.
    expect(canConfirmDelivery('expired')).toBe(false)
  })
})
