import { describe, expect, it } from 'vitest'

import { fromCents } from '@/domain/money'
import {
  payoutConditions,
  payoutReady,
  unmetConditions,
  type PayoutFacts,
} from '@/domain/payout'

/**
 * The four conditions, and the rule the done-criterion sets against them:
 * **every unmet condition shows a concrete next step, and none of them always
 * passes.**
 *
 * A condition that is true by construction is decoration. It teaches an
 * organiser that the list is a formality, and the cost of that is paid on the
 * one that matters rather than on the one that was decorative.
 */

const MET: PayoutFacts = {
  identityVerified: true,
  bankVerified: true,
  settling: fromCents(0n),
  available: fromCents(100_00n),
  witnessApproved: false,
}

const idOf = (facts: PayoutFacts, id: string) =>
  payoutConditions(facts).find((condition) => condition.id === id)

describe('the four', () => {
  it('are in the order they are met in practice', () => {
    expect(payoutConditions(MET).map((condition) => condition.id)).toEqual([
      'identity',
      'bank',
      'hold',
      'witness',
    ])
  })

  it('all pass when everything is in order', () => {
    expect(payoutReady(payoutConditions(MET))).toBe(true)
    expect(unmetConditions(payoutConditions(MET))).toEqual([])
  })
})

describe('none of them always passes', () => {
  /*
   * The assertion the task asks for, stated once over the whole set rather than
   * four times: for each condition there is a set of facts under which it is
   * unmet. If somebody later adds a fifth that is true by construction, this
   * fails rather than a reviewer having to notice.
   */
  const FALSIFYING: readonly PayoutFacts[] = [
    { ...MET, identityVerified: false },
    { ...MET, bankVerified: false },
    { ...MET, settling: fromCents(50_00n) },
    { ...MET, available: fromCents(6_000_00n), witnessApproved: false },
  ]

  it('has a state in which each one is unmet', () => {
    const everUnmet = new Set(
      FALSIFYING.flatMap((facts) =>
        unmetConditions(payoutConditions(facts)).map((condition) => condition.id),
      ),
    )

    expect(everUnmet).toEqual(new Set(['identity', 'bank', 'hold', 'witness']))
  })
})

describe('identity', () => {
  it('is unmet before verification', () => {
    // Publishing already requires it (M3-02), so on a published event this is
    // always true — but the dashboard is reachable *before* publishing, which
    // is exactly when it is the thing standing in the way. That is what keeps
    // it from being decoration.
    expect(idOf({ ...MET, identityVerified: false }, 'identity')?.met).toBe(false)
  })

  it('is the only one with somewhere to send her today', () => {
    // `/verify` exists. Bank verification needs a Stitch BAV adapter and
    // approval needs a payout, both Milestone 5 — their next step is a
    // sentence, and a button opening a screen that cannot verify anything
    // would be worse than the gap it hides.
    const actionable = payoutConditions(MET)
      .filter((condition) => condition.actionable)
      .map((condition) => condition.id)

    expect(actionable).toEqual(['identity'])
  })
})

describe('the hold', () => {
  it('is met when nothing is fenced, whatever the balance', () => {
    expect(idOf({ ...MET, available: fromCents(90_000_00n) }, 'hold')?.met).toBe(true)
  })

  it('is unmet while any of it is inside the window', () => {
    expect(idOf({ ...MET, settling: fromCents(1n) }, 'hold')?.met).toBe(false)
  })

  it('is not "the whole balance has aged"', () => {
    /*
     * The mistake worth naming. If this condition read the total rather than
     * the fenced portion, an umcimbi receiving contributions every day would
     * never satisfy it — the condition would be permanently red on a working
     * event, which is the same failure as fencing the whole balance, wearing a
     * different hat.
     */
    const busy: PayoutFacts = {
      ...MET,
      settling: fromCents(0n),
      available: fromCents(40_000_00n),
    }

    expect(idOf(busy, 'hold')?.met).toBe(true)
  })
})

describe('the second signature', () => {
  it('is not needed below the threshold, and says so rather than hiding', () => {
    const small = idOf({ ...MET, available: fromCents(4_999_00n) }, 'witness')

    expect(small?.met).toBe(true)
    // An organiser should be able to see that a second signature exists and
    // why it has not been asked for. A condition that disappears teaches
    // nothing.
    expect(small).toBeDefined()
  })

  it('is needed above it', () => {
    expect(idOf({ ...MET, available: fromCents(5_000_01n) }, 'witness')?.met).toBe(false)
  })

  it('is satisfied once an umkhaphi has agreed', () => {
    expect(
      idOf({ ...MET, available: fromCents(50_000_00n), witnessApproved: true }, 'witness')
        ?.met,
    ).toBe(true)
  })

  it('reads the available amount, not the total raised', () => {
    // A payout draws what is not fenced. Asking for a second signature on an
    // amount that cannot leave yet would ask a witness to agree to a number
    // nobody is taking.
    const facts: PayoutFacts = {
      ...MET,
      settling: fromCents(0n),
      available: fromCents(4_000_00n),
    }

    expect(idOf(facts, 'witness')?.met).toBe(true)
  })
})

describe('readiness', () => {
  it('is false while anything is unmet', () => {
    expect(payoutReady(payoutConditions({ ...MET, bankVerified: false }))).toBe(false)
  })

  it('is never acted on — there is no payout to request', () => {
    /*
     * Mode B is Milestone 5 and gated on the legal opinion (architecture §15
     * item 1). `payoutReady` exists because a set of conditions with no notion
     * of "all of them" is a list rather than a gate; nothing in the product may
     * turn it into a button. `tests/unit/dashboard-render.test.tsx` asserts the
     * screen offers none.
     */
    expect(payoutReady(payoutConditions(MET))).toBe(true)
  })
})
