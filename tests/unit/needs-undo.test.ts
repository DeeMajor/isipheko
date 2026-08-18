import { describe, expect, it } from 'vitest'

import {
  UNDO_WINDOW_MS,
  formatClaimTicket,
  isWithinUndoWindow,
  parseClaimTicket,
  undoSecondsRemaining,
  undoToken,
  undoTokenMatches,
} from '@/domain/needs'

const PEPPER = 'test-pepper-not-the-real-one'
const CLAIM = '01923f7e-0000-7000-8000-00000000000c'
const NOW = new Date('2026-08-16T12:00:00.000Z')
const seconds = (n: number) => new Date(NOW.getTime() + n * 1000)

describe('the fifteen seconds', () => {
  it('is fifteen seconds', () => {
    expect(UNDO_WINDOW_MS).toBe(15_000)
  })

  it('is open at the moment of the claim and at the last instant', () => {
    expect(isWithinUndoWindow(NOW, NOW)).toBe(true)
    expect(isWithinUndoWindow(NOW, seconds(15))).toBe(true)
  })

  it('is closed a moment later', () => {
    expect(isWithinUndoWindow(NOW, seconds(15.001))).toBe(false)
    expect(isWithinUndoWindow(NOW, seconds(60))).toBe(false)
  })

  it('is closed for a claim that appears to be from the future', () => {
    // A clock skewed forwards must not hand somebody a longer window than the
    // one the server means to give.
    expect(isWithinUndoWindow(seconds(10), NOW)).toBe(false)
  })

  it('counts down, and never below zero', () => {
    expect(undoSecondsRemaining(NOW, NOW)).toBe(15)
    expect(undoSecondsRemaining(NOW, seconds(5))).toBe(10)
    expect(undoSecondsRemaining(NOW, seconds(15))).toBe(0)
    expect(undoSecondsRemaining(NOW, seconds(600))).toBe(0)
  })
})

describe('the capability', () => {
  it('is an HMAC of the claim, not the claim itself', () => {
    const token = undoToken(CLAIM, PEPPER)

    expect(token).not.toContain(CLAIM)
    expect(undoTokenMatches(CLAIM, PEPPER, token)).toBe(true)
  })

  it('does not carry from one claim to another', () => {
    // Otherwise anybody who had ever claimed anything could undo anything.
    const token = undoToken(CLAIM, PEPPER)

    expect(undoTokenMatches(`${CLAIM}x`, PEPPER, token)).toBe(false)
  })

  it('cannot be made without the pepper', () => {
    expect(undoTokenMatches(CLAIM, 'another-pepper', undoToken(CLAIM, PEPPER))).toBe(
      false,
    )
  })

  it('survives a malformed presentation without throwing', () => {
    // timingSafeEqual throws on a length mismatch. A junk cookie must be a
    // refusal, not a 500 on the event page.
    expect(undoTokenMatches(CLAIM, PEPPER, '')).toBe(false)
    expect(undoTokenMatches(CLAIM, PEPPER, 'nonsense')).toBe(false)
  })
})

describe('the ticket the cookie carries', () => {
  it('round-trips', () => {
    const token = undoToken(CLAIM, PEPPER)
    const ticket = formatClaimTicket(CLAIM, token)

    expect(parseClaimTicket(ticket)).toEqual({ claimId: CLAIM, token })
  })

  it('handles a token containing the separator', () => {
    // base64url has no dot in it, but the parser splits on the first one so a
    // token that ever did would still come back whole.
    expect(parseClaimTicket('abc.def.ghi')).toEqual({ claimId: 'abc', token: 'def.ghi' })
  })

  it.each(['', '.', 'nodot', '.leading', 'trailing.'])('refuses %o', (ticket) => {
    expect(parseClaimTicket(ticket)).toBeNull()
  })
})
