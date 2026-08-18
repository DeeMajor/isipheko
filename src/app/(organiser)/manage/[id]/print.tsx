import { albumCopy } from '@/copy/album'
import type { AlbumRenderRow } from '@/db/repositories/album-render'
import { albumPdfPath } from '@/lib/album-pdf'
import { Button } from '@/ui/primitives'

import { requestAlbumRender } from './actions'

import styles from './page.module.css'

/**
 * The printed album, on the organiser's dashboard.
 *
 * **It says when, not "please wait".** There is no queue daemon: a render waits
 * for the next scheduled run of `pnpm render`. A spinner would be a lie with a
 * moving part, so the copy names the hour instead — and if that schedule ever
 * changes, `albumCopy.print.queued` changes with it (docs/decisions.md M4-03
 * §10).
 *
 * A finished render is a link rather than a button, because it is a file that
 * already exists at an address that will not change.
 */
export function PrintSection({
  eventId,
  slug,
  render,
  justRequested,
}: {
  eventId: string
  slug: string
  render: AlbumRenderRow | null
  justRequested: boolean
}) {
  const copy = albumCopy.print
  const ready = render?.status === 'ready'

  return (
    <div className={styles.print}>
      <p className={styles.printHeading}>{copy.heading}</p>
      <p className={styles.body}>{copy.body}</p>

      {ready && render !== null ? (
        <>
          <p className={styles.body}>
            <a className={styles.printLink} href={albumPdfPath(slug, render.version)}>
              {copy.ready}
            </a>
          </p>
          {/* What a print shop needs to know before they open it (§4). */}
          <p className={styles.printNote}>{copy.readyNote}</p>
        </>
      ) : null}

      {render?.status === 'pending' || render?.status === 'rendering' ? (
        <p className={styles.printNote}>
          {justRequested || render.status === 'pending'
            ? copy.queued
            : copy.rendering}
        </p>
      ) : null}

      {render?.status === 'failed' ? (
        <p className={styles.printNote}>{copy.failed}</p>
      ) : null}

      {/*
        Offered even once one is ready: the record grows, and the version is a
        hash of what it holds — so this asks for the album as it stands now, and
        returns the existing file unchanged if nothing has.
      */}
      <form action={requestAlbumRender}>
        <input type="hidden" name="id" value={eventId} />
        <Button type="submit" variant="quiet" inline>
          {copy.request}
        </Button>
      </form>
    </div>
  )
}
