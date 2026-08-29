import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ARCHETYPES } from '@/domain/archetype'
import { fromCents } from '@/domain/money'
import { payoutConditions } from '@/domain/payout'
import { MoneySection } from '@/app/(organiser)/manage/[id]/money'
import { ContributePage } from '@/ui/contribute-page'
import { PublicEventPage } from '@/ui/public-page'

/**
 * M5-13 — the scan that stops the sixth one.
 *
 * ## What this exists for
 *
 * Five strings have been wrong in the same way, found one at a time, by five
 * separate readings, months apart:
 *
 * | String | Claimed | Fixed |
 * |---|---|---|
 * | `dashboard.money.intro` | *"already in your own account"* | M5-03 §7 |
 * | `dashboard.money.raisedNote` | *"confirmed by you"* | M5-03 §10 |
 * | `dashboard.money.available` | *"Settled"* | M5-08 |
 * | `dashboard.money.settlingNote` | *"Everything older is settled"* | M5-08 |
 * | `event.trust.moneyBody` | *"Nothing on this page can take money from you yet"* | M5-02b |
 *
 * Every one was true when it was written, was made false by M5-02 building a
 * checkout, and was found by somebody reading rather than by anything failing.
 * The last of them had been named in writing as *"the most dangerous string in
 * the change"* before the change that made it untrue was merged, and it was
 * merged anyway. **Careful reading is demonstrably not the control.**
 *
 * ## Why it scans the render and not `src/copy/`
 *
 * The forbidden sentences are not forbidden. *"People pay you directly, so this
 * money is already in your own account"* is the plain truth of a ledger-only
 * event and must stay exactly as it is. What is forbidden is **rendering one of
 * them on a hosted event**, which is what every instance above actually was.
 *
 * So this renders each hosted surface and reads what a person would see. A
 * source scan would have to allow every one of these strings to exist, which
 * would leave it asserting nothing.
 *
 * ## Adding a surface
 *
 * If a screen becomes reachable on a hosted event, add it to `SURFACES`. A
 * surface nobody added is a surface this test cannot see, which is the one way
 * it can quietly stop working — hence `covers the surfaces it claims to`.
 */

const EVENT = {
  id: 'evt',
  slug: 'AbCdEf0123456789',
  reference: { prefix: 'MTH', code: '4K7B2X' },
  archetype: 'umshado' as const,
  title: 'Nomsa and Sipho',
  subtitle: null,
  place: 'KwaMashu',
  eventDate: new Date('2026-09-12T00:00:00.000Z'),
  organiserName: 'Nomsa Mthembu',
  organiserVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
  witnesses: ['Thandi Ngcobo'],
  needs: [],
  mode: 'hosted' as const,
}

const CONTRIBUTE_STEPS = ['choose', 'amount', 'who', 'pay', 'done'] as const

function contributeStep(step: (typeof CONTRIBUTE_STEPS)[number]): string {
  return renderToStaticMarkup(
    <ContributePage
      slug={EVENT.slug}
      eventTitle={EVENT.title}
      organiserName={EVENT.organiserName}
      verifiedOn="12 August"
      archetype={ARCHETYPES.umshado}
      route="money"
      step={step}
      amountsPublic
      carried={{ amount: '500' }}
      needs={[]}
      reference="MTH-4K7B2X"
      mode="hosted"
      beneficiary="ben_1"
      paymentConfirmed={step === 'done' ? true : undefined}
      defaultVisibility="public"
    />,
  )
}

function moneySection(): string {
  return renderToStaticMarkup(
    <MoneySection
      facts={{
        mode: 'hosted',
        balance: {
          raised: fromCents(47_800_00n),
          settling: fromCents(3_200_00n),
          available: fromCents(44_600_00n),
          clearsAt: new Date('2026-08-20T09:14:00.000Z'),
        },
        conditions: payoutConditions({
          identityVerified: true,
          bankVerified: false,
          settling: fromCents(3_200_00n),
          available: fromCents(44_600_00n),
          witnessApproved: false,
        }),
        confirmedCount: 41,
        verifiedOn: new Date('2026-07-12T00:00:00.000Z'),
        witnessName: 'Sipho Mthembu',
        hasInKind: true,
      }}
    />,
  )
}

/** The inlined stylesheet mentions every token and is not prose. */
const withoutStyles = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/g, '')

const SURFACES: readonly { name: string; markup: string }[] = [
  {
    name: 'the public event page',
    markup: withoutStyles(
      renderToStaticMarkup(
        <PublicEventPage event={EVENT} archetype={ARCHETYPES.umshado} />,
      ),
    ),
  },
  ...CONTRIBUTE_STEPS.map((step) => ({
    name: `the contribute flow · ${step}`,
    markup: withoutStyles(contributeStep(step)),
  })),
  { name: 'the dashboard money section', markup: moneySection() },
]

describe('nothing reachable on a hosted event claims what is only true of Mode A', () => {
  it('covers the surfaces it claims to', () => {
    // Seven: the event page, five contribution steps, the money section. A
    // surface dropped from the list is a surface this file stops watching.
    expect(SURFACES).toHaveLength(7)
    for (const { name, markup } of SURFACES) {
      expect(markup.length, name).toBeGreaterThan(500)
    }
  })

  it('never says the contributor pays the organiser directly', () => {
    /*
     * On a hosted event the contributor pays on the page and the money goes to
     * the family through a provider. Every phrasing below was, or is, live copy
     * that is true of a ledger-only event and false here.
     */
    const DIRECT = [
      /already in your own account/i,
      /pay you directly/i,
      /you send it yourself/i,
      /nothing is taken from you here/i,
      /from your own (banking )?app/i,
      /against your own bank message/i,
    ]

    for (const { name, markup } of SURFACES) {
      for (const pattern of DIRECT) {
        expect(markup, `${name} · ${String(pattern)}`).not.toMatch(pattern)
      }
    }
  })

  it('never says the page cannot take money', () => {
    // M5-02b. It could, from the page this sentence was printed on.
    for (const { name, markup } of SURFACES) {
      expect(markup, name).not.toMatch(/can(not|'t)? take money from you yet/i)
      expect(markup, name).not.toMatch(/when contributing opens/i)
    }
  })

  it('never calls money settled, which is a claim about a bank', () => {
    /*
     * M5-08, and **the pattern that was missing when this file was first
     * written**. Reintroducing `available`'s *"Settled"* label failed only the
     * positive assertion at the bottom of this file, and reintroducing
     * `settlingNote`'s *"Everything older is settled"* failed nothing at all —
     * which is the precise failure this whole file exists to prevent, found by
     * running the reintroduction rather than by trusting the list.
     *
     * On a hosted event *settled* is heard as *in your bank*, and nothing has
     * been paid to anybody's bank (M5-03 §5). The label and the sentence are
     * matched separately because they are two different shapes of the claim.
     *
     * **Scoped by subject, not by the word.** `board.intro` says *"3 of the 8
     * things on your list are settled"*, which is a need item having arrived
     * and is nothing to do with money. If the needs board ever joins `SURFACES`
     * that sentence must keep working.
     */
    const SETTLED = [
      />\s*Settled\s*</,
      /(everything older|the rest|money|payment|amount|balance|it)\s+(is|are|was|were)\s+settled/i,
    ]

    for (const { name, markup } of SURFACES) {
      for (const pattern of SETTLED) {
        expect(markup, `${name} · ${String(pattern)}`).not.toMatch(pattern)
      }
    }
  })

  it('never credits the organiser with a confirmation the payment made', () => {
    // M5-03 §10. A hosted contribution never reaches her queue (M5-03 §8), so
    // she could not have confirmed it even if she had wanted to.
    for (const { name, markup } of SURFACES) {
      expect(markup, name).not.toMatch(/confirmed by you/i)
    }
  })

  it('never claims Isipheko holds the money', () => {
    /*
     * The prototype's *"a held Isipheko account"* has been refused three times
     * — M1-08 §5, M3-08 §2, M5-02b §4 — and a hosted checkout is the moment it
     * finally sounds plausible. It is not: the funds sit with the payment
     * service, allocated to the family, and never with us.
     *
     * The same scan `collection-page.test.tsx:110` runs, on the surfaces that
     * can now take a card.
     */
    const CUSTODY = [
      /held (isipheko|safely)/i,
      /isipheko (holds|is holding|keeps)/i,
      /we (hold|are holding) (your|the|this) money/i,
      /\bescrow\b/i,
      /held account/i,
    ]

    for (const { name, markup } of SURFACES) {
      for (const pattern of CUSTODY) {
        expect(markup, `${name} · ${String(pattern)}`).not.toMatch(pattern)
      }
    }
  })

  it('promises no settlement timetable, anywhere', () => {
    /*
     * How a settlement is released and when it lands is unanswered in both
     * directions (docs/paystack-analysis.md §1.3, docs/remaining-work.md A1),
     * and ZA settlement is two working days rather than the T+1 the API
     * documentation describes. Any number here would be invented, in front of
     * the person with the least ability to check it.
     *
     * **Every pattern is scoped to money**, and the first draft was not. A bare
     * *"within one working day"* matched `event.trust.wrongBody` — M3-06's
     * promise that a person will look at a reported page — which is a
     * commitment we make about ourselves and can keep. So is the 72-hour hold:
     * a window in which a payment can still be reversed is a fact about our own
     * record rather than about a bank's timetable. Neither is forbidden and
     * neither may be broken by this test.
     */
    const DURATION = String.raw`(one|two|three|a few|\d+) (working )?(day|hour)s?`
    const MONEY = String.raw`(paid|payout|payment|money|settle\w*|transfer\w*)`

    const TIMETABLE = [
      /\bT\+\d\b/,
      new RegExp(`${MONEY}[^.]{0,80}\\b(within|in|after) ${DURATION}`, 'i'),
      new RegExp(`\\b(within|in|after) ${DURATION}[^.]{0,80}${MONEY}`, 'i'),
      /paid out (the )?same day/i,
      /(reaches|reach|arrives in|lands in) (you|your bank|your account)/i,
      /instantly/i,
    ]

    for (const { name, markup } of SURFACES) {
      for (const pattern of TIMETABLE) {
        expect(markup, `${name} · ${String(pattern)}`).not.toMatch(pattern)
      }
    }
  })

  it('says nothing has been paid out, because nothing has', () => {
    /*
     * The positive half, and the reason this file is not only a list of
     * absences. `payouts` is empty and stays empty until M5-09 (M5-03 §5), so
     * the money section must say where the money still is rather than leaving a
     * figure to be read as an arrival.
     */
    expect(moneySection()).toContain('nothing has been paid out to your bank yet')
  })
})
