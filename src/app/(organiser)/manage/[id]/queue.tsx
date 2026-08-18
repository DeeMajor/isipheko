import { dashboardCopy } from '@/copy/dashboard'
import type { PendingReport } from '@/db/repositories/contribution'
import { inKindDescription, type AwaitedDelivery } from '@/db/repositories/needs'
import { formatMoney, fromCents } from '@/domain/money'
import { digestFromKey } from '@/lib/contribution-photo'
import { Button, Card } from '@/ui/primitives'

import { confirmArrival, confirmReport } from './actions'

import styles from './page.module.css'

/**
 * The confirmation queue — **one list, and it leads the page.**
 *
 * The M2-05 stub had two cards: payments to confirm, and things to mark
 * arrived. `design/dashboard.html` has one queue carrying both, and merging
 * them is the substance of *"confirm and mark-delivered are the two easiest
 * actions on the page"*. Two lists means the second one is below the first, and
 * on a phone that means somebody with three tents waiting scrolls past six
 * payments to reach them.
 *
 * So they interleave, oldest first. What differs between the two kinds is the
 * tag, the button's words and whether there is a bank message to check against
 * — not the shape of the row and not where on the page it lives.
 *
 * **Every row's primary action is one tap and it is the widest thing in the
 * card.** Nothing else on this screen is a filled button.
 */

/** A row in the queue, from either source, reduced to what it renders. */
interface QueueRow {
  readonly key: string
  readonly kind: 'payment' | 'delivery'
  readonly at: Date
  readonly who: string
  readonly headline: string
  readonly detail: string | null
  readonly checkAgainst: string | null
  readonly formId: string
  readonly formValue: string
  /**
   * The photo the contributor attached, if any. Shown small, beside what she is
   * being asked to confirm — a picture of the tent that arrived is a reason to
   * tap the button, and it is the only place a photo appears until the album
   * (M4-02) exists.
   */
  readonly photoDigest: string | null
}

/**
 * A surname reduced the way a bank statement prints it — *"T NGCOBO"*.
 *
 * The whole confirmation model rests on her comparing this screen against her
 * own banking app, and a name she has to translate is a name she checks less
 * carefully.
 */
function asBankStatement(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return (parts[0] ?? '').toUpperCase()

  const initial = (parts[0] ?? '').slice(0, 1).toUpperCase()
  return `${initial} ${(parts.at(-1) ?? '').toUpperCase()}`
}

export function buildQueue(
  reports: readonly PendingReport[],
  arrivals: readonly AwaitedDelivery[],
): readonly QueueRow[] {
  const payments: QueueRow[] = reports.map((report) => {
    const amount =
      report.amountCents === null ? null : formatMoney(fromCents(report.amountCents))

    return {
      key: `payment:${report.id}`,
      kind: 'payment',
      at: report.selfReportedAt,
      who: report.contributorName,
      headline:
        amount === null
          ? dashboardCopy.queue.isBringing(report.contributorName, 'something')
          : dashboardCopy.queue.saidTheySent(report.contributorName, amount),
      detail: dashboardCopy.queue.reference(report.reference),
      checkAgainst:
        amount === null
          ? null
          : dashboardCopy.queue.checkAgainst(
              amount,
              asBankStatement(report.contributorName),
              report.reference,
            ),
      formId: 'contribution',
      formValue: report.id,
      photoDigest: digestFromKey(report.photoKey),
    }
  })

  const deliveries: QueueRow[] = arrivals.map((arrival) => ({
    key: `delivery:${arrival.claimId}`,
    kind: 'delivery',
    at: arrival.claimedAt,
    who: arrival.claimantName,
    headline: dashboardCopy.queue.isBringing(
      arrival.claimantName,
      inKindDescription(arrival.label, arrival.quantity).toLowerCase(),
    ),
    detail: null,
    checkAgainst: null,
    formId: 'claim',
    formValue: arrival.claimId,
    photoDigest: null,
  }))

  // Oldest first: the person who has been waiting longest for an acknowledgement
  // is the one to answer next, and it is the same ordering the report queue uses
  // for the same reason (M3-07).
  return [...payments, ...deliveries].sort((a, b) => a.at.getTime() - b.at.getTime())
}

export function ConfirmationQueue({
  eventId,
  slug,
  rows,
}: {
  eventId: string
  slug: string
  rows: readonly QueueRow[]
}) {
  if (rows.length === 0) {
    return (
      <Card
        title={dashboardCopy.queue.empty.heading}
        titleAs="h2"
        className={styles.leadCard}
      >
        <p className={styles.body}>{dashboardCopy.queue.empty.body}</p>
      </Card>
    )
  }

  return (
    <Card title={dashboardCopy.queue.heading} titleAs="h2" className={styles.leadCard}>
      <p className={styles.body}>
        {dashboardCopy.queue.intro(rows.length)}
        {dashboardCopy.queue.tail}
      </p>

      <ul className={styles.queue}>
        {rows.map((row) => (
          <li key={row.key} className={styles.queueItem}>
            <p className={styles.tag}>
              {row.kind === 'payment'
                ? dashboardCopy.queue.paymentTag
                : dashboardCopy.queue.deliveryTag}
            </p>

            <p className={styles.headline}>{row.headline}</p>

            {/*
              AVIF with a WebP fallback, chosen by the markup rather than by a
              header so each URL names one representation. Both came out of the
              same stripping pipeline — neither carries where it was taken.
            */}
            {row.photoDigest === null ? null : (
              <picture>
                <source
                  srcSet={`/e/${slug}/photo/${row.photoDigest}-thumb.avif`}
                  type="image/avif"
                />
                <img
                  className={styles.photo}
                  src={`/e/${slug}/photo/${row.photoDigest}-thumb.webp`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </picture>
            )}
            {row.detail === null ? null : (
              <p className={styles.meta} data-numeric="">
                {row.detail}
              </p>
            )}

            {/*
              What to look for in her own banking app. This is the whole
              mechanism in Mode A: the page knows only what somebody typed into
              it, and she is the one who checks.
            */}
            {row.checkAgainst === null ? null : (
              <p className={styles.check} data-numeric="">
                {row.checkAgainst}
              </p>
            )}

            {/*
              A plain `<form method="post">` server action, so the two most
              important actions on the organiser's day work with no JavaScript
              at all.
            */}
            <form action={row.kind === 'payment' ? confirmReport : confirmArrival}>
              <input type="hidden" name="id" value={eventId} />
              <input type="hidden" name={row.formId} value={row.formValue} />
              <Button type="submit">
                {row.kind === 'payment'
                  ? dashboardCopy.queue.confirmPayment
                  : dashboardCopy.queue.confirmDelivery}
              </Button>
            </form>
          </li>
        ))}
      </ul>

      <p className={styles.note}>{dashboardCopy.queue.confirmNote}</p>
    </Card>
  )
}
