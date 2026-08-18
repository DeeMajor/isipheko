import { describe, expect, it } from 'vitest'

import {
  archetypeNotificationCopy,
  notificationCopy,
  notificationSubjects,
} from '@/copy/notifications'
import { ARCHETYPES, type ArchetypeKey } from '@/domain/archetype'
import {
  TEMPLATES,
  TEMPLATE_IDS,
  hasAllParams,
  isTemplateId,
  orderParams,
  templateFor,
  type TemplateId,
} from '@/domain/messaging'

/**
 * The half of M2-08's done-criterion that is about money: **every template is
 * utility, and none of them says anything that would get it reclassified.**
 *
 * Meta assigns the category, and a template carrying a promotional element is
 * moved to marketing — around $0.086 (~R1.50) a send in South Africa against a
 * utility rate a fraction of that (architecture §8.1). Reclassification happens
 * to the template, not to the message, so one careless sentence re-rates every
 * message that template ever sends.
 */

const SAMPLE: Record<string, string> = {
  eventTitle: 'Nokuthula Mthembu',
  summary: '3 people said they paid',
  confirmation: 'Your contribution has been confirmed by the family.',
  item: 'Chairs',
  url: 'https://isipheko.co.za/e/AbCdEf0123456789',
  reference: 'REP-4K7B2X',
  respondBy: '19 August',
}

const filled = (id: TemplateId) => notificationCopy[id](SAMPLE)

describe('the registry', () => {
  it('declares every template as utility, and nothing else', () => {
    for (const id of TEMPLATE_IDS) {
      expect(templateFor(id).category, id).toBe('utility')
    }
  })

  it('registers a versioned Meta name for each', () => {
    const names = TEMPLATE_IDS.map((id) => templateFor(id).metaName)

    for (const name of names) {
      expect(name, name).toMatch(/^[a-z][a-z0-9_]*_v\d+$/)
    }
    // A duplicate name would mean two of our messages arriving as the same
    // registered template, with whichever parameters the other one declared.
    expect(new Set(names).size).toBe(names.length)
  })

  it('carries no payout template, because no payout can be sent', () => {
    // Architecture §8.2 has three payout rows. Mode B is gated on the legal
    // opinion (§15 item 1), so a template for them would look reviewed and
    // have never been exercised — worse than an obvious gap.
    for (const id of TEMPLATE_IDS) {
      expect(id, id).not.toContain('payout')
    }
  })

  it('knows its own ids and refuses anything else', () => {
    expect(isTemplateId('organiser_digest')).toBe(true)
    expect(isTemplateId('marketing_blast')).toBe(false)
    expect(isTemplateId('')).toBe(false)
  })
})

describe('parameters', () => {
  it('orders them the way the registered template expects', () => {
    // Meta fills {{1}} with the first. Reordering this array silently rewrites
    // every message the template sends, which is why the order is declared.
    expect(orderParams('contributor_claim_confirmed', SAMPLE)).toEqual([
      'Chairs',
      'Nokuthula Mthembu',
      'https://isipheko.co.za/e/AbCdEf0123456789',
    ])
  })

  it('reports a message that would go out with an empty placeholder', () => {
    expect(hasAllParams('organiser_digest', SAMPLE)).toBe(true)
    expect(hasAllParams('organiser_digest', { eventTitle: 'x' })).toBe(false)
  })

  it('has copy for every declared parameter, and no undeclared ones', () => {
    for (const id of TEMPLATE_IDS) {
      const body = filled(id)

      for (const name of templateFor(id).params) {
        expect(SAMPLE[name], `${id} sample is missing ${name}`).toBeDefined()
        expect(body, `${id} never uses ${name}`).toContain(SAMPLE[name])
      }
    }
  })

  it('leaves no unfilled placeholder in any body', () => {
    for (const id of TEMPLATE_IDS) {
      expect(filled(id), id).not.toContain('{{')
      expect(filled(id), id).not.toContain('undefined')
    }
  })
})

describe('what the words may not say', () => {
  /** The vocabulary that gets a utility template reclassified as marketing. */
  const PROMOTIONAL = [
    'click here',
    'sign up',
    'special offer',
    'discount',
    'free',
    'deal',
    'don’t miss',
    "don't miss",
    'limited time',
    'exclusive',
    'upgrade',
    'invite your friends',
    'share this',
  ]

  const everyString = () => {
    const bodies = TEMPLATE_IDS.map((id) => filled(id))
    const subjects = TEMPLATE_IDS.map((id) => notificationSubjects[id](SAMPLE))
    const summaries = (Object.keys(ARCHETYPES) as ArchetypeKey[]).flatMap((key) => [
      archetypeNotificationCopy[key].digestSummary({
        selfReported: 3,
        confirmed: 2,
        claimed: 1,
        total: 6,
      }),
      archetypeNotificationCopy[key].contributionConfirmed('Nokuthula Mthembu'),
    ])

    return [...bodies, ...subjects, ...summaries]
  }

  it('contains nothing promotional', () => {
    for (const line of everyString()) {
      for (const phrase of PROMOTIONAL) {
        expect(line.toLowerCase(), `"${phrase}" in: ${line}`).not.toContain(phrase)
      }
    }
  })

  it('contains no amount, no total and no target', () => {
    // A notification is read on a lock screen and forwarded without thinking.
    // The organiser sees every amount on their own screen; on a bereavement
    // event they are hidden by default (§7.3), and a digest is not the place
    // to undo that.
    for (const line of everyString()) {
      expect(line, line).not.toMatch(/R\s?\d/)
      expect(line.toLowerCase(), line).not.toContain('total')
      expect(line.toLowerCase(), line).not.toContain('target')
      expect(line.toLowerCase(), line).not.toContain('raised')
    }
  })

  it('never claims a verification that has not happened', () => {
    for (const line of everyString()) {
      expect(line.toLowerCase(), line).not.toContain('verified')
    }
  })

  it('does not use a celebratory register on a bereavement event', () => {
    for (const key of ['umngcwabo', 'umbuyiso'] as const) {
      const copy = archetypeNotificationCopy[key]
      const summary = copy.digestSummary({
        selfReported: 2,
        confirmed: 1,
        claimed: 1,
        total: 4,
      })

      expect(summary.toLowerCase(), key).not.toContain('helped')
      expect(summary.toLowerCase(), key).not.toContain('celebrat')
      expect(copy.contributionConfirmed('Nokuthula Mthembu')).toContain('stood with them')
    }

    expect(
      archetypeNotificationCopy.umshado.contributionConfirmed('Lindiwe & Sipho'),
    ).toContain('bead is on the strand')
  })
})

describe('the digest summary', () => {
  const summary = archetypeNotificationCopy.umshado.digestSummary

  it('says what happened, in counts', () => {
    expect(summary({ selfReported: 3, confirmed: 0, claimed: 0, total: 3 })).toBe(
      '3 people said they paid',
    )
    expect(summary({ selfReported: 1, confirmed: 0, claimed: 0, total: 1 })).toBe(
      '1 person said they paid',
    )
  })

  it('joins the kinds that actually occurred', () => {
    const line = summary({ selfReported: 2, confirmed: 1, claimed: 4, total: 7 })

    expect(line).toContain('2 people said they paid')
    expect(line).toContain('1 person')
    expect(line).toContain('4 people are bringing something')
    // No empty clauses for the kinds that did not happen.
    expect(line).not.toContain('0 people')
  })
})

describe('every template is reachable', () => {
  it('has a body and a subject', () => {
    for (const id of TEMPLATE_IDS) {
      expect(typeof notificationCopy[id], id).toBe('function')
      expect(typeof notificationSubjects[id], id).toBe('function')
    }

    expect(Object.keys(TEMPLATES).sort()).toEqual([...TEMPLATE_IDS].sort())
  })
})
