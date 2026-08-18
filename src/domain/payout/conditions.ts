import { needsWitnessApproval } from './balance.ts'
import type { Money } from '../money/index.ts'

/**
 * What has to be true before money leaves, and what each one is *for*.
 *
 * ## Every condition carries `protects` and `remedy`
 *
 * `protects` says what the condition is guarding against — never what it
 * blocks. *"72-hour hold applies"* tells somebody they are being stopped;
 * *"this is the window in which it can still be undone — before it is your
 * problem to fix"* tells them why they would want it. The second is the only
 * one that survives an organiser who is short of time and needs the money.
 *
 * `remedy` is the concrete next step, and it is **required on every unmet
 * condition**. A condition that reports a problem and not a way out is a dead
 * end on the screen where somebody is trying to feed a funeral.
 *
 * ## None of these always passes
 *
 * A condition that is true by construction is decoration: it teaches an
 * organiser that the list is a formality, so the one that matters is not read
 * either. Each of the four below has a state in which it is unmet, and a unit
 * test asserts it.
 *
 * `identity` is the one to check that against, because publishing already
 * requires verification (M3-02) — so on a published event it is always true.
 * It is not decoration because **the dashboard is reachable before publishing**,
 * which is exactly when it is the thing standing in the way.
 *
 * ## What cannot be acted on here
 *
 * Only `identity` has a screen to send somebody to. Bank verification needs a
 * Stitch BAV adapter and payout approval needs a payout, both of which are
 * Milestone 5. Their remedies are sentences describing what will be asked, and
 * that is the honest shape: a button opening a screen that cannot verify
 * anything would be worse than the gap it hides. See docs/decisions.md M3-08 §5.
 *
 * Pure: rules and shapes. No I/O — the copy lives in `src/copy/dashboard.ts`.
 */

export type PayoutConditionId = 'identity' | 'bank' | 'hold' | 'witness'

export interface PayoutFacts {
  readonly identityVerified: boolean
  readonly bankVerified: boolean
  /** The fenced portion. Zero means nothing is inside the window. */
  readonly settling: Money
  /** What the hold does not fence — and what a payout would draw. */
  readonly available: Money
  /** Whether an umkhaphi has agreed to a payout of this size. */
  readonly witnessApproved: boolean
}

export interface PayoutCondition {
  readonly id: PayoutConditionId
  readonly met: boolean
  /**
   * Whether this one has anywhere to send somebody today.
   *
   * False does not mean "no next step" — every unmet condition still says what
   * happens next. It means the next step is not a control on this screen.
   */
  readonly actionable: boolean
}

/**
 * The four, in the order they are met in practice.
 *
 * Identity first because it gates publishing and therefore comes first in time;
 * the hold before the witness because the hold decides the amount and the
 * amount decides whether a witness is needed at all.
 */
export function payoutConditions(facts: PayoutFacts): readonly PayoutCondition[] {
  const witnessNeeded = needsWitnessApproval(facts.available)

  return [
    {
      id: 'identity',
      met: facts.identityVerified,
      // `/verify` exists (M3-01) and is organiser-level, so one check serves
      // every event she runs.
      actionable: true,
    },
    {
      id: 'bank',
      met: facts.bankVerified,
      actionable: false,
    },
    {
      id: 'hold',
      // Met when nothing is fenced. **Not** "met when the whole balance has
      // aged": the hold fences the recent portion, so an event receiving
      // contributions every day would otherwise never satisfy it and the
      // condition would be permanently red on a working umcimbi.
      met: facts.settling === 0n,
      actionable: false,
    },
    {
      id: 'witness',
      // Below the threshold there is nothing to ask for, and the condition is
      // met rather than hidden — an organiser should be able to see that a
      // second signature exists and why it has not been asked for.
      met: !witnessNeeded || facts.witnessApproved,
      actionable: false,
    },
  ]
}

export function unmetConditions(
  conditions: readonly PayoutCondition[],
): readonly PayoutCondition[] {
  return conditions.filter((condition) => !condition.met)
}

/**
 * Whether every condition is satisfied.
 *
 * **Nothing in this product may act on this today.** Mode B is Milestone 5 and
 * gated on the legal opinion (architecture §15 item 1), so there is no payout
 * to request and no screen offers one. It exists because the conditions are the
 * thing being explained, and a set of conditions with no notion of "all of
 * them" is a list rather than a gate.
 */
export function payoutReady(conditions: readonly PayoutCondition[]): boolean {
  return conditions.every((condition) => condition.met)
}
