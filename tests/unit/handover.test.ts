import { describe, expect, it } from 'vitest'

import { collectionCopy } from '@/copy/collection'
import {
  HANDOVER_TOKEN_TTL_MS,
  canAcknowledge,
  checkHandoverToken,
  confirmationRank,
  generateHandoverToken,
  handoverTokenExpiresAt,
  handoverTokenMatches,
  hashHandoverToken,
} from '@/domain/handover'

/**
 * The handover's rules.
 *
 * Two of them carry the weight. **A link that lives in a URL is single use and
 * expiring** — that is the whole mitigation for putting a capability somewhere
 * it can be forwarded, screenshotted or left in a history, and it is why
 * M2-04's cookie rule is departed from here rather than forgotten. And **the
 * family's tap is never required** (rule 15): it acknowledges a record that is
 * already closed and completes nothing.
 */

const NOW = new Date('2026-08-15T09:00:00.000Z')

describe('the link itself', () => {
  it('is 256 bits from the CSPRNG, and never the same twice', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateHandoverToken()))

    expect(tokens.size).toBe(50)
    for (const token of tokens) {
      // base64url of 32 bytes.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  it('is stored as a hash, so a database dump yields no usable link', () => {
    const token = generateHandoverToken()
    const hash = hashHandoverToken(token)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
    expect(handoverTokenMatches(token, hash)).toBe(true)
    expect(handoverTokenMatches(generateHandoverToken(), hash)).toBe(false)
  })

  it('does not fall over on a malformed hash', () => {
    // A truncated or hand-edited row is a failed match, not a 500 on the page
    // somebody opened at a graveside (M1-06 §8, same reasoning).
    expect(handoverTokenMatches(generateHandoverToken(), 'nonsense')).toBe(false)
    expect(handoverTokenMatches(generateHandoverToken(), '')).toBe(false)
  })
})

describe('single use and expiry', () => {
  const live = {
    kind: 'witness' as const,
    expiresAt: new Date('2026-09-01T00:00:00.000Z'),
  }

  it('accepts a link nobody has tapped', () => {
    expect(checkHandoverToken({ ...live, redeemedAt: null }, NOW)).toEqual({ ok: true })
  })

  it('refuses one that has been tapped', () => {
    // A link forwarded into a group chat confirms nothing a second time. This
    // is the mitigation for the capability living in a URL at all.
    expect(checkHandoverToken({ ...live, redeemedAt: NOW }, NOW)).toEqual({
      ok: false,
      reason: 'already-used',
    })
  })

  it('refuses one that has run out', () => {
    const expired = { ...live, expiresAt: new Date('2026-08-01T00:00:00.000Z') }

    expect(checkHandoverToken({ ...expired, redeemedAt: null }, NOW)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('treats the expiry moment itself as over', () => {
    const atExpiry = { ...live, expiresAt: NOW, redeemedAt: null }

    expect(checkHandoverToken(atExpiry, NOW).ok).toBe(false)
  })

  it('lives long enough to be sent a week early and still work on the day', () => {
    const issued = handoverTokenExpiresAt(NOW)

    expect(HANDOVER_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(issued.getTime()).toBeGreaterThan(NOW.getTime() + 7 * 24 * 60 * 60 * 1000)
  })
})

describe('the family', () => {
  it('can acknowledge only a handover that has actually happened', () => {
    expect(canAcknowledge('witness_confirmed')).toBe(true)
    expect(canAcknowledge('organiser_evidenced')).toBe(true)
    // Acknowledging a handover nobody has confirmed would be the family
    // confirming something that has not happened.
    expect(canAcknowledge('not_started')).toBe(false)
  })

  it('never outranks the account of who closed the record', () => {
    // A host's tap is an extra line, not a better one: the incwadi still says
    // whether a witness was there or the organiser closed it herself.
    expect(confirmationRank('witness')).toBeGreaterThan(confirmationRank('organiser'))
    expect(confirmationRank('organiser')).toBeGreaterThan(confirmationRank('host'))
  })
})

describe('what the handover copy says', () => {
  const copy = collectionCopy.handover

  it('sends the family away, in the design’s words', () => {
    // Part D2.4 and rule 15: the host does nothing in the system.
    expect(copy.lead).toContain('Not the family')
    expect(copy.lead).toContain('nothing to do in here')
    expect(copy.hostDoesNothing).toContain('does not have to do anything')
  })

  it('promises that nothing moves', () => {
    // No money passes through us at any point of a collection (rule 12), and
    // the tap is the moment somebody might assume otherwise.
    expect(copy.foot).toBe(
      'Nothing moves because of this tap. It only closes the record.',
    )
  })

  it('says the organiser’s own word is worth less, rather than apologising for it', () => {
    expect(copy.myselfBody).toContain('your word rather than a witness')
    expect(copy.myselfBody).toContain('that difference stays on it')
    expect(copy.sealOrganiserBody).toContain('worth less than a witness')
  })

  it('does not claim a photo it cannot take', () => {
    // The design offers "mark it yourself with a photo". Evidence upload needs
    // M4-01's EXIF stripping — a JPEG off a phone carries the GPS of the house
    // it was taken at, which on a funeral handover is the family's address.
    const strings = [copy.myselfBody, copy.myselfLabel, copy.myselfNoPhoto]

    expect(copy.myselfLabel).not.toContain('photo')
    expect(copy.myselfNoPhoto).toContain('later')
    for (const line of strings) {
      expect(line.toLowerCase()).not.toContain('upload')
      expect(line.toLowerCase()).not.toContain('attach a photo')
    }
  })

  it('tells the family nothing depended on them', () => {
    expect(copy.hostNote).toContain('never required')
    expect(copy.hostNote).toContain('already closed')
  })
})

describe('what the incwadi says', () => {
  const copy = collectionCopy.incwadi

  it('distinguishes a witness from the organiser’s own word', () => {
    expect(copy.confirmedByWitness('Thandi Ngcobo')).toContain(
      'witnessed by Thandi Ngcobo',
    )
    expect(copy.confirmedByOrganiser('Nomsa Mthembu')).toContain('on her own word')
  })

  it('says plainly when nothing has been confirmed yet', () => {
    expect(copy.notYet).toBe('Handover not yet confirmed.')
  })

  it('is a paper the family keeps, and says so', () => {
    expect(copy.intro).toContain('The family keeps it')
    expect(copy.intro).toContain('the paper will not be')
  })
})
