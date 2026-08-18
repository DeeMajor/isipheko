import { describe, expect, it } from 'vitest'

import {
  DIGEST_INTERVAL_MS,
  MAX_ATTEMPTS,
  attemptsExhausted,
  channelFor,
  countDigest,
  digestDue,
  digestDueAt,
  nextAttemptAt,
  nextSendWindow,
  sastHour,
  withinSendWindow,
} from '@/domain/messaging'

/**
 * The two rules that cost money or cost somebody sleep.
 *
 * Both are pure functions so they can be argued with here rather than inferred
 * from a database's behaviour: the digest cap is what turns 200 billable
 * messages into 24, and the quiet window is what stops a phone buzzing at
 * three in the morning about contributions to a funeral.
 *
 * Times are written as UTC and read as SAST, which is UTC+2 all year — South
 * Africa has no daylight saving, so there is no table to get wrong.
 */

const utc = (iso: string) => new Date(iso)

describe('which channel a message takes', () => {
  it('prefers WhatsApp, falls back to email, and otherwise sends nothing', () => {
    expect(channelFor({ phoneE164: '+27821234567' })).toBe('whatsapp')
    expect(channelFor({ phoneE164: null, email: 'nomsa@example.com' })).toBe('email')
    expect(channelFor({ phoneE164: '', email: '' })).toBeNull()
    expect(channelFor({})).toBeNull()
  })

  it('sends nothing to a contributor who left no number', () => {
    // They have no account and are never asked for an email (rule 4). Some
    // contributors are simply not notified, and that is the honest outcome of
    // never asking — see docs/decisions.md M2-08.
    expect(channelFor({ phoneE164: null, email: null })).toBeNull()
  })
})

describe('the quiet window', () => {
  it('reads the hour in South Africa, not on the server', () => {
    // 05:00 UTC is 07:00 in KwaMashu.
    expect(sastHour(utc('2026-08-16T05:00:00.000Z'))).toBe(7)
    expect(sastHour(utc('2026-08-16T22:30:00.000Z'))).toBe(0)
  })

  it('is open from 07:00 to 21:00 and closed either side', () => {
    expect(withinSendWindow(utc('2026-08-16T05:00:00.000Z'))).toBe(true) // 07:00
    expect(withinSendWindow(utc('2026-08-16T16:59:00.000Z'))).toBe(true) // 18:59
    expect(withinSendWindow(utc('2026-08-16T19:00:00.000Z'))).toBe(false) // 21:00
    expect(withinSendWindow(utc('2026-08-16T01:00:00.000Z'))).toBe(false) // 03:00
    expect(withinSendWindow(utc('2026-08-16T04:59:00.000Z'))).toBe(false) // 06:59
  })

  it('holds a late digest until the morning, and an early one until 07:00', () => {
    // 22:30 SAST on the 16th → 07:00 SAST on the 17th.
    expect(nextSendWindow(utc('2026-08-16T20:30:00.000Z')).toISOString()).toBe(
      '2026-08-17T05:00:00.000Z',
    )
    // 03:00 SAST → 07:00 SAST the same morning.
    expect(nextSendWindow(utc('2026-08-16T01:00:00.000Z')).toISOString()).toBe(
      '2026-08-16T05:00:00.000Z',
    )
  })

  it('does not move a digest that is already inside the window', () => {
    const noon = utc('2026-08-16T10:00:00.000Z')

    expect(nextSendWindow(noon)).toBe(noon)
  })

  it('crosses a month boundary without inventing a date', () => {
    expect(nextSendWindow(utc('2026-08-31T21:00:00.000Z')).toISOString()).toBe(
      '2026-09-01T05:00:00.000Z',
    )
  })
})

describe('the one-an-hour cap', () => {
  const midMorning = utc('2026-08-16T08:00:00.000Z') // 10:00 SAST

  it('lets the first digest go immediately', () => {
    expect(digestDue(null, midMorning)).toBe(true)
  })

  it('refuses a second inside the hour, and allows it after', () => {
    const lastSent = utc('2026-08-16T07:30:00.000Z')

    expect(digestDue(lastSent, midMorning)).toBe(false)
    expect(digestDue(lastSent, new Date(lastSent.getTime() + DIGEST_INTERVAL_MS))).toBe(
      true,
    )
  })

  it('composes with the quiet window rather than overriding it', () => {
    // An hour after 20:30 SAST is 21:30, which is inside quiet hours: the
    // digest waits for 07:00 rather than going out at half past nine at night.
    const lastSent = utc('2026-08-16T18:30:00.000Z') // 20:30 SAST
    const due = digestDueAt(lastSent, utc('2026-08-16T19:35:00.000Z'))

    expect(due.toISOString()).toBe('2026-08-17T05:00:00.000Z')
  })

  it('is what turns two hundred messages into twenty-four', () => {
    // Architecture §8.1: a per-contribution message on a 200-contribution
    // funeral is 200 billable utility messages. The cap makes the worst case a
    // day's worth of hours, whatever happens on the page.
    const perDay = (24 * 60 * 60 * 1000) / DIGEST_INTERVAL_MS

    expect(perDay).toBe(24)
    expect(perDay).toBeLessThan(200)
  })
})

describe('retrying', () => {
  const now = utc('2026-08-16T08:00:00.000Z')

  it('backs off rather than hammering a provider that is down', () => {
    // `attempts` counts failures including the one that just happened, so the
    // first failure waits a minute rather than five.
    expect(nextAttemptAt(1, now).getTime() - now.getTime()).toBe(60 * 1000)
    expect(nextAttemptAt(2, now).getTime() - now.getTime()).toBe(5 * 60 * 1000)
    expect(nextAttemptAt(3, now).getTime() - now.getTime()).toBe(25 * 60 * 1000)
    // Beyond the table it stays at the longest wait rather than growing.
    expect(nextAttemptAt(9, now).getTime() - now.getTime()).toBe(25 * 60 * 1000)
    // A zero would be a caller's arithmetic slip, not a shorter wait.
    expect(nextAttemptAt(0, now).getTime() - now.getTime()).toBe(60 * 1000)
  })

  it('gives up after three attempts, and not before', () => {
    expect(attemptsExhausted(1)).toBe(false)
    expect(attemptsExhausted(MAX_ATTEMPTS - 1)).toBe(false)
    expect(attemptsExhausted(MAX_ATTEMPTS)).toBe(true)
  })
})

describe('counting what happened', () => {
  it('counts each kind and the total', () => {
    expect(
      countDigest([
        'contribution_self_reported',
        'contribution_self_reported',
        'need_claimed',
      ]),
    ).toEqual({ selfReported: 2, confirmed: 0, claimed: 1, total: 3 })
  })

  it('counts nothing as nothing', () => {
    expect(countDigest([])).toEqual({
      selfReported: 0,
      confirmed: 0,
      claimed: 0,
      total: 0,
    })
  })
})
