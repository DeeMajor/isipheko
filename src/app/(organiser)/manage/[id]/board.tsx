import { dashboardCopy } from '@/copy/dashboard'
import type { OrganiserBoard, OrganiserBoardRow } from '@/db/repositories/needs'
import { Button, Card } from '@/ui/primitives'

import { confirmArrival, decideSuggestion } from './actions'

import styles from './page.module.css'

/**
 * The needs board from the organiser's side.
 *
 * The public board answers *what can still be taken*. This answers *what do I
 * still have to chase*, and the difference between them is the whole reason
 * this section exists: **an item fully claimed and undelivered is invisible on
 * the public board**, and it is precisely the thing that does not arrive.
 *
 * Four groups, in the order she can act on them:
 *
 * - **Nobody has taken this** — the gap, and the only thing worth telling the
 *   family group about.
 * - **Promised, not yet here** — held in a name. One tap marks it arrived, and
 *   that tap is the same action as the queue's, because it is the same act.
 * - **Someone suggested this** — built in M2-04 and unreachable until now.
 * - **Here already** — nothing needed, collapsed behind a `<details>`.
 *
 * A partly-claimed item appears in **both** of the first two, deliberately:
 * sixteen of twenty kilograms of meat is simultaneously somebody's promise and
 * a gap the family still has to fill, and the two need different actions.
 */

function Row({
  eventId,
  row,
  action,
}: {
  eventId: string
  row: OrganiserBoardRow
  action: 'arrive' | 'suggestion' | null
}) {
  const partly = row.quantityRequired > 1 && row.quantityClaimed > 0

  return (
    <li className={styles.boardRow}>
      <p className={styles.rowName}>{row.label}</p>

      <p className={styles.meta} data-numeric="">
        {row.claimantName === null
          ? partly
            ? dashboardCopy.board.partly(
                row.quantityClaimed,
                row.quantityRequired,
                row.label,
              )
            : dashboardCopy.board.nobody
          : action === 'suggestion'
            ? dashboardCopy.board.suggestedBy(row.claimantName)
            : row.deliveredAt === null
              ? dashboardCopy.board.heldBy(row.claimantName)
              : dashboardCopy.board.arrivedFrom(row.claimantName)}
      </p>

      {row.note === null || row.note === '' ? null : (
        <p className={styles.rowNote}>{row.note}</p>
      )}

      {action === 'arrive' && row.claimId !== null ? (
        <form action={confirmArrival}>
          <input type="hidden" name="id" value={eventId} />
          <input type="hidden" name="claim" value={row.claimId} />
          <Button type="submit">{dashboardCopy.board.markArrived}</Button>
        </form>
      ) : null}

      {action === 'suggestion' ? (
        <div className={styles.decide}>
          <form action={decideSuggestion}>
            <input type="hidden" name="id" value={eventId} />
            <input type="hidden" name="item" value={row.id} />
            <input type="hidden" name="answer" value="approve" />
            <Button type="submit" variant="secondary">
              {dashboardCopy.board.addToList}
            </Button>
          </form>
          <form action={decideSuggestion}>
            <input type="hidden" name="id" value={eventId} />
            <input type="hidden" name="item" value={row.id} />
            <input type="hidden" name="answer" value="decline" />
            <Button type="submit" variant="quiet">
              {dashboardCopy.board.leaveOff}
            </Button>
          </form>
        </div>
      ) : null}
    </li>
  )
}

function Group({
  eventId,
  title,
  note,
  rows,
  action,
}: {
  eventId: string
  title: string
  note: string
  rows: readonly OrganiserBoardRow[]
  action: 'arrive' | 'suggestion' | null
}) {
  if (rows.length === 0) return null

  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle}>{title}</h3>
        <span className={styles.meta} data-numeric="">
          {dashboardCopy.board.countOf(rows.length)}
        </span>
      </div>
      <p className={styles.rowNote}>{note}</p>

      <ul className={styles.boardRows}>
        {rows.map((row) => (
          <Row
            key={`${row.id}:${row.claimId ?? 'none'}`}
            eventId={eventId}
            row={row}
            action={action}
          />
        ))}
      </ul>
    </div>
  )
}

export function NeedsBoard({
  eventId,
  board,
}: {
  eventId: string
  board: OrganiserBoard
}) {
  const outstanding = board.open.length + board.promised.length
  const total = outstanding + board.arrived.length

  return (
    <Card title={dashboardCopy.board.heading} titleAs="h2" className={styles.card}>
      <p className={styles.body}>
        {total === 0
          ? dashboardCopy.board.emptyList
          : outstanding === 0
            ? dashboardCopy.board.allSettled
            : dashboardCopy.board.intro(board.arrived.length, total, outstanding)}
      </p>

      <Group
        eventId={eventId}
        title={dashboardCopy.board.open.title}
        note={dashboardCopy.board.open.note}
        rows={board.open}
        action={null}
      />

      <Group
        eventId={eventId}
        title={dashboardCopy.board.promised.title}
        note={dashboardCopy.board.promised.note}
        rows={board.promised}
        action="arrive"
      />

      <Group
        eventId={eventId}
        title={dashboardCopy.board.suggested.title}
        note={dashboardCopy.board.suggested.note}
        rows={board.suggested}
        action="suggestion"
      />

      {/*
        Collapsed, because "here already" is the longest group on a working
        umcimbi and the shortest one that needs her.

        A native `<details>` rather than the design's toggle button: it works
        with no JavaScript, and the organiser side has precedent for it (M3-02
        §3).
      */}
      {board.arrived.length === 0 ? null : (
        <details className={styles.details}>
          <summary className={styles.summary}>
            {dashboardCopy.board.arrived.title} ·{' '}
            {dashboardCopy.board.countOf(board.arrived.length)}
          </summary>
          <p className={styles.rowNote}>{dashboardCopy.board.arrived.note}</p>
          <ul className={styles.boardRows}>
            {board.arrived.map((row) => (
              <Row
                key={`${row.id}:${row.claimId ?? 'none'}`}
                eventId={eventId}
                row={row}
                action={null}
              />
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}
