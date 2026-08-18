import { describe, expect, it } from 'vitest'

import { parseSaIdNumber } from '@/domain/identity'

/**
 * Everything checkable without spending R29.90 (architecture §7.1).
 *
 * The fixtures are built on `530607…08`, whose sequence block is free to choose
 * — `5306075800082` is the sandbox identity Stitch documents (§5.6), which is
 * also a useful sanity check that the Luhn implementation here agrees with a
 * published one.
 */

const VALID = '5306075800082'

describe('parseSaIdNumber', () => {
  it('accepts a valid number', () => {
    expect(parseSaIdNumber(VALID)).toEqual({ ok: true, value: VALID })
  })

  it('accepts the way people actually write it down', () => {
    expect(parseSaIdNumber('530607 5800 08 2')).toEqual({ ok: true, value: VALID })
    expect(parseSaIdNumber('530607-5800-082')).toEqual({ ok: true, value: VALID })
  })

  it('normalises to digits, so the hash of two spellings is one hash', () => {
    const spaced = parseSaIdNumber('530607 5800 082')
    const plain = parseSaIdNumber(VALID)

    expect(spaced.ok && plain.ok && spaced.value === plain.value).toBe(true)
  })

  it('rejects an empty value', () => {
    expect(parseSaIdNumber('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseSaIdNumber('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects the wrong length', () => {
    expect(parseSaIdNumber('530607580008')).toEqual({ ok: false, reason: 'wrong-length' })
    expect(parseSaIdNumber('53060758000821')).toEqual({
      ok: false,
      reason: 'wrong-length',
    })
  })

  it('rejects letters rather than stripping them', () => {
    // A letter in an ID number is a different kind of mistake from a space, and
    // quietly removing it would resolve to a number nobody typed.
    expect(parseSaIdNumber('53060758000O2')).toEqual({ ok: false, reason: 'not-digits' })
  })

  it('rejects a date that could not have happened', () => {
    expect(parseSaIdNumber('5313075800082').ok).toBe(false)
    expect(parseSaIdNumber('5306325800082')).toEqual({
      ok: false,
      reason: 'impossible-date',
    })
    expect(parseSaIdNumber('5300075800082')).toEqual({
      ok: false,
      reason: 'impossible-date',
    })
  })

  it('allows 29 February, because a two-digit year cannot say which century', () => {
    // `000229` is 29 February 2000, which existed, and 1900, which did not. The
    // rule is "possible in either century", not "possible in the one we guessed".
    const result = parseSaIdNumber('0002295800086')

    expect(result.ok || result.reason).not.toBe('impossible-date')
  })

  it('rejects a citizenship digit Home Affairs does not issue', () => {
    expect(parseSaIdNumber('5306075800282')).toEqual({
      ok: false,
      reason: 'unknown-citizenship',
    })
  })

  it('catches a single mistyped digit through the check digit', () => {
    // This is the whole reason a typo is usually free to catch rather than
    // R29.90 to discover.
    expect(parseSaIdNumber('5306075800082'.replace('58', '59'))).toEqual({
      ok: false,
      reason: 'check-digit',
    })
  })

  it('catches an adjacent transposition', () => {
    expect(parseSaIdNumber('5306078500082')).toEqual({ ok: false, reason: 'check-digit' })
  })

  it('never puts the number in the reason', () => {
    // These codes reach a query string and the audit log (rule 8).
    const result = parseSaIdNumber('5306075800081')

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('530607')
  })
})
