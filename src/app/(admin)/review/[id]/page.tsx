import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { reviewCopy } from '@/copy/review'
import { prisma } from '@/db/client'
import { auditForTarget, type AuditRow } from '@/db/repositories/audit'
import { reportById } from '@/db/repositories/report'
import { hoursWaiting, isOverdue, nextTriageStatuses } from '@/domain/report'
import { recordAdminAction, requestFingerprint } from '@/lib/audit'
import { formatDayMonth } from '@/lib/dates'
import { Button, Card } from '@/ui/primitives'

import { closeReport, startReading } from '../actions'
import { requireAdmin } from '../guard'

import styles from '../review.module.css'

/**
 * One report, and what has actually happened to the thing it names.
 *
 * The audit trail beside it is the whole reason M3-06 §9 left this screen to be
 * built with the log rather than with the form: a reviewer deciding about an
 * umcimbi needs to know when it was published, whether the organiser was
 * verified, and what has been confirmed against it — and every one of those is
 * an append-only row rather than a field somebody could have edited.
 *
 * **This screen holds the one piece of personal information the queue does
 * not**: the reporter's number. It is here because a person promised to come
 * back to them and cannot without it, it is not in the list, and it is in no
 * log. The copy says so on the screen rather than leaving it to be assumed.
 *
 * **Nothing here changes the event.** Both buttons write to `reports` and
 * nowhere else.
 */

export const metadata: Metadata = {
  title: 'A report · Isipheko',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

function actionLabel(row: AuditRow): string {
  return reviewCopy.trail.actions[row.action] ?? row.action
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params

  const report = await reportById(prisma, { id })
  if (report === null) notFound()

  const now = new Date()
  const fingerprint = await requestFingerprint()

  // Reading is the action here, so it is a row before anything is rendered.
  await recordAdminAction({
    action: 'admin.report.opened',
    organiserId: admin.organiserId,
    target: { type: 'report', id },
    fingerprint,
    now,
  })

  // And against the umcimbi, so its own trail shows it was looked at. An event
  // reported four times and read once is a different thing from one reported
  // four times and never opened, and only a row against the event makes that
  // visible where somebody would look for it.
  if (report.eventId !== null) {
    await recordAdminAction({
      action: 'admin.report.opened',
      organiserId: admin.organiserId,
      target: { type: 'event', id: report.eventId },
      fingerprint,
      now,
    })
  }

  const trail =
    report.eventId === null
      ? []
      : await auditForTarget(prisma, { targetType: 'event', targetId: report.eventId })

  const due = formatDayMonth(report.respondBy) ?? ''
  const late = isOverdue(report.respondBy, report.status, now)
  const onwards = nextTriageStatuses(report.status)

  return (
    <main className={styles.page}>
      <Link href="/review" className={styles.back}>
        {reviewCopy.actions.back}
      </Link>

      <h1 className={styles.title}>{reviewCopy.reasons[report.reason]}</h1>

      <p className={late ? styles.lateMeta : styles.meta}>
        {reviewCopy.statuses[report.status]} ·{' '}
        {reviewCopy.waiting(hoursWaiting(report.createdAt, now))} ·{' '}
        {late ? reviewCopy.overdue(due) : reviewCopy.due(due)} · {report.reference}
      </p>

      <p className={styles.rule}>{reviewCopy.standingRule}</p>

      {report.reason === 'asked-for-a-code' ? (
        <p className={styles.urgent}>{reviewCopy.urgent}</p>
      ) : null}

      <Card title={reviewCopy.about.heading} titleAs="h2" className={styles.card}>
        <p className={styles.body}>
          {report.eventTitle !== null
            ? reviewCopy.about.event(report.eventTitle)
            : report.collectionTitle !== null
              ? reviewCopy.about.collection(report.collectionTitle)
              : reviewCopy.about.nothingHeld}
        </p>

        {report.aboutTyped === null ? null : (
          <>
            <p className={styles.label}>{reviewCopy.about.typed}</p>
            <p className={styles.quoted}>{report.aboutTyped}</p>
          </>
        )}
      </Card>

      <Card title={reviewCopy.detail.heading} titleAs="h2" className={styles.card}>
        {report.detail === null || report.detail === '' ? (
          <p className={styles.body}>{reviewCopy.detail.none}</p>
        ) : (
          <p className={styles.quoted}>{report.detail}</p>
        )}
      </Card>

      <Card title={reviewCopy.contact.heading} titleAs="h2" className={styles.card}>
        {report.reporterPhoneE164 === null ? (
          <p className={styles.body}>{reviewCopy.contact.none}</p>
        ) : (
          <>
            <p className={styles.phone}>{report.reporterPhoneE164}</p>
            <p className={styles.body}>{reviewCopy.contact.why}</p>
          </>
        )}
      </Card>

      {report.eventId === null ? null : (
        <Card title={reviewCopy.trail.heading} titleAs="h2" className={styles.card}>
          {trail.length === 0 ? (
            <p className={styles.body}>{reviewCopy.trail.none}</p>
          ) : (
            <ol className={styles.trail}>
              {trail.map((row) => (
                <li key={row.id} className={styles.trailItem}>
                  <span className={styles.trailAction}>{actionLabel(row)}</span>
                  <span className={styles.meta}>
                    {formatDayMonth(row.createdAt) ?? ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className={styles.body}>{reviewCopy.trail.hint}</p>
        </Card>
      )}

      <Card title={reviewCopy.actions.close} titleAs="h2" className={styles.card}>
        <p className={styles.body}>{reviewCopy.actions.closeHelp}</p>

        {onwards.length === 0 ? (
          <p className={styles.body}>{reviewCopy.actions.closed}</p>
        ) : (
          <div className={styles.decide}>
            {onwards.includes('reviewing') ? (
              <form action={startReading}>
                <input type="hidden" name="id" value={report.id} />
                <input type="hidden" name="from" value={report.status} />
                <Button type="submit" variant="secondary">
                  {reviewCopy.actions.start}
                </Button>
              </form>
            ) : null}

            {onwards.includes('closed') ? (
              <form action={closeReport}>
                <input type="hidden" name="id" value={report.id} />
                <input type="hidden" name="from" value={report.status} />
                <Button type="submit">{reviewCopy.actions.close}</Button>
              </form>
            ) : null}
          </div>
        )}
      </Card>
    </main>
  )
}
