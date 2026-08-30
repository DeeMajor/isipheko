import { describe, expect, it } from 'vitest'

import { setupCopy } from '@/copy/setup'
import { nameList, witnessCopy } from '@/copy/witness'
import { ARCHETYPES } from '@/domain/archetype'
import {
  WITNESS_INVITE_TTL_MS,
  checkInvite,
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  inviteTokenMatches,
  isInviteAnswer,
  isPubliclyNamed,
  statusForAnswer,
} from '@/domain/witness'

/**
 * Abakhaphi — the invite, and the register it is asked in.
 *
 * **Being asked is a compliment, not an audit** (Part D). Half of what follows
 * is about the words, because that is where this task can most easily go wrong:
 * the same flow written as a compliance check would pass every behavioural test
 * in the file.
 */

const NOW = new Date('2026-08-17T10:00:00.000Z')

describe('the invite token', () => {
  it('is 32 random bytes, and never the same twice', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateInviteToken()))

    expect(tokens.size).toBe(500)
    for (const token of tokens) {
      expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    }
  })

  it('is stored as a hash, so a database dump yields no usable link', () => {
    const token = generateInviteToken()
    const stored = hashInviteToken(token)

    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(stored).not.toContain(token)
    expect(inviteTokenMatches(token, stored)).toBe(true)
    expect(inviteTokenMatches(generateInviteToken(), stored)).toBe(false)
  })

  it('lives a month, like the handover link', () => {
    expect(WITNESS_INVITE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(inviteExpiresAt(NOW).getTime() - NOW.getTime()).toBe(WITNESS_INVITE_TTL_MS)
  })
})

describe('answering', () => {
  const live = { status: 'invited' as const, expiresAt: inviteExpiresAt(NOW) }

  it('is allowed while the link is live', () => {
    expect(checkInvite(live, NOW)).toEqual({ ok: true })
  })

  it('stops at the expiry', () => {
    const expired = new Date(live.expiresAt.getTime() + 1)

    expect(checkInvite(live, expired)).toEqual({ ok: false, reason: 'expired' })
  })

  it('is final until the organiser issues another', () => {
    // A link that kept toggling for thirty days would make "who agreed" change
    // under the page after people had read it.
    for (const status of ['accepted', 'declined'] as const) {
      expect(checkInvite({ status, expiresAt: null }, NOW)).toEqual({
        ok: false,
        reason: 'already-answered',
      })
    }
  })

  it('refuses a witness with no live link at all', () => {
    expect(checkInvite({ status: 'invited', expiresAt: null }, NOW)).toEqual({
      ok: false,
      reason: 'withdrawn',
    })
  })

  it('takes yes and no and nothing else', () => {
    expect(isInviteAnswer('accept')).toBe(true)
    expect(isInviteAnswer('decline')).toBe(true)
    expect(isInviteAnswer('maybe')).toBe(false)
    expect(isInviteAnswer('accepted')).toBe(false)

    expect(statusForAnswer('accept')).toBe('accepted')
    expect(statusForAnswer('decline')).toBe('declined')
  })
})

describe('who appears on the page', () => {
  it('is those who agreed, and nobody else', () => {
    // A declined invitation is a private answer to a private question.
    // Publishing it would turn a courtesy into a record of who refused a
    // grieving family.
    expect(isPubliclyNamed('accepted')).toBe(true)
    expect(isPubliclyNamed('declined')).toBe(false)
    expect(isPubliclyNamed('invited')).toBe(false)
  })
})

describe('the list of names', () => {
  it('reads the way somebody would say it', () => {
    expect(nameList([])).toBe('')
    expect(nameList(['Thandi Ngcobo'])).toBe('Thandi Ngcobo')
    expect(nameList(['Thandi', 'Sipho'])).toBe('Thandi and Sipho')
    expect(nameList(['Thandi', 'Sipho', 'Mandla'])).toBe('Thandi, Sipho and Mandla')
  })

  it('uses no Oxford comma, which `Intl.ListFormat` would have added', () => {
    expect(nameList(['Thandi', 'Sipho', 'Mandla'])).not.toContain(', and')
  })
})

describe('the words', () => {
  it("asks the design's question, and the invite page asks the same one", () => {
    // The promise made on the setup screen and the question actually asked have
    // to be the same sentence, or they will drift the first time one is edited.
    const organiser = 'Nomsa'
    const title = 'Nokuthula Mthembu'
    const kicker = ARCHETYPES.umngcwabo.kicker

    expect(witnessCopy.invite.question(organiser, kicker, title)).toBe(
      setupCopy.witnesses.askQuote(organiser, kicker, title),
    )
    expect(witnessCopy.invite.question(organiser, kicker, title)).toContain(
      'has asked you to stand with them as umkhaphi. Will you?',
    )
  })

  it('keeps the two lines Part D says must survive, word for word', () => {
    expect(setupCopy.witnesses.body).toBe(
      "Being asked to witness a family's umcimbi is not a small thing — it says you trust them with the family's business. Most people are honoured to be asked. Pick the ones the family would nod at.",
    )
    expect(setupCopy.witnesses.laterHint).toBe(
      'Someone in another household, so it is not all one roof.',
    )
  })

  it('gives every slot a relation hint, not a rule', () => {
    // Governance advice expressed as family instinct: the second hint is what
    // stops one household holding every signature, and it never says so.
    expect(setupCopy.witnesses.firstHint).toContain('an elder, an aunt')
    expect(setupCopy.witnesses.laterHint).toContain('another household')

    for (const hint of [setupCopy.witnesses.firstHint, setupCopy.witnesses.laterHint]) {
      expect(hint.toLowerCase()).not.toContain('must')
      expect(hint.toLowerCase()).not.toContain('required')
      expect(hint.toLowerCase()).not.toContain('independent')
    }
  })

  it('is honour rather than audit, everywhere it speaks', () => {
    const strings = JSON.stringify([witnessCopy, setupCopy.witnesses])

    for (const word of [
      'audit',
      'verify',
      'approve',
      'compliance',
      'authorise',
      'monitor',
      'oversight',
    ]) {
      expect(strings.toLowerCase(), word).not.toContain(word)
    }
  })

  it('does not argue with somebody who says no', () => {
    const declined = witnessCopy.declined.body.toLowerCase()

    expect(declined).toContain('complete answer')
    expect(declined).not.toContain('are you sure')
    expect(declined).not.toContain('reconsider')
    expect(declined).not.toContain('let us know why')
  })

  it('claims no message was sent, on either side of the link', () => {
    // Nothing sends anything (M1-06 §6, M2-08 §12). The organiser passes the
    // link on herself, and no string anywhere says otherwise.
    const strings = JSON.stringify([witnessCopy, setupCopy.witnesses])

    expect(strings).not.toContain('We send them')
    expect(strings).not.toContain('has been sent')
    expect(strings).not.toContain('we have messaged')
    expect(setupCopy.witnesses.askBody).toContain('Nothing goes out from us')
  })

  it('tells an umkhaphi there is no account and nothing to pay', () => {
    // Rule 4. Somebody on a borrowed phone, opening a link from a family in
    // grief, deserves to be told what this is before they tap anything.
    expect(witnessCopy.invite.noAccount).toContain('nothing to sign up for')
    expect(witnessCopy.invite.noAccount).toContain('nothing to pay')
  })

  it('warns about the one attack this role attracts', () => {
    // Somebody who has publicly agreed to stand with a family is a person a
    // scammer can name. §10: every outbound message says we never ask for a
    // code, and the page that creates the role says it too.
    expect(witnessCopy.accepted.note).toContain('never by a phone call asking for a code')
  })

  it('has a line for every way a link can fail, and none of them blame the reader', () => {
    for (const [reason, line] of Object.entries(witnessCopy.problems)) {
      expect(line.length, reason).toBeGreaterThan(40)
      expect(line.toLowerCase(), reason).not.toContain('invalid')
      expect(line.toLowerCase(), reason).not.toContain('error')
      // Each one says what to do next.
      expect(line.toLowerCase(), reason).toContain('ask whoever sent it')
    }
  })

  it('names abakhaphi on the page without counting them', () => {
    const line = witnessCopy.public.standingWith(nameList(['Thandi', 'Sipho']))

    expect(line).toBe('Standing with them: Thandi and Sipho')
    expect(line).not.toMatch(/\d/)
    expect(line.toLowerCase()).not.toContain('witness')
    expect(line.toLowerCase()).not.toContain('of 3')
  })
})
