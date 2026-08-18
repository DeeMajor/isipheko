import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { collectionCopy } from '@/copy/collection'
import type { CollectionPage } from '@/db/repositories/collection'
import { ARCHETYPES } from '@/domain/archetype'
import { CollectionJoinPage, JOIN_STEPS } from '@/ui/collection-join-page'
import { CollectionPublicPage } from '@/ui/collection-page'

/**
 * The collection page, as markup.
 *
 * What is checked here is what rule 16 and Part D2.6 require and what M2-10
 * settled: **the custody sentence appears in her name, in full**, the page
 * claims no verification it does not hold, the group's own roster carries
 * amounts while nothing host-facing does, and the join flow asks for no account
 * of any kind.
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
  status: 'open',
  handoverStatus: 'not_started',
  needItem: null,
  members: { names: ['Nomsa Mthembu', 'Sanele Mthembu'], count: 3 },
  confirmedCents: 190_000n,
  organiserVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
  witnessName: null,
  handoverAt: null,
  hostAcknowledgedAt: null,
  event: null,
  roster: [
    {
      id: 'm1',
      name: 'Nomsa Mthembu',
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
      name: null,
      amountCents: 40_000n,
      status: 'confirmed',
      joinedAt: new Date('2026-07-15T00:00:00.000Z'),
    },
  ],
}

const render = (over: Partial<CollectionPage> = {}) =>
  renderToStaticMarkup(
    <CollectionPublicPage
      collection={{ ...COLLECTION, ...over }}
      archetype={ARCHETYPES.umngcwabo}
    />,
  )

const textOf = (markup: string) =>
  markup
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')

describe('who holds the money', () => {
  it('says it in her name, above anything that asks for money', () => {
    const markup = render()
    const text = textOf(markup)

    // Rule 16 and Part D2.6, verbatim from design/collection.html.
    expect(text).toContain('Nomsa Mthembu holds this money, not Isipheko.')
    expect(text).toContain(
      'You are trusting her, the way you would if she collected it in an envelope.',
    )

    // And it comes before the join button, because it is what somebody needs
    // in order to decide.
    expect(markup.indexOf('holds this money')).toBeLessThan(
      markup.indexOf(collectionCopy.page.joinLabel),
    )
  })

  it('answers "is this real" and "who holds it" as two questions', () => {
    const text = textOf(render())

    expect(text).toContain('Is this real, and who holds the money?')
    expect(text).toContain('Two different questions.')
    expect(text).toContain(
      'Isipheko never receives it, never holds it, and cannot refund it.',
    )
  })

  it('promises nothing about protecting or returning the money', () => {
    const text = textOf(render()).toLowerCase()

    expect(text).not.toContain('we hold')
    expect(text).not.toContain('held safely')
    expect(text).not.toContain('protected')
    expect(text).not.toContain('guarantee')
    expect(text).not.toContain('escrow')
    expect(text).not.toMatch(/\bwe (can )?refund/)
  })

  it('names what we do give, which is a record and not a promise', () => {
    const text = textOf(render())

    expect(text).toContain('Three things that an envelope on a desk does not')
    expect(text).toContain('which she cannot quietly change')
  })
})

describe('the verified line', () => {
  it('is stated as fact when it is one', () => {
    // A page somebody can reach implies a verified organiser — that is what
    // the share gate means (rule 13) — so this is never hedged.
    expect(textOf(render())).toContain('ID verified 12 July')
  })

  it('is absent rather than softened when nothing was checked', () => {
    const text = textOf(render({ organiserVerifiedAt: null }))

    expect(text).toContain('Held by Nomsa Mthembu')
    expect(text.toLowerCase()).not.toContain('verified')
    // No "verification is coming" wording anywhere (M1-08 §5).
    expect(text.toLowerCase()).not.toContain('coming')
    expect(text.toLowerCase()).not.toContain('not switched on')
  })
})

describe('the roster', () => {
  it('shows what each person put in, because the total has to add up for them', () => {
    const text = textOf(render())

    expect(text).toContain('R800')
    expect(text).toContain('R700')
    expect(text).toContain('R1 900')
  })

  it('withholds a quiet member’s name and keeps their amount', () => {
    const text = textOf(render())

    // Quiet from the wider world, not from the eight cousins: hiding the
    // amount as well would make the group's own total unauditable to them.
    expect(text).toContain('Someone')
    expect(text).toContain('R400')
  })

  it('says when somebody has not been marked off, rather than quietly omitting them', () => {
    const text = textOf(
      render({
        roster: [
          ...COLLECTION.roster,
          {
            id: 'm4',
            name: 'Xolani Cele',
            amountCents: 25_000n,
            status: 'pending',
            joinedAt: new Date('2026-07-16T00:00:00.000Z'),
          },
        ],
      }),
    )

    expect(text).toContain('Xolani Cele')
    expect(text).toContain('Not marked off yet')
    // The note explains why four names do not add up to the total.
    expect(text).toContain('4 people · 3 marked off so far')
  })
})

describe('what the page does not compute', () => {
  it('states no shortfall against an item cost', () => {
    // The design says "still R300 short". A need item carries the organiser's
    // free text — "Around R1 200 to hire" — rather than a number (M1-07 §3),
    // and telling a group they are short when they are not is the failure that
    // parsing prose would buy. See docs/decisions.md M2-10.
    const text = textOf(
      render({ needItem: { id: 'item-1', label: 'Tent' } }),
    ).toLowerCase()

    expect(text).not.toMatch(/r\s?[\d\s]+short/)
    expect(text).not.toContain('short of')
    expect(text).not.toContain('still needed')
    expect(text).not.toContain('not covered')
    /*
     * And the only money on the page is what the group has actually put in:
     * one running total plus one line per member. An item's cost or a gap
     * would be a fifth amount, which is what this counts.
     */
    const markup = render({ needItem: { id: 'item-1', label: 'Tent' } })
    const amounts = markup.match(/>R[\d\s]+</g) ?? []
    expect(amounts).toHaveLength(COLLECTION.roster.length + 1)
  })

  it('shows no target, no progress bar and no countdown on a bereavement page', () => {
    const markup = render({ needItem: { id: 'item-1', label: 'Tent' } })

    expect(markup).not.toContain('<progress')
    expect(markup).not.toContain('<meter')
    expect(textOf(markup).toLowerCase()).not.toContain('goal')
    expect(textOf(markup).toLowerCase()).not.toContain('target')
  })

  it('names no colour, because the accent arrives by falling back', () => {
    // Bereavement declares none, so `var(--accent, #16233d)` renders indigo
    // with nothing asking what occasion this is (rule 2).
    expect(render()).not.toMatch(/style="[^"]*--accent/)
  })
})

describe('joining', () => {
  const join = (step: 'amount' | 'who' | 'hand' | 'done') =>
    renderToStaticMarkup(
      <CollectionJoinPage
        slug="AbCdEf0123456789"
        collectionTitle="The Ngcobo cousins"
        organiserName="Nomsa Mthembu"
        bankHint="Nomsa's Capitec, ending 4471"
        archetype={ARCHETYPES.umngcwabo}
        step={step}
        carried={{}}
      />,
    )

  it('asks for no account, on any step', () => {
    // Rule 4. The same property M2-05 asserts for the contribution flow.
    for (const step of JOIN_STEPS) {
      const markup = join(step)

      expect(markup, step).not.toContain('type="password"')
      expect(markup, step).not.toContain('type="email"')
      expect(markup.toLowerCase(), step).not.toContain('sign up')
      expect(markup.toLowerCase(), step).not.toContain('signup')
      expect(markup.toLowerCase(), step).not.toContain('create an account')
    }
  })

  it('works with no script: every step is a form post', () => {
    for (const step of ['amount', 'who', 'hand'] as const) {
      expect(join(step), step).toContain('method="post"')
      expect(join(step), step).not.toContain('onclick')
    }
  })

  it('says where the money goes before asking anybody to send it', () => {
    const text = textOf(join('hand'))

    expect(text).toContain("Nomsa's Capitec, ending 4471")
    expect(text).toContain('she is collecting it herself')
    expect(text).toContain('Isipheko does not take it and cannot pass it on for you')
  })

  it('refuses to point anywhere when she has not said where', () => {
    const markup = renderToStaticMarkup(
      <CollectionJoinPage
        slug="AbCdEf0123456789"
        collectionTitle="The Ngcobo cousins"
        organiserName="Nomsa Mthembu"
        bankHint={null}
        archetype={ARCHETYPES.umngcwabo}
        step="hand"
        carried={{}}
      />,
    )

    // A blank where a payment destination belongs is how somebody pays the
    // wrong person (M2-05 §1, same reasoning).
    expect(textOf(markup)).toContain('has not said where to send it yet')
  })

  it('keeps the group able to see the amount even when the name is withheld', () => {
    expect(textOf(join('who'))).toContain('The group always sees the amount')
  })
})
