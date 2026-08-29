import type { Metadata } from 'next'
import Link from 'next/link'

import { reviewCopy } from '@/copy/review'
import { prisma } from '@/db/client'
import { queueReport, reviewQueue } from '@/db/repositories/report'
import { hoursWaiting, isOverdue } from '@/domain/report'
import { reviewersConfigured } from '@/lib/admin'
import { recordAdminAction, requestFingerprint } from '@/lib/audit'
import { formatDayMonth } from '@/lib/dates'
import { Card, Toast } from '@/ui/primitives'

import { requireAdmin } from './guard'

import styles from './review.module.css'

/**
 * `/review` — the screen a person works from (M3-07).
 *
 * M3-06 built the record, the triage status, the SLA and the self-reporting
 * queue and deliberately stopped short of this, because the queue and the audit
 * log are read together: deciding what to do about a reported umcimbi means
 * looking at what has actually happened to it, and that is the log.
 *
 * **Nothing on this screen changes an event.** Not the list, not the detail
 * page, not either button. A report does nothing by itself and neither does
 * triage — the status records how far the reading has got, and whatever is
 * decided about a page is done on the page, by a person, as a separate act. The
 * standing rule is docs/decisions.md M3-06 §1 and it is under pressure exactly
 * here, on the screen where acting would be one line of code.
 *
 * Opening it is logged. A queue of reports is a list of families somebody has
 * been accused of defrauding, and an admin who reads every report about one of
 * them and changes nothing would otherwise leave no trace at all.
 */

export const metadata: Metadata = {
  title: 'Reports · Isipheko',
  robots: { index: false, follow: false },
}

/** A queue read now is a queue that was true now. Never cached. */
export const dynamic = 'force-dynamic'

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string; done?: string; from?: string }>
}) {
  const admin = await requireAdmin()
  const { problem, done, from } = await searchParams

  /*
   * Where in the queue this page starts (M3-07b).
   *
   * A plain number in the query string and a plain `<a>` to move: the reviewer's
   * screen holds to the same posture as the contributor's, so paging works with
   * JavaScript off. An unparseable value is the first page rather than an error
   * — there is nothing here somebody needs told about a bad number.
   */
  const asked = Number.parseInt(from ?? '', 10)
  const offset = Number.isFinite(asked) && asked > 0 ? asked : 0

  const now = new Date()
  const [page, counts] = await Promise.all([
    reviewQueue(prisma, { offset }),
    queueReport(prisma, { now }),
  ])

  const queue = page.rows
  const showing = { first: page.offset + 1, last: page.offset + queue.length }
  const previous = Math.max(0, page.offset - page.limit)
  const next = page.offset + page.limit

  await recordAdminAction({
    action: 'admin.queue.viewed',
    organiserId: admin.organiserId,
    fingerprint: await requestFingerprint(),
    // Counts, not contents. What was in the queue is not something this row
    // needs to carry and the log is read by more people than the reports are.
    metadata: { waiting: counts.waiting, overdue: counts.overdue },
    now,
  })

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{reviewCopy.title}</h1>
      <p className={styles.lead}>{reviewCopy.lead}</p>

      <p className={styles.rule}>{reviewCopy.standingRule}</p>

      {done === '1' ? <Toast>{reviewCopy.statuses.closed}</Toast> : null}
      {problem === undefined ? null : (
        <Toast tone="problem">
          {reviewCopy.problems[problem as keyof typeof reviewCopy.problems] ??
            reviewCopy.problems['not-found']}
        </Toast>
      )}

      {reviewersConfigured() ? null : (
        <Toast tone="problem">{reviewCopy.noReviewers}</Toast>
      )}

      <p className={styles.counts}>
        {reviewCopy.counts.waiting(counts.waiting)}
        {counts.overdue > 0 ? ` · ${reviewCopy.counts.overdue(counts.overdue)}` : ''}
      </p>

      {queue.length === 0 ? (
        <Card title={reviewCopy.empty.heading} titleAs="h2" className={styles.card}>
          <p className={styles.body}>{reviewCopy.empty.body}</p>
        </Card>
      ) : (
        <ol className={styles.queue}>
          {queue.map((report) => {
            const late = isOverdue(report.respondBy, report.status, now)
            const due = formatDayMonth(report.respondBy) ?? ''

            return (
              <li key={report.id} className={styles.item}>
                <Link href={`/review/${report.id}`} className={styles.link}>
                  <span className={styles.reason}>
                    {reviewCopy.reasons[report.reason]}
                  </span>

                  <span className={styles.subject}>
                    {report.eventTitle !== null
                      ? reviewCopy.about.event(report.eventTitle)
                      : report.collectionTitle !== null
                        ? reviewCopy.about.collection(report.collectionTitle)
                        : reviewCopy.about.nothingHeld}
                  </span>

                  <span className={late ? styles.lateMeta : styles.meta}>
                    {reviewCopy.statuses[report.status]} ·{' '}
                    {reviewCopy.waiting(hoursWaiting(report.createdAt, now))} ·{' '}
                    {late ? reviewCopy.overdue(due) : reviewCopy.due(due)}
                  </span>

                  {report.reason === 'asked-for-a-code' ? (
                    <span className={styles.urgent}>{reviewCopy.urgent}</span>
                  ) : null}

                  <span className={styles.reference}>{report.reference}</span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}

      {/*
        Where this page sits in the whole queue, said whether or not there is
        more (M3-07b). The list used to stop at a hundred and say nothing, so a
        reviewer who reached the bottom believed they had reached the end — and
        the reports that fell off were the newest, with the most time left.

        A count of reports is not a count of contributions and carries none of
        the strand's or the album's rules. It is the number the SLA is measured
        against.
      */}
      {queue.length === 0 ? null : (
        <p className={styles.counts}>
          {reviewCopy.showing(showing.first, showing.last, page.total)}
        </p>
      )}

      {page.total > page.limit ? (
        <nav className={styles.pages} aria-label={reviewCopy.pages.label}>
          {page.offset > 0 ? (
            <a className={styles.pageLink} href={`/review?from=${String(previous)}`}>
              {reviewCopy.pages.previous}
            </a>
          ) : null}

          {next < page.total ? (
            <a className={styles.pageLink} href={`/review?from=${String(next)}`}>
              {reviewCopy.pages.next(Math.min(page.limit, page.total - next))}
            </a>
          ) : null}
        </nav>
      ) : null}
    </main>
  )
}
