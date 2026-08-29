import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { checkCopy } from '@/copy/check'
import { collectionCopy } from '@/copy/collection'
import { eventCopy } from '@/copy/event'
import { ARCHETYPES } from '@/domain/archetype'
import { ContributePage } from '@/ui/contribute-page'
import { PublicEventPage } from '@/ui/public-page'
import { CheckPage } from '@/ui/check-page'

/**
 * *"Is this real?"* — M3-04's two done-criteria.
 *
 * **Present on every event page**, which is not only `/e/[slug]`: somebody in
 * the middle of contributing has navigated away from the panel and is looking
 * at a phone number they are about to pay, which is the moment it is most for.
 *
 * **No self-referential verification route anywhere in the copy.** That is a
 * property of every string in `src/copy/`, not of one panel, so it is scanned
 * rather than eyeballed — a phone number added to a reassuring sentence six
 * months from now would be the exact failure the rule exists for.
 */

const EVENT = {
  id: 'evt',
  slug: 'AbCdEf0123456789',
  reference: { prefix: 'MTH', code: '4K7B2X' },
  archetype: 'umngcwabo' as const,
  title: 'Nokuthula Mthembu',
  subtitle: 'uMaZondi',
  place: 'KwaMashu',
  eventDate: new Date('2026-08-15T00:00:00.000Z'),
  organiserName: 'Nomsa Mthembu',
  organiserVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
  witnesses: ['Thandi Ngcobo'],
  needs: [],
  mode: 'ledger_only' as const,
}

/** The inlined stylesheet is shared and mentions every token; scans want the page. */
function withoutStyles(markup: string): string {
  return markup.replace(/<style[\s\S]*?<\/style>/g, '')
}

function eventPage(mode: 'ledger_only' | 'hosted' = 'ledger_only'): string {
  return renderToStaticMarkup(
    <PublicEventPage event={{ ...EVENT, mode }} archetype={ARCHETYPES.umngcwabo} />,
  )
}

function contributePage(step: 'choose' | 'pay' = 'pay'): string {
  return renderToStaticMarkup(
    <ContributePage
      slug={EVENT.slug}
      eventTitle={EVENT.title}
      organiserName={EVENT.organiserName}
      verifiedOn="12 August"
      archetype={ARCHETYPES.umngcwabo}
      route="money"
      step={step}
      amountsPublic={false}
      carried={{}}
      needs={[]}
      reference="MTH-4K7B2X"
      payDetails={{ phone: '082 123 4567', name: 'Nomsa Mthembu' }}
      mode="ledger_only"
      defaultVisibility="name_only"
    />,
  )
}

describe('the panel is on every page somebody is asked for something', () => {
  it('is on the event page, with both anchor sentences verbatim', () => {
    const markup = eventPage()

    expect(markup).toContain('Is this real?')
    expect(markup).toContain(
      'Do not use a number on this page. If the page were fake, the number would be too.',
    )
    expect(markup).toContain(
      'It confirms who the organiser is. It does not, on its own, confirm the ceremony.',
    )
  })

  it('travels into the contribution flow, on every step', () => {
    for (const step of ['choose', 'pay'] as const) {
      const markup = contributePage(step)

      expect(markup, step).toContain('Not sure this is real?')
      expect(markup, step).toContain(
        'Do not use a number on this page. If the page were fake, the number would be too.',
      )
      expect(markup, step).toContain('isipheko.co.za/check')
    }
  })

  it('carries the badge into the flow too, now that there is one', () => {
    // Absent until M3-04, with a comment saying nothing had been checked —
    // true at M2-05 and false since M3-02.
    expect(contributePage()).toContain('ID verified 12 August')
  })

  it('is on the collection page, which answers two questions rather than one', () => {
    // *"Is this real, and who holds the money?"* — the second half is the one
    // that matters there, because she holds it and we never do (M2-10 §1).
    expect(collectionCopy.page.trustHeading).toContain('Is this real')
    expect(collectionCopy.page.occasionBody('MTH-4K7B2X')).toContain(
      'Do not use a number on this page',
    )
  })
})

describe('what the panel says this page can do with money', () => {
  /*
   * M5-02b. The panel said *"Nothing on this page can take money from you yet"*
   * on every event, and M5-02 built a checkout reachable from that same page.
   * This is the panel a stranger reads to decide whether the page is a scam,
   * one screen before the one that takes the money — so being wrong here is
   * worse than being wrong on the dashboard, where the reader is the person who
   * set the page up.
   */

  it('says nothing can be taken, on a ledger-only event, where that is true', () => {
    const markup = eventPage('ledger_only')

    expect(markup).toContain('Nothing on this page can take money from you yet')
  })

  it('does not say it on a hosted event, where it is false', () => {
    const markup = eventPage('hosted')

    expect(markup).not.toContain('Nothing on this page can take money from you yet')
    expect(markup).not.toContain('When contributing opens')
  })

  it('says where the money goes instead, and who does not hold it', () => {
    const markup = eventPage('hosted')

    expect(markup).toContain('the family’s own bank account')
    expect(markup).toContain('Isipheko never holds it')
  })

  it('promises no timetable on either variant', () => {
    // When a settlement reaches the family is unanswered (remaining-work A1).
    // A page saying "within two days" would be inventing one, and it would be
    // read by the person with the least ability to check it.
    const WHEN =
      /\b(within|in)\s+(a\s+few|one|two|three|\d+)\s+(second|minute|hour|working\s+day|day)/i

    for (const mode of ['ledger_only', 'hosted'] as const) {
      expect(eventCopy.trust.moneyBody, mode).not.toMatch(WHEN)
      expect(eventCopy.trust.moneyBodyHosted, mode).not.toMatch(WHEN)
    }
  })

  it('changes nothing else on the page between the two modes', () => {
    // The mutation check for this task's guard. If the branch is widened later
    // — a second sentence, a different panel, a badge — this fails and says so.
    const difference = (a: string, b: string) =>
      a.split(/(?<=>)/).filter((chunk) => !b.includes(chunk))

    const ledgerOnly = withoutStyles(eventPage('ledger_only'))
    const hosted = withoutStyles(eventPage('hosted'))

    expect(difference(ledgerOnly, hosted)).toHaveLength(1)
    expect(difference(hosted, ledgerOnly)).toHaveLength(1)
  })
})

describe('it is not styled as a warning', () => {
  it('carries no alert role', () => {
    // `role="alert"` is for something that has just gone wrong. This panel is
    // permanent: it is on a page where everything is fine, and an alarm that is
    // always sounding is an alarm nobody hears.
    const markup = withoutStyles(eventPage()) + withoutStyles(contributePage())

    expect(markup).not.toMatch(/class="(trust|stillReal)"[^>]*role="alert"/)
    for (const word of ['warning', 'danger', 'caution', '⚠']) {
      expect(markup.toLowerCase()).not.toContain(word)
    }
  })

  it('is drawn in paper and ink, with no colour of its own', async () => {
    // There is no error colour in the palette and this is not the place to
    // invent one (M1-05 §4). Both panels take the same background and rule as
    // the rest of the page.
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')

    const css = readFileSync(
      fileURLToPath(new URL('../../src/ui/public-page-css.ts', import.meta.url)),
      'utf8',
    )

    for (const selector of ['.trust {', '.stillReal {']) {
      const block = css.slice(
        css.indexOf(selector),
        css.indexOf('}', css.indexOf(selector)),
      )

      expect(block, selector).toContain('var(--paper-raised)')
      expect(block, selector).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(block, selector).not.toContain('--accent')
    }
  })

  it('asks the question rather than issuing an instruction', () => {
    expect(eventCopy.trust.heading).toBe('Is this real?')
    expect(eventCopy.trust.intro).toContain('A fair question')
    expect(eventCopy.safety.stillReal).toContain('?')
  })
})

describe('the link to /check', () => {
  it('sits under the instruction, never instead of it', () => {
    const markup = eventPage()

    const instruction = markup.indexOf('Do not tap a link to get there')
    const link = markup.indexOf('href="/check"')

    expect(instruction).toBeGreaterThan(-1)
    expect(link).toBeGreaterThan(instruction)
  })

  it('is labelled with the address, so the label teaches the real shape', () => {
    // "Check this event" would tell somebody nothing about what a genuine
    // address looks like. This is the thing that helps them spot a fake later.
    expect(eventCopy.trust.yourselfCheckLink).toBe('isipheko.co.za/check')
    expect(eventPage()).toContain('>isipheko.co.za/check</a>')
  })

  it('sends no referrer, so the answer stays independent of the page', () => {
    expect(eventPage()).toMatch(/href="\/check"[^>]*rel="noreferrer"/)
    expect(contributePage()).toMatch(/href="\/check"[^>]*rel="noreferrer"/)
  })
})

describe('/check itself', () => {
  it('offers no way back to the umcimbi it just answered about', () => {
    // An answer that opened the page would let a fake link use this as a step
    // on the way, and the answer has to be able to stand on its own.
    const markup = renderToStaticMarkup(
      <CheckPage
        state="found"
        typed="MTH-4K7B2X"
        result={{
          title: 'Nokuthula Mthembu',
          organiserName: 'Nomsa Mthembu',
          verifiedAt: new Date('2026-08-12T00:00:00.000Z'),
          reference: 'MTH-4K7B2X',
        }}
        verifiedOn="12 August"
      />,
    )

    expect(markup).not.toContain('/e/')
    expect(markup).not.toMatch(/<a [^>]*href="(?!\/check)/)
  })

  it('wears no archetype, because it is not the umcimbi speaking', () => {
    // An answer *about* a page must not arrive dressed in that page's colours.
    // The stylesheet is shared and full of `var(--accent, …)`; what matters is
    // that nothing declares one, so the fallback indigo renders (rule 2).
    const markup = withoutStyles(renderToStaticMarkup(<CheckPage state="asking" />))

    expect(markup).not.toContain('data-archetype')
    expect(markup).not.toContain('--accent')
  })

  it('repeats the limit of what a check means, in the same words', () => {
    expect(checkCopy.found.limit).toBe(eventCopy.trust.checkedNote)
  })

  it('does not distinguish a wrong code from a page nobody has shared', () => {
    // Otherwise it becomes the one way to discover that a draft exists.
    expect(checkCopy.notFound.orNotShared).toContain('has not been shared yet')
  })
})

describe('nothing anywhere tells somebody to verify a page using the page', () => {
  it('offers nobody a number to ring, in any copy file', async () => {
    // The done-criterion, as a property of all copy rather than of one panel.
    //
    // A phone-shaped string is not itself the failure — `auth.ts` shows
    // `082 123 4567` as the shape of the field, which is a placeholder and not
    // somebody to call. What is forbidden is a number offered as a way to
    // check, and any instruction to ring us at all: we publish no number, so a
    // number in this product's voice is a number somebody else put there.
    const { readdirSync, readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')

    const dir = fileURLToPath(new URL('../../src/copy', import.meta.url))
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts'))

    expect(files.length).toBeGreaterThan(8)

    const REACH_US = /(call|phone|ring|dial|contact)\s+(us|isipheko|our|the number)/i
    const TOLL_FREE = /\b08[0-9]{2}[\s-]?[0-9]{3}[\s-]?[0-9]{3}\b/
    const INTERNATIONAL = /\+27[\s-]?[0-9]{2}[\s-]?[0-9]{3}/

    for (const name of files) {
      const text = readFileSync(`${dir}/${name}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

      expect(text, name).not.toMatch(REACH_US)
      expect(text, name).not.toMatch(TOLL_FREE)
      expect(text, name).not.toMatch(INTERNATIONAL)
    }
  })

  it('sends anybody checking to a route they type themselves', () => {
    for (const line of [
      eventCopy.trust.yourselfCheck('MTH-4K7B2X'),
      eventCopy.safety.stillRealBody,
      collectionCopy.page.occasionBody('MTH-4K7B2X'),
    ]) {
      expect(line).toContain('isipheko.co.za/check')
      expect(line.toLowerCase()).toContain('yourself')
    }
  })

  it('says not to use a number on the page, on every surface that says anything', () => {
    // On the event page it is the intro to the list; in the flow and on a
    // collection it is folded into the one sentence there is room for. Every
    // surface carries it somewhere.
    const notTheNumber = 'Do not use a number on this page'

    expect(eventCopy.trust.yourselfIntro).toContain(notTheNumber)
    expect(eventCopy.safety.stillRealBody).toContain(notTheNumber)
    expect(collectionCopy.page.occasionBody('MTH-4K7B2X')).toContain(notTheNumber)
    expect(collectionCopy.page.occasionBodyNoCode).toContain(notTheNumber)
  })

  it('offers the report channel, and still no payment hold', () => {
    // The prototype's sentence had two halves. M3-06 made the first true and
    // restored it with the window on it; the second stays out, because no
    // payment passes through us to hold (Mode A).
    const wrong = eventCopy.trust.wrongBody

    expect(wrong).not.toContain('we will hold every payment')
    expect(wrong).not.toContain('no way to report a page to us yet')
    expect(wrong).toContain('do not give anything')
    expect(wrong).toContain('type isipheko.co.za/report into your browser yourself')
    expect(wrong).toContain('within one working day')
  })
})
