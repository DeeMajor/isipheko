import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { dashboardCopy } from '@/copy/dashboard'
import type { PendingReport } from '@/db/repositories/contribution'
import type { AwaitedDelivery, OrganiserBoard } from '@/db/repositories/needs'
import { fromCents } from '@/domain/money'
import { payoutConditions } from '@/domain/payout'
import { MoneySection } from '@/app/(organiser)/manage/[id]/money'
import { ConfirmationQueue, buildQueue } from '@/app/(organiser)/manage/[id]/queue'
import { NeedsBoard } from '@/app/(organiser)/manage/[id]/board'

/**
 * The organiser's dashboard (M3-08), at the two things the done-criterion is
 * really about.
 *
 * **Confirm and mark-delivered are the two easiest actions on the page.** Which
 * means one queue rather than two lists, both actions in it, both as plain
 * forms, and nothing above them.
 *
 * **No figure is presented as money we hold.** `design/dashboard.html` renders
 * *"Ready to pay out now"* above a **Request** button; both are Mode B and are
 * not built. This is the screen where an organiser might act on a number, so
 * the absence is asserted rather than trusted — the same posture as M1-08 §5,
 * whose two untrue prototype strings are tested the same way.
 */

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

/**
 * Comments explain why a thing is absent; they are not the thing.
 *
 * Without this the scans below fail on their own explanations — the CSS says
 * "no progress bar, no countdown" and the page says why the design's countdown
 * is not shipped. Same treatment as `auth-no-code-in-logs`.
 */
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const NOW = new Date('2026-08-18T09:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000)

const report = (over: Partial<PendingReport> = {}): PendingReport => ({
  id: 'c1',
  contributorName: 'Thandi Ngcobo',
  amountCents: 500_00n,
  type: 'cash',
  message: null,
  photoKey: null,
  reference: 'MTH-4K7B2X',
  selfReportedAt: hoursAgo(2),
  ...over,
})

const arrival = (over: Partial<AwaitedDelivery> = {}): AwaitedDelivery => ({
  claimId: 'k1',
  label: 'Tent',
  quantity: 1,
  claimantName: 'Musa Khumalo',
  claimedAt: hoursAgo(20),
  ...over,
})

const EMPTY_BOARD: OrganiserBoard = {
  open: [],
  promised: [],
  arrived: [],
  suggested: [],
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  label: 'Chairs',
  note: null,
  claimantName: null,
  claimId: null,
  quantityRequired: 1,
  quantityClaimed: 0,
  remaining: 1,
  deliveredAt: null,
  ...over,
})

const moneyFacts = (over: Record<string, unknown> = {}) => ({
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
  ...over,
})

describe('the confirmation queue', () => {
  it('is one list carrying both kinds of thing', () => {
    /*
     * The M2-05 stub had two cards. Two lists means the second is below the
     * first, and on a phone that means somebody with three tents waiting
     * scrolls past six payments to reach them.
     */
    const rows = buildQueue([report()], [arrival()])

    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['payment', 'delivery']))
  })

  it('puts the person who has waited longest first, whichever kind they are', () => {
    const rows = buildQueue(
      [report({ id: 'new', selfReportedAt: hoursAgo(1) })],
      [arrival({ claimId: 'old', claimedAt: hoursAgo(48) })],
    )

    expect(rows.map((r) => r.key)).toEqual(['delivery:old', 'payment:new'])
  })

  it('gives every row exactly one primary action, as a plain form', () => {
    // Rule 5's posture on the organiser side: the two most important actions of
    // her day work with JavaScript switched off.
    const markup = renderToStaticMarkup(
      <ConfirmationQueue eventId="e1" slug="mthembu" rows={buildQueue([report()], [arrival()])} />,
    )

    expect(markup.match(/<form/g)).toHaveLength(2)
    // The rendered markup escapes the apostrophe in "it's", so the assertion
    // is on the half of each label that survives entity-encoding.
    expect(markup).toContain('in my account')
    expect(markup).toContain(dashboardCopy.queue.confirmDelivery)
    expect(markup).not.toContain('onclick')
  })

  it('tells her what to look for in her own banking app', () => {
    // Mode A has no payment rail: the page knows only what somebody typed into
    // it, and she is the one who checks. A statement-shaped name is what makes
    // that comparison quick.
    const markup = renderToStaticMarkup(
      <ConfirmationQueue eventId="e1" slug="mthembu" rows={buildQueue([report()], [])} />,
    )

    expect(markup).toContain('T NGCOBO')
    expect(markup).toContain('MTH-4K7B2X')
    expect(markup).toContain('R500,00')
  })

  it('says there is no unconfirm before the tap rather than after it', () => {
    const markup = renderToStaticMarkup(
      <ConfirmationQueue eventId="e1" slug="mthembu" rows={buildQueue([report()], [])} />,
    )

    expect(markup).toContain('not by rubbing it out')
  })

  it('invites nothing when there is nothing waiting', () => {
    const markup = renderToStaticMarkup(<ConfirmationQueue eventId="e1" slug="mthembu" rows={[]} />)

    expect(markup).toContain(dashboardCopy.queue.empty.heading)
    expect(markup).toContain('put the phone down')
    expect(markup).not.toContain('<form')
  })
})

describe('the needs board from her side', () => {
  it('separates claimed-not-delivered from unclaimed', () => {
    // The distinction the public board does not make, and the only one she can
    // act on: an item fully claimed and undelivered is invisible there and is
    // precisely the thing that does not arrive.
    const markup = renderToStaticMarkup(
      <NeedsBoard
        eventId="e1"
        board={{
          ...EMPTY_BOARD,
          open: [row({ id: 'transport', label: 'Transport' })],
          promised: [
            row({ id: 'chairs', label: 'Chairs', claimId: 'k1', claimantName: 'Zanele' }),
          ],
        }}
      />,
    )

    expect(markup).toContain(dashboardCopy.board.open.title)
    expect(markup).toContain(dashboardCopy.board.promised.title)
    expect(markup).toContain('Promised by Zanele')
  })

  it('offers mark-as-arrived only on things somebody is holding', () => {
    const promisedOnly = renderToStaticMarkup(
      <NeedsBoard
        eventId="e1"
        board={{
          ...EMPTY_BOARD,
          open: [row({ id: 'transport' })],
          promised: [row({ id: 'chairs', claimId: 'k1', claimantName: 'Zanele' })],
        }}
      />,
    )

    expect(promisedOnly.match(/Mark as arrived/g)).toHaveLength(1)
  })

  it('surfaces suggestions, which nothing could reach until now', () => {
    /*
     * `suggestItem` and its two answers were built and tested in M2-04 with no
     * screen anywhere: a contributor could tell the family they had forgotten
     * something and no organiser could ever see it.
     */
    const markup = renderToStaticMarkup(
      <NeedsBoard
        eventId="e1"
        board={{
          ...EMPTY_BOARD,
          suggested: [row({ id: 's1', label: 'Ice', claimantName: 'MaDlamini' })],
        }}
      />,
    )

    expect(markup).toContain(dashboardCopy.board.suggested.title)
    expect(markup).toContain('Suggested by MaDlamini')
    expect(markup).toContain(dashboardCopy.board.addToList)
    expect(markup).toContain(dashboardCopy.board.leaveOff)
  })

  it('says a suggestion is invisible to everyone until she answers', () => {
    const markup = renderToStaticMarkup(
      <NeedsBoard
        eventId="e1"
        board={{ ...EMPTY_BOARD, suggested: [row({ id: 's1' })] }}
      />,
    )

    expect(markup).toContain('not shown to anybody else until then')
  })

  it('invites an action on an empty list rather than showing a blank', () => {
    const markup = renderToStaticMarkup(<NeedsBoard eventId="e1" board={EMPTY_BOARD} />)

    expect(markup).toContain('add what the family needs')
  })
})

describe('the money, and what it must never say', () => {
  it('says plainly that the money is already hers', () => {
    // The most important sentence on the screen. The design says it sits in a
    // held Isipheko account; under Mode A the contributor paid her directly.
    const markup = renderToStaticMarkup(<MoneySection facts={moneyFacts()} />)

    expect(markup).toContain('already in your own account')
  })

  it('offers no way to request a payout', () => {
    const markup = renderToStaticMarkup(<MoneySection facts={moneyFacts()} />)

    expect(markup.toLowerCase()).not.toContain('request')
    expect(markup).not.toContain('Ready to pay out')
    expect(markup).not.toContain('Take the money out now')
  })

  it('never labels an amount as available to pay out', () => {
    /*
     * `available` is the domain's word for *not fenced by the hold*. On screen
     * it is "Settled", because an organiser who read "available" and made a
     * promise on the strength of it would have been failed in a way an apology
     * does not fix.
     */
    const markup = renderToStaticMarkup(<MoneySection facts={moneyFacts()} />)

    expect(markup).toContain(dashboardCopy.money.available)
    expect(markup.toLowerCase()).not.toMatch(/available (to|for) (pay|withdraw)/)
    expect(markup.toLowerCase()).not.toContain('ready to pay')
  })

  it('shows all three figures, and the hold as the middle one', () => {
    const markup = renderToStaticMarkup(<MoneySection facts={moneyFacts()} />)

    expect(markup).toContain('R47 800,00')
    expect(markup).toContain('R3 200,00')
    expect(markup).toContain('R44 600,00')
  })

  it('leaves what people brought out of the money, and says why', () => {
    const markup = renderToStaticMarkup(<MoneySection facts={moneyFacts()} />)

    expect(markup).toContain(dashboardCopy.money.inKindNote)
  })
})

describe('the payout conditions', () => {
  it('gives every unmet one a concrete next step', () => {
    /*
     * The done-criterion, asserted over every combination of facts rather than
     * on one screenshot: whatever is unmet, the words for the next step are on
     * the page.
     */
    const cases = [
      { identityVerified: false, bankVerified: false, witnessApproved: false },
      { identityVerified: true, bankVerified: false, witnessApproved: false },
      { identityVerified: true, bankVerified: true, witnessApproved: false },
    ]

    for (const facts of cases) {
      const conditions = payoutConditions({
        ...facts,
        settling: fromCents(3_200_00n),
        available: fromCents(44_600_00n),
      })

      const markup = renderToStaticMarkup(
        <MoneySection facts={moneyFacts({ conditions })} />,
      )

      if (!facts.identityVerified) {
        expect(markup).toContain(dashboardCopy.payout.conditions.identity.remedy)
        expect(markup).toContain('/verify')
      }
      if (!facts.bankVerified) {
        expect(markup).toContain(dashboardCopy.payout.conditions.bank.remedy)
      }
      // The hold and the witness are unmet in all three: R3 200 is fenced and
      // R44 600 is over the threshold.
      expect(markup).toContain('clears on')
      expect(markup).toContain('Sipho')
    }
  })

  it('carries Part F wording and never the R1 test deposit', () => {
    // The design file's bank remedy is *"we send R1 to it. Tell us the
    // reference on that R1"*. Part F replaces the mechanism outright.
    const markup = renderToStaticMarkup(<MoneySection facts={moneyFacts()} />)

    expect(markup).toContain('check it against your verified name with your bank')
    expect(markup).not.toMatch(/\bR1\b/)
    expect(markup.toLowerCase()).not.toContain('test deposit')
  })

  it('says a condition cannot be acted on rather than leaving a dead end', () => {
    const markup = renderToStaticMarkup(<MoneySection facts={moneyFacts()} />)

    expect(markup).toContain(dashboardCopy.payout.conditions.bank.notYet)
  })

  it('offers exactly one control, and only where a screen exists', () => {
    /*
     * A button opening a screen that cannot verify anything would be worse than
     * the gap it hides. `/verify` exists; bank verification needs a Stitch BAV
     * adapter and approval needs a payout, both Milestone 5.
     */
    const unverified = payoutConditions({
      identityVerified: false,
      bankVerified: false,
      settling: fromCents(0n),
      available: fromCents(50_000_00n),
      witnessApproved: false,
    })

    const markup = renderToStaticMarkup(
      <MoneySection facts={moneyFacts({ conditions: unverified })} />,
    )

    expect(markup.match(/<button/g)).toHaveLength(1)
    expect(markup.match(/href="\/verify"/g)).toHaveLength(1)
  })

  it('explains what each one protects, never only what it blocks', () => {
    const markup = renderToStaticMarkup(<MoneySection facts={moneyFacts()} />)

    // The 72-hour line is the one the voice guide names explicitly.
    expect(markup).toContain('before it is your problem to fix')
    expect(markup).toContain('cannot be redirected to a stranger')
    expect(markup).toContain('you moved the family’s money alone')
  })

  it('says the list is not a judgement about her', () => {
    const markup = renderToStaticMarkup(<MoneySection facts={moneyFacts()} />)

    expect(markup).toContain(dashboardCopy.payout.notAJudgement)
  })
})

describe('what the dashboard may not contain', () => {
  const SOURCES = readdirSync(root('src/app/(organiser)/manage'), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|css)$/.test(entry.name))
    .map((entry) => ({
      path: `${entry.parentPath}/${entry.name}`,
      text: withoutComments(readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8')),
    }))

  it('covers the files it claims to', () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(5)
  })

  it('has no countdown, on any archetype', () => {
    /*
     * `design/dashboard.html` sets *"in 4 days"* on its **bereavement** variant.
     * Rule 1 forbids a countdown there, and `allowsCountdown` exists to say so —
     * the prototype contradicting the rule the prototype demonstrates, the same
     * shape as the accent literal in M1-04 §1.
     *
     * The page does not render one at all today, so this asserts the absence
     * rather than the conditional: a countdown added later has to justify
     * itself against `allowsCountdown` and against this test.
     */
    for (const { path, text } of SOURCES) {
      expect(text, path).not.toMatch(/\bin \d+ days\b/)
      expect(text.toLowerCase(), path).not.toContain('countdown')
      expect(text, path).not.toMatch(/days (to|until) go\b/)
    }
  })

  it('has no target and no progress bar', () => {
    // Rule 1 again, and the product has neither at any archetype.
    for (const { path, text } of SOURCES) {
      expect(text.toLowerCase(), path).not.toContain('progress')
      expect(text, path).not.toMatch(/targetAmount|<progress/)
    }
  })

  it('sets no accent of its own', () => {
    // Rule 2: every usage is `var(--accent, #16233D)` and `ArchetypeTheme` is
    // the only thing that sets it. A literal here would give bereavement an
    // accent by the back door.
    for (const { path, text } of SOURCES) {
      if (!path.endsWith('.css')) continue
      expect(text, path).not.toMatch(/--accent:/)
      expect(text, path).not.toMatch(/#8C2F22|#2C4A7C|#4A7C59|#C89211|#A6742B/i)
    }
  })

  it('branches on no archetype by name', () => {
    for (const { path, text } of SOURCES) {
      expect(text, path).not.toMatch(/===\s*'umngcwabo'|===\s*'umshado'/)
      expect(text, path).not.toMatch(/group\s*===\s*'bereavement'/)
    }
  })
})
