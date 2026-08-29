import sharp from 'sharp'

import { albumRenderer } from '../adapters/pdf/index.ts'
import { objectStore } from '../adapters/storage/index.ts'
import { albumColophon, albumCopy, archetypeAlbumIntro } from '../copy/album.ts'
import { archetypeEventCopy, eventCopy } from '../copy/event.ts'
import type { PrismaClient } from '../db/generated/client.ts'
import { albumForEvent, type AlbumEntry } from '../db/repositories/album.ts'
import {
  claimNextRender,
  markRenderFailed,
  markRendered,
  requestRender,
  type AlbumRenderRow,
} from '../db/repositories/album-render.ts'
import { ARCHETYPES } from '../domain/archetype/archetypes.ts'
import { photoKey } from '../domain/media/index.ts'
import {
  CONTENT,
  albumPdfKey,
  albumVersion,
  mm,
  type PrintableAlbum,
  type PrintableBead,
  type PrintableEntry,
} from '../domain/print/index.ts'
import {
  bandFor,
  beadDiameter,
  densityFor,
  positionFor,
  strandHeight,
} from '../domain/strand/index.ts'
import { groupSize, nameOf, whatOf } from '../copy/strand-words.ts'
import { formatDayMonthYear, formatEventDate } from './dates.ts'

/**
 * Turning the record into something a press can hold.
 *
 * The data is M4-02's — `albumForEvent`, read from the ledger — and the words
 * are M4-02's copy. What is new here is everything print does not share with a
 * page that scrolls: transcoding, pagination, and a fixed sheet.
 *
 * **Photographs are re-encoded, and there is no way around it.** M4-01 stores
 * AVIF and WebP; PDF embeds neither. `sharp` decodes both and writes the JPEG a
 * PDF can hold — the one part of this task that needed no new dependency.
 */

/** Enough for print at the sizes used here, and not so high the file bloats. */
const JPEG_QUALITY = 88

/**
 * How tall the cover's strand may be.
 *
 * It scales to fit rather than running off the page: at four hundred entries
 * the strand is five cords and 1 440 points tall, which is more than two sheets
 * of A5. Scaled down it reads as woven texture, which is what a strand that
 * dense is — the beads were never meant to be counted (Part C.4).
 */
const STRAND_BOX_HEIGHT = mm(64)

export interface PhotoBytes {
  readonly jpeg: Uint8Array
  readonly width: number
  readonly height: number
}

/**
 * A stored photograph, decoded and re-encoded for the page.
 *
 * Returns null rather than throwing when the object is missing: a photo that
 * cannot be fetched should cost its entry a picture, not cost a family their
 * whole album. The entry still carries the name, the words and the date.
 */
async function printablePhoto(
  eventId: string,
  photo: NonNullable<AlbumEntry['photo']>,
): Promise<PhotoBytes | null> {
  const stored = await objectStore().get(photoKey(eventId, photo.digest, 'full', 'avif'))

  if (stored === null) return null

  try {
    const { data, info } = await sharp(stored.bytes)
      // No metadata is carried across, the same as everywhere else photos are
      // handled: the pipeline that stripped the camera's location (M4-01) must
      // not be undone by the one that prints it.
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })

    return {
      jpeg: new Uint8Array(data),
      // The stored dimensions where they exist (M4-02 §1), the decoder's
      // otherwise — a row written before those columns still prints.
      width: photo.width ?? info.width,
      height: photo.height ?? info.height,
    }
  } catch {
    return null
  }
}

/**
 * The cover's strand, positioned and scaled.
 *
 * Geometry from `src/domain/strand/` — the same pure arithmetic the web page
 * uses, so the cover of the book and the cover of the page are one picture
 * rather than two drawings of an idea.
 *
 * **The amount stops here.** It is read to choose a band, the band chooses a
 * diameter, and a diameter is what crosses into the renderer. `PrintableBead`
 * has no amount field, so the printed album cannot show one even by accident.
 */
function coverBeads(
  beads: Awaited<ReturnType<typeof albumForEvent>>['beads'],
  amountsPublic: boolean,
): { beads: readonly PrintableBead[]; height: number } {
  if (beads.length === 0) return { beads: [], height: 0 }

  const density = densityFor(beads.length)
  const natural = strandHeight(beads.length, density)
  const naturalWidth = Math.max(density.cords, 1) * 64

  const scale = Math.min(
    1,
    STRAND_BOX_HEIGHT / Math.max(natural, 1),
    CONTENT.width / Math.max(naturalWidth, 1),
  )

  const placed = beads.map((bead, index) => {
    const { x, y } = positionFor(index, density)
    const band = bandFor({ form: bead.form, amount: bead.amount, amountsPublic })

    return {
      x: x * scale,
      y: y * scale,
      diameter: beadDiameter(band, density) * scale,
      form: bead.form,
    }
  })

  return { beads: placed, height: natural * scale }
}

export interface AlbumSubject {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly archetype: keyof typeof ARCHETYPES
  readonly organiserName: string | null
  readonly place: string | null
  readonly eventDate: Date | null
}

/**
 * Everything the renderer needs, and nothing it does not.
 *
 * Names are already resolved — a quiet giver is "Someone" before the renderer
 * sees them — because who is named is a decision about a person and not about a
 * page, and it is made in exactly one place for both the screen and the paper.
 */
export async function printableAlbum(
  db: PrismaClient,
  subject: AlbumSubject,
  { generatedAt }: { generatedAt: Date },
): Promise<PrintableAlbum> {
  const archetype = ARCHETYPES[subject.archetype]
  const { beads, entries } = await albumForEvent(db, subject.id)

  const printableEntries: PrintableEntry[] = []

  for (const entry of entries) {
    const photo =
      entry.photo === null ? null : await printablePhoto(subject.id, entry.photo)

    printableEntries.push({
      id: entry.id,
      name: nameOf(entry),
      what: whatOf(entry),
      message: entry.message,
      members: entry.members ?? [],
      membersLabel:
        groupSize(entry) === 0 ? null : eventCopy.strand.membersLabel(groupSize(entry)),
      when: formatDayMonthYear(entry.at) ?? '',
      photo,
    })
  }

  const meta = [formatEventDate(subject.eventDate), subject.place]
    .filter((part) => part !== null && part !== '')
    .join(' · ')

  const cover = coverBeads(beads, archetype.amountsPublic)

  return {
    archetype,
    cover: {
      title: subject.title,
      kicker: archetypeEventCopy[subject.archetype].strandHeading,
      organiserName: subject.organiserName,
      meta: meta === '' ? null : meta,
      intro: archetypeAlbumIntro[subject.archetype],
      beads: cover.beads,
      strandHeight: cover.height,
    },
    entries: printableEntries,
    colophon: albumColophon(formatDayMonthYear(generatedAt) ?? ''),
    generatedAt,
  }
}

/** What the version is computed from: what the album would draw, and nothing else. */
export async function currentAlbumVersion(
  db: PrismaClient,
  subject: AlbumSubject,
): Promise<{ version: string; entryCount: number }> {
  const { entries } = await albumForEvent(db, subject.id)

  return {
    version: albumVersion({
      title: subject.title,
      organiserName: subject.organiserName,
      archetype: subject.archetype,
      entries: entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        message: entry.message,
        photoDigest: entry.photo?.digest ?? null,
        ...(entry.members === undefined ? {} : { members: entry.members }),
      })),
    }),
    entryCount: entries.length,
  }
}

/** The organiser asking for one. Idempotent — see `requestRender`. */
export async function requestAlbumPdf(
  db: PrismaClient,
  subject: AlbumSubject,
  { now }: { now: Date },
): Promise<AlbumRenderRow | null> {
  const { version, entryCount } = await currentAlbumVersion(db, subject)

  // Nothing to print is not an error and not a queued job. The screen says so.
  if (entryCount === 0) return null

  return requestRender(db, { eventId: subject.id, version, now })
}

export interface RenderReport {
  readonly rendered: number
  readonly failed: number
}

/**
 * One pass of `pnpm render`.
 *
 * Claims a job at a time and renders until there is nothing pending. Each claim
 * is a conditional update, so two overlapping runs cannot render the same album
 * twice — the same shape as claiming the last chair (M2-04).
 */
export async function renderPendingAlbums(
  db: PrismaClient,
  {
    now,
    limit = 20,
    subjectFor,
  }: {
    now: Date
    limit?: number
    subjectFor: (eventId: string) => Promise<AlbumSubject | null>
  },
): Promise<RenderReport> {
  let rendered = 0
  let failed = 0

  for (let taken = 0; taken < limit; taken += 1) {
    const job = await claimNextRender(db, { now })
    if (job === null) break

    try {
      const subject = await subjectFor(job.eventId)
      if (subject === null) throw new Error('no such event')

      const album = await printableAlbum(db, subject, { generatedAt: now })
      const bytes = await albumRenderer().render(album)

      const key = albumPdfKey(job.eventId, job.version)
      await objectStore().put(key, { bytes, contentType: 'application/pdf' })

      await markRendered(db, { id: job.id, objectKey: key, now })
      rendered += 1
    } catch (error) {
      /*
       * A short phrase, never the exception's message.
       *
       * This string reaches the organiser's screen and an unattended job's log,
       * and neither is a place for a file path, a connection string or a
       * contributor's name (rule 8).
       */
      const reason = error instanceof Error ? error.message.slice(0, 80) : 'unknown'

      await markRenderFailed(db, {
        id: job.id,
        reason: reason.replace(/[^\w .,-]/g, ''),
        now,
      })
      failed += 1
    }
  }

  return { rendered, failed }
}

/** The download's address. Content-addressed, so it can be cached forever. */
export function albumPdfPath(slug: string, version: string): string {
  return `/e/${encodeURIComponent(slug)}/album/${version}.pdf`
}

export { albumCopy }
