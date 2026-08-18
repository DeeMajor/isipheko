/* eslint-disable @next/next/no-head-element --
 * Like the public event page, this file *is* the document: rendered with
 * renderToStaticMarkup and served from a route handler, because an App Router
 * page would put 174KB of framework back on the path (docs/decisions.md M1-08).
 */

import { albumCopy, archetypeAlbumIntro } from '@/copy/album'
import { archetypeEventCopy, eventCopy } from '@/copy/event'
import type { AlbumEntry } from '@/db/repositories/album'
import type { StrandBead } from '@/db/repositories/strand'
import type { ArchetypeConfig } from '@/domain/archetype'
import { formatDayMonthYear } from '@/lib/dates'
import { formatEventDate } from '@/lib/event-card'

import { ALBUM_CSS } from './album-css'
import { LedgerStrand, groupSize, nameOf, whatOf } from './strand'
import { STRAND_CSS } from './strand-css'
import { accentStyle } from './theme'
import { TOKENS_CSS } from './tokens'

/**
 * The album — every message, every photo and every contribution, on one page,
 * with the Ledger Strand as its cover.
 *
 * **One shell for every archetype.** It renders for a funeral as readily as for
 * a wedding: no target, no progress, no countdown, no count, no total, no
 * amount, and nothing that moves. What changes between them is the accent — a
 * CSS fallback, never a conditional (rule 2) — and one line of intro. There is
 * no `if (archetype === …)` in this file and there must not be one.
 *
 * **No amount anywhere.** `AlbumEntry` has no amount field, so this component
 * could not render one if it tried. That is deliberate: the strand's size bands
 * are unlabelled precisely so that amounts cannot be reverse-engineered (Part
 * C.4), and this is the artefact that gets printed and passed around.
 *
 * **Photos lazy-load with their space already reserved.** Four hundred images
 * arriving on a prepaid bundle would otherwise shift the page for a minute.
 * `loading="lazy"` is the browser's, needs no script, and the `width`/`height`
 * attributes are what make it painless — which is why M4-02 added the columns.
 */

export interface AlbumProps {
  readonly slug: string
  readonly title: string
  readonly organiserName: string | null
  readonly place: string | null
  readonly eventDate: Date | null
  readonly archetype: ArchetypeConfig
  /** The cover. Same rows as the entries, from one read of the chain. */
  readonly beads: readonly StrandBead[]
  readonly entries: readonly AlbumEntry[]
}

/**
 * A photo, as `<picture>`: AVIF with a WebP fallback, chosen by the markup.
 *
 * Each URL names exactly one representation, so nothing depends on a cache
 * understanding `Vary` (M4-01 §9). The **full** derivative, not the thumbnail —
 * the album is the first surface that needs it, and a photo somebody left for a
 * family should be looked at rather than glanced at.
 */
function Photo({
  slug,
  photo,
  from,
}: {
  slug: string
  photo: NonNullable<AlbumEntry['photo']>
  from: string
}) {
  const base = `/e/${encodeURIComponent(slug)}/photo/${photo.digest}-full`
  const sized = photo.width !== null && photo.height !== null

  return (
    <picture>
      <source srcSet={`${base}.avif`} type="image/avif" />
      <img
        className="entryPhoto"
        src={`${base}.webp`}
        alt={albumCopy.photoFrom(from)}
        loading="lazy"
        decoding="async"
        {...(sized
          ? { width: photo.width ?? undefined, height: photo.height ?? undefined }
          : { 'data-unsized': '' })}
      />
    </picture>
  )
}

function Entry({ entry, slug }: { entry: AlbumEntry; slug: string }) {
  const members = entry.members ?? []
  const when = formatDayMonthYear(entry.at)

  return (
    <li className="entry" id={`entry-${entry.id}`}>
      <p className="entryName">{nameOf(entry)}</p>
      <p className="entryWhat">{whatOf(entry)}</p>

      {entry.message === null ? null : (
        <p className="entryMessage">{entry.message}</p>
      )}

      {entry.photo === null ? null : (
        <Photo slug={slug} photo={entry.photo} from={nameOf(entry)} />
      )}

      {/*
        A group is one entry, never one per member (rule 14). It opens to names
        and not to a breakdown — the family learns that the cousins stood with
        them, not who among the cousins gave least.
      */}
      {groupSize(entry) === 0 ? null : (
        <>
          <p className="entryMembersLabel">
            {eventCopy.strand.membersLabel(groupSize(entry))}
          </p>
          <p className="entryMembers">{members.join(' · ')}</p>
        </>
      )}

      <p className="entryWhen" data-numeric="">
        {when}
      </p>
    </li>
  )
}

export function Album({
  slug,
  title,
  organiserName,
  place,
  eventDate,
  archetype,
  beads,
  entries,
}: AlbumProps) {
  const meta = [formatEventDate(eventDate), place]
    .filter((part) => part !== null && part !== '')
    .join(' · ')

  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* A death in the family must not be findable on Google (§10). The
            response header says the same for crawlers that never parse. */}
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${title} · ${albumCopy.documentSuffix}`}</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `${TOKENS_CSS}${STRAND_CSS}${ALBUM_CSS}`,
          }}
        />
      </head>

      <body>
        <main className="album" data-archetype={archetype.key} {...accentStyle(archetype)}>
          <header className="cover">
            <p className="coverLabel">{albumCopy.coverLabel}</p>
            <h1 className="coverTitle">{title}</h1>

            {organiserName === null && meta === '' ? null : (
              <p className="coverMeta" data-numeric="">
                {[organiserName, meta].filter((part) => part !== null && part !== '').join(' · ')}
              </p>
            )}

            <p className="coverIntro">{archetypeAlbumIntro[archetype.key]}</p>

            {/*
              The strand, in link mode. Every entry is already on this page, so
              a bead goes to the one it stands for rather than making a server
              round-trip to render a panel forty pixels further down.
            */}
            <LedgerStrand
              slug={slug}
              archetype={archetype}
              beads={beads}
              hrefFor={(id) => `#entry-${id}`}
            />
          </header>

          {entries.length === 0 ? null : (
            <>
              <h2 className="entriesHeading">
                {archetypeEventCopy[archetype.key].strandHeading}
              </h2>

              <ul className="entries">
                {entries.map((entry) => (
                  <Entry key={entry.id} entry={entry} slug={slug} />
                ))}
              </ul>
            </>
          )}

          <p className="albumFoot">{albumCopy.foot}</p>
        </main>
      </body>
    </html>
  )
}
