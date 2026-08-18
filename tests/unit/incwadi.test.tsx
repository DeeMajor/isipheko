import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { CollectionPage } from '@/db/repositories/collection'
import { ARCHETYPES } from '@/domain/archetype'
import { Incwadi } from '@/ui/incwadi'

/**
 * The incwadi — the sheet the group hands over with the money.
 *
 * *"Years later this page may be gone and the paper will not be."* So what is
 * checked here is what survives on paper: every name, every amount, the total,
 * who collected it, and **how the handover was confirmed**. A witness's tap and
 * the organiser's own word are different facts, and the difference has to be
 * legible to somebody reading it in five years.
 */

const COLLECTION: CollectionPage = {
  id: 'collection-1',
  slug: 'AbCdEf0123456789',
  archetype: 'umngcwabo',
  title: 'The Ngcobo cousins',
  purpose: 'The Mthembu family',
  eventId: null,
  organiserName: 'Nomsa Mthembu',
  organiserBankHint: "Nomsa's Capitec, ending 4471",
  status: 'handed_over',
  handoverStatus: 'witness_confirmed',
  needItem: { id: 'item-1', label: 'Tent' },
  members: { names: [], count: 3 },
  confirmedCents: 150_000n,
  organiserVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
  witnessName: 'Thandi Ngcobo',
  handoverAt: new Date('2026-08-15T09:40:00.000Z'),
  hostAcknowledgedAt: null,
  event: null,
  roster: [
    {
      id: 'm1',
      name: 'Thandi Ngcobo',
      amountCents: 80_000n,
      status: 'confirmed',
      joinedAt: new Date('2026-07-13T00:00:00.000Z'),
    },
    {
      id: 'm2',
      name: 'Sanele Mthembu',
      amountCents: 70_000n,
      status: 'confirmed',
      joinedAt: new Date('2026-07-14T00:00:00.000Z'),
    },
    {
      id: 'm3',
      name: 'Said they would',
      amountCents: 50_000n,
      status: 'pending',
      joinedAt: new Date('2026-07-15T00:00:00.000Z'),
    },
  ],
}

const render = (over: Partial<CollectionPage> = {}) =>
  renderToStaticMarkup(
    <Incwadi collection={{ ...COLLECTION, ...over }} archetype={ARCHETYPES.umngcwabo} />,
  )

const textOf = (markup: string) =>
  markup
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')

describe('what the family keeps', () => {
  it('carries every name and amount, and the total', () => {
    const text = textOf(render())

    expect(text).toContain('Thandi Ngcobo')
    expect(text).toContain('R800')
    expect(text).toContain('Sanele Mthembu')
    expect(text).toContain('R700')
    expect(text).toContain('Together')
    expect(text).toContain('R1 500')
  })

  it('leaves out somebody whose money never reached her', () => {
    // The paper must not credit a person who said they would and did not.
    const text = textOf(render())

    expect(text).not.toContain('Said they would')
    expect(text).not.toContain('R500')
  })

  it('names who collected it and that we checked her', () => {
    const text = textOf(render())

    expect(text).toContain('Collected by Nomsa Mthembu.')
    expect(text).toContain('ID verified by Isipheko 12 July 2026.')
  })

  it('says what the group took off the family’s list', () => {
    expect(textOf(render())).toContain(
      "Tent was taken off the family's list by this group as one item",
    )
  })
})

describe('how it was confirmed', () => {
  it('names the witness when somebody was there', () => {
    const text = textOf(render())

    expect(text).toContain('Handed over and witnessed by Thandi Ngcobo.')
    expect(text).toContain('15 August 2026')
  })

  it('says it was her own word when nobody was', () => {
    // `witnessName` null **is** the organiser-marked case (M2-11), and the
    // difference stays on the paper rather than being smoothed over.
    const text = textOf(
      render({ handoverStatus: 'organiser_evidenced', witnessName: null }),
    )

    expect(text).toContain('Marked handed over by Nomsa Mthembu, on her own word.')
    expect(text).not.toContain('witnessed by')
  })

  it('says plainly when nothing has been confirmed', () => {
    const text = textOf(
      render({ handoverStatus: 'not_started', witnessName: null, handoverAt: null }),
    )

    expect(text).toContain('Handover not yet confirmed.')
  })

  it('adds the family’s acknowledgement as a line, not as the account', () => {
    // Rule 15: a host's tap never displaces who actually closed the record.
    const text = textOf(
      render({ hostAcknowledgedAt: new Date('2026-08-16T00:00:00.000Z') }),
    )

    expect(text).toContain('Handed over and witnessed by Thandi Ngcobo.')
    expect(text).toContain('The family confirmed it reached them.')
  })
})

describe('it is a sheet of paper first', () => {
  it('hides the screen’s instructions when printed', () => {
    const markup = render()

    expect(markup).toContain('screenOnly')
    expect(markup).toContain('@media print')
    expect(markup).toContain('display: none')
  })

  it('keeps a name and its amount on one page', () => {
    expect(render()).toContain('break-inside: avoid')
  })

  it('has a landmark, so it can be read rather than walked', () => {
    expect(render()).toContain('<main')
  })

  it('claims no photo and no attachment', () => {
    // Evidence upload is M4-01's, and the record exists without it.
    const text = textOf(render()).toLowerCase()

    expect(text).not.toContain('photo')
    expect(text).not.toContain('attached')
  })

  it('names no colour, because bereavement declares no accent', () => {
    expect(render()).not.toMatch(/style="[^"]*--accent/)
  })
})
