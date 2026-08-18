import { describe, expect, it } from 'vitest'

import { ARCHETYPES, type ArchetypeConfig } from '@/domain/archetype'
import {
  MAX_WITNESSES,
  SETUP_STEPS,
  SLUG_LENGTH,
  canPublish,
  generateSlug,
  isValidSlug,
  nextStep,
  previousStep,
  stepNumber,
} from '@/domain/event'
import { needTemplate } from '@/copy/need-templates'
import { archetypeSetupCopy, setupCopy } from '@/copy/setup'

const CONFIGS: readonly ArchetypeConfig[] = Object.values(ARCHETYPES)

describe('the slug', () => {
  it('is 16 base62 characters', () => {
    for (let i = 0; i < 500; i += 1) {
      const slug = generateSlug()
      expect(slug).toHaveLength(SLUG_LENGTH)
      expect(slug).toMatch(/^[0-9A-Za-z]{16}$/)
      expect(isValidSlug(slug)).toBe(true)
    }
  })

  it('never repeats across 20 000 draws', () => {
    // Not a birthday-bound proof — a collision here would mean the generator is
    // not random at all, which is the failure that actually happens.
    const slugs = new Set(Array.from({ length: 20_000 }, () => generateSlug()))

    expect(slugs.size).toBe(20_000)
  })

  it('is not sequential, and shares no prefix with its neighbour', () => {
    // Architecture §10: never sequential. A slug that incremented would let
    // somebody walk from one family's funeral to the next.
    const slugs = Array.from({ length: 200 }, () => generateSlug())

    for (let i = 1; i < slugs.length; i += 1) {
      expect(slugs[i]).not.toBe(slugs[i - 1])
      expect(slugs[i]?.slice(0, 4)).not.toBe(slugs[i - 1]?.slice(0, 4))
    }
  })

  it('draws every character of the alphabet, roughly evenly', () => {
    // `byte % 62` without rejection would make the first eight characters
    // about 25% likelier than the rest. That is a real bias in the one value
    // protecting the page, so it is measured rather than assumed.
    const counts = new Map<string, number>()
    const draws = 4_000

    for (const character of Array.from({ length: draws }, () => generateSlug()).join(
      '',
    )) {
      counts.set(character, (counts.get(character) ?? 0) + 1)
    }

    expect(counts.size).toBe(62)

    const total = draws * SLUG_LENGTH
    const expectedShare = total / 62
    for (const [character, count] of counts) {
      // ±20% of the mean. A modulo bias shows as ~+25% on the first eight.
      expect(count, `${character} appeared ${String(count)} times`).toBeGreaterThan(
        expectedShare * 0.8,
      )
      expect(count, `${character} appeared ${String(count)} times`).toBeLessThan(
        expectedShare * 1.2,
      )
    }
  })

  it('has enough entropy that guessing is not a strategy', () => {
    // 62^16 ≈ 4.8 × 10^28, about 95 bits.
    const bits = SLUG_LENGTH * Math.log2(62)

    expect(bits).toBeGreaterThan(90)
  })

  it('rejects anything shorter or otherwise shaped', () => {
    expect(isValidSlug('short')).toBe(false)
    expect(isValidSlug('sixteen-chars-!!')).toBe(false)
    expect(isValidSlug('')).toBe(false)
  })
})

describe('the six steps', () => {
  it('is the order the design uses', () => {
    expect(SETUP_STEPS).toEqual([
      'kind',
      'details',
      'needs',
      'witnesses',
      'verify',
      'share',
    ])
  })

  it('numbers from one, for "Step N of 6"', () => {
    expect(stepNumber('kind')).toBe(1)
    expect(stepNumber('share')).toBe(6)
  })

  it('walks forwards and backwards, and stops at both ends', () => {
    expect(previousStep('kind')).toBeNull()
    expect(nextStep('share')).toBeNull()
    expect(nextStep('needs')).toBe('witnesses')
    expect(previousStep('witnesses')).toBe('needs')
  })
})

describe('publishing', () => {
  const ready = {
    title: 'Nokuthula Mthembu',
    needCount: 6,
    witnessCount: 1,
    isPublished: false,
    organiserVerified: true,
  }

  it('allows a draft with a name, a list and somebody standing with them', () => {
    expect(canPublish(ready)).toEqual({ ok: true })
  })

  it.each([
    ['no-title', { ...ready, title: '   ' }],
    ['no-needs', { ...ready, needCount: 0 }],
    ['no-witnesses', { ...ready, witnessCount: 0 }],
    ['already-published', { ...ready, isPublished: true }],
    ['not-verified', { ...ready, organiserVerified: false }],
  ])('refuses with %s', (blocker, draft) => {
    expect(canPublish(draft)).toEqual({ ok: false, blocker })
  })

  it('has copy for every blocker it can return', () => {
    for (const blocker of [
      'no-title',
      'no-needs',
      'no-witnesses',
      'already-published',
      'not-verified',
    ]) {
      expect(setupCopy.blockers[blocker as keyof typeof setupCopy.blockers]).toBeTruthy()
    }
  })

  it('gates on identity verification (M3-02)', () => {
    // M1-07 §5 left this clause out on purpose, and a test here recorded that
    // its absence was deliberate: nothing set the status, so a check against it
    // would have been a gate that always passed. M3-01 sets it, so the gate is
    // real and this is the assertion that replaced that record.
    expect(canPublish({ ...ready, organiserVerified: false })).toEqual({
      ok: false,
      blocker: 'not-verified',
    })
  })

  it('asks about the content before it asks her to go and be verified', () => {
    // Blockers surface one at a time. The content rules are each one field away
    // on a screen she is already on; this one sends her somewhere else, so
    // discovering it first and the missing title second is the wrong order.
    expect(canPublish({ ...ready, organiserVerified: false, title: '  ' })).toEqual({
      ok: false,
      blocker: 'no-title',
    })
  })

  it('answers "why can\'t I skip this?" rather than repeating the demand', () => {
    expect(setupCopy.whyNotSkip).toBe("Why can't I skip this?")

    // The answer is the design's own copy, and none of it is an instruction.
    const answer = [...setupCopy.verify.why, setupCopy.verify.whyClose].join(' ')
    expect(answer.length).toBeGreaterThan(400)
    expect(answer.toLowerCase()).not.toContain('you must')
    expect(answer.toLowerCase()).not.toContain('required')
  })
})

describe('need templates', () => {
  it.each(CONFIGS)('$key starts an organiser with a list, not a blank box', (config) => {
    const template = needTemplate(config.needsTemplate)

    expect(template.length).toBeGreaterThanOrEqual(6)
    for (const item of template) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.note.length).toBeGreaterThan(0)
    }
  })

  it('gives a funeral what a funeral needs', () => {
    const labels = needTemplate(ARCHETYPES.umngcwabo.needsTemplate).map(
      (item) => item.label,
    )

    expect(labels).toEqual([
      'Tent',
      'Chairs',
      'Meat',
      'Groceries',
      'Transport',
      'Catering pots',
    ])
  })

  it('keeps the notes as the prototype wrote them, unparsed', () => {
    const groceries = needTemplate(ARCHETYPES.umngcwabo.needsTemplate).find(
      (item) => item.label === 'Groceries',
    )

    // There is no quantity in this string, and a parser that invented one would
    // turn a grocery list into "1 unit".
    expect(groceries?.note).toBe('Mealie meal, rice, sugar, oil')
  })

  it('gives umembeso the union list, as agreed', () => {
    expect(needTemplate(ARCHETYPES.umembeso.needsTemplate)).toEqual(
      needTemplate(ARCHETYPES.umshado.needsTemplate),
    )
  })
})

describe('setup copy', () => {
  it.each(CONFIGS)('$key has its own words for the details step', (config) => {
    const copy = archetypeSetupCopy[config.key]

    expect(copy.nameLabel.length).toBeGreaterThan(0)
    expect(copy.detailsTitle.length).toBeGreaterThan(0)
    expect(copy.sampleTitle.length).toBeGreaterThan(0)
  })

  it('asks for the person being buried by name', () => {
    // The design's words, and they matter: being named is part of it.
    expect(archetypeSetupCopy.umngcwabo.nameHelp).toBe(
      'The person being buried. Being named is part of it.',
    )
  })

  it('never says campaign, donate, fundraiser or goal', () => {
    const forbidden = /campaign|donate|donation|fundraiser|fundraising|\bgoal\b/i
    const strings = JSON.stringify([setupCopy, archetypeSetupCopy])

    expect(strings).not.toMatch(forbidden)
  })

  it('claims no message is sent, because none is', () => {
    // This asserted the future tense of "We send them one message" until M3-03
    // gave her a link to pass on herself — at which point the sentence became
    // false rather than early, the M1-08 §5 class exactly. What replaced it
    // asserts the absence rather than a tense, because the tense was the part
    // that stopped being the point.
    const strings = JSON.stringify(setupCopy.witnesses)

    expect(strings).not.toContain('We send them')
    expect(strings).not.toContain('has been sent')
    expect(setupCopy.witnesses.askBody).toContain('Nothing goes out from us')
    expect(setupCopy.witnesses.foot).toBe(
      'They are asked, not added. Nothing goes out until they agree.',
    )
  })

  it('no longer claims the identity check is switched off', () => {
    // It was, at M1-07, and this test asserted the copy said so. M3-01 built
    // the check, so those two strings are gone rather than left sitting in the
    // copy file saying something false — the same treatment
    // `eventCopy.needs.notYet` got in M2-04 §8.
    const strings = JSON.stringify(setupCopy.verify)

    expect(strings).not.toContain('not switched on')
    expect(strings).not.toContain('Nothing is asked of you here today')
  })

  it('allows three abakhaphi and has an ordinal for each', () => {
    expect(MAX_WITNESSES).toBe(3)
    expect(setupCopy.witnesses.ordinals).toHaveLength(MAX_WITNESSES)
  })
})
