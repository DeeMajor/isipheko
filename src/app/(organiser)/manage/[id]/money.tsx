import Link from 'next/link'

import { dashboardCopy } from '@/copy/dashboard'
import type { PaymentMode } from '@/domain/contribution'
import { formatMoney } from '@/domain/money'
import {
  WITNESS_APPROVAL_THRESHOLD,
  type Balance,
  type PayoutCondition,
} from '@/domain/payout'
import { formatDayMonth } from '@/lib/dates'
import { Button, Card } from '@/ui/primitives'

import styles from './page.module.css'

/**
 * Where the money is, and what would have to be true before it could leave.
 *
 * ## No figure on this screen is a balance we hold
 *
 * `design/dashboard.html` renders *"Ready to pay out now — R44 600"* above a
 * **Request** button. Both are Mode B, which is gated on a legal opinion
 * (architecture §15 item 1) and is not built. Under Mode A the contributor pays
 * the organiser directly: the money is already in her own account and there is
 * nothing for us to release.
 *
 * So the amounts are labelled as what they are — a record of what she has
 * confirmed, and how much of it is new enough that a payment could still be
 * reversed — and **there is no request button anywhere in this file.** An
 * organiser who made a promise on the strength of a number this screen called
 * "available" would have been failed in a way an apology does not fix. Same
 * discipline as M1-08 §5.
 *
 * ## The conditions render and explain, and one of them can be acted on
 *
 * Each carries `protects` — what it is guarding against, never what it blocks —
 * and, when unmet, a concrete next step. Only identity has a screen to send her
 * to; the other three say what will be asked and that nothing is waiting on
 * her. A button opening a screen that cannot verify anything would be worse
 * than the gap it hides.
 */

export interface MoneyFacts {
  /** Where the money is depends on how it was taken (M5-03). */
  readonly mode: PaymentMode
  readonly balance: Balance
  readonly conditions: readonly PayoutCondition[]
  readonly confirmedCount: number
  readonly verifiedOn: Date | null
  readonly witnessName: string | null
  readonly hasInKind: boolean
}

function Figure({
  label,
  amount,
  note,
}: {
  label: string
  amount: string
  note: string
}) {
  return (
    <div className={styles.figure}>
      <p className={styles.figureLabel}>{label}</p>
      <p className={styles.figureAmount} data-numeric="">
        {amount}
      </p>
      <p className={styles.rowNote}>{note}</p>
    </div>
  )
}

function conditionText(
  condition: PayoutCondition,
  facts: MoneyFacts,
): { title: string; protects: string; next: string; action: boolean } {
  const copy = dashboardCopy.payout.conditions
  const threshold = formatMoney(WITNESS_APPROVAL_THRESHOLD)
  const clears = formatDayMonth(facts.balance.clearsAt) ?? ''
  const firstName = facts.witnessName?.split(' ')[0] ?? null

  switch (condition.id) {
    case 'identity':
      return {
        title: condition.met ? copy.identity.titleMet : copy.identity.titleUnmet,
        protects: copy.identity.protects,
        next: condition.met
          ? copy.identity.met(formatDayMonth(facts.verifiedOn) ?? '')
          : copy.identity.remedy,
        action: !condition.met,
      }

    case 'bank':
      return {
        title: condition.met ? copy.bank.titleMet : copy.bank.titleUnmet,
        protects: copy.bank.protects,
        // Part F's wording, and then the honest half: she cannot do it yet.
        // Saying only the first would leave her looking for a screen that does
        // not exist.
        next: condition.met ? copy.bank.met : `${copy.bank.remedy} ${copy.bank.notYet}`,
        action: false,
      }

    case 'hold':
      return {
        title: condition.met
          ? copy.hold.titleMet
          : copy.hold.titleUnmet(formatMoney(facts.balance.settling)),
        protects: copy.hold.protects,
        next: condition.met
          ? copy.hold.met
          : copy.hold.remedy(clears, formatMoney(facts.balance.available)),
        action: false,
      }

    case 'witness':
      return {
        title: condition.met
          ? copy.witness.titleMet
          : firstName === null
            ? copy.witness.titleUnmetNobody
            : copy.witness.titleUnmet(firstName),
        protects: copy.witness.protects(threshold),
        next: condition.met
          ? copy.witness.met(threshold)
          : firstName === null
            ? copy.witness.remedyNobody
            : `${copy.witness.remedy(firstName)} ${copy.witness.notYet}`,
        action: false,
      }
  }
}

export function MoneySection({ facts }: { facts: MoneyFacts }) {
  const { balance } = facts
  const clears = formatDayMonth(balance.clearsAt)

  return (
    <>
      <Card title={dashboardCopy.money.heading} titleAs="h2" className={styles.card}>
        {/*
          Where the money is, first, before any number — and it is a different
          answer per mode. Ledger-only: already in her own account. Hosted: with
          the payment service and not yet in her bank. Telling her the wrong one
          on this screen is the failure M3-08 §1 exists to prevent.
        */}
        <p className={styles.body}>
          {facts.mode === 'hosted'
            ? dashboardCopy.money.introHosted
            : dashboardCopy.money.intro}
        </p>

        <div className={styles.figures}>
          <Figure
            label={dashboardCopy.money.raised}
            amount={formatMoney(balance.raised)}
            note={dashboardCopy.money.raisedNote(facts.confirmedCount)}
          />

          <Figure
            label={dashboardCopy.money.settling}
            amount={formatMoney(balance.settling)}
            note={
              balance.settling === 0n || clears === null
                ? dashboardCopy.money.settlingNone
                : dashboardCopy.money.settlingNote(formatMoney(balance.settling), clears)
            }
          />

          <Figure
            label={dashboardCopy.money.available}
            amount={formatMoney(balance.available)}
            note={dashboardCopy.money.availableNote(formatMoney(balance.available))}
          />
        </div>

        {facts.hasInKind ? (
          <p className={styles.note}>{dashboardCopy.money.inKindNote}</p>
        ) : null}
      </Card>

      <Card title={dashboardCopy.payout.heading} titleAs="h2" className={styles.card}>
        <p className={styles.body}>{dashboardCopy.payout.intro}</p>

        <ul className={styles.conditions}>
          {facts.conditions.map((condition) => {
            const text = conditionText(condition, facts)

            return (
              <li
                key={condition.id}
                className={condition.met ? styles.conditionMet : styles.condition}
              >
                {/*
                  The state is in the words, not only in a mark. A tick beside a
                  line somebody cannot read the colour of says nothing, and this
                  list is read by people deciding whether they have a problem.
                */}
                <p className={styles.conditionTitle}>{text.title}</p>
                <p className={styles.rowNote}>{text.protects}</p>
                <p className={styles.conditionNext} data-numeric="">
                  {text.next}
                </p>

                {text.action ? (
                  <Link href="/verify" className={styles.conditionAction}>
                    <Button type="button" variant="secondary">
                      {dashboardCopy.payout.conditions.identity.action}
                    </Button>
                  </Link>
                ) : null}
              </li>
            )
          })}
        </ul>

        <p className={styles.note}>{dashboardCopy.payout.notAJudgement}</p>
      </Card>
    </>
  )
}
