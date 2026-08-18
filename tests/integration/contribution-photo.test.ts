import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import { pendingReports, selfReport, startContribution } from '@/db/repositories/contribution'
import { createDraft } from '@/db/repositories/event'
import { findGpsFix, photoKey, scanImageMetadata } from '@/domain/media'
import { fromCents } from '@/domain/money'

import { clientFor } from '../setup/prisma'

/**
 * A photo from the form to the row and back out again, against a real Postgres
 * and a real object store.
 *
 * The object store is pointed at a temporary directory **before the adapter is
 * imported**, so this reads every byte the pipeline actually wrote — which is
 * the only way to assert the thing that matters most here: that the original,
 * with the family's address inside it, was never stored at all.
 */

let app: PrismaClient
let organiserId: string
let counter = 0
let storeRoot: string

// Set before the dynamic imports below: the store reads its root once, at
// module load.
type PhotoModule = typeof import('@/lib/contribution-photo')
let photos: PhotoModule

beforeAll(async () => {
  storeRoot = await mkdtemp(join(tmpdir(), 'isipheko-photos-'))
  process.env.OBJECT_STORE_DIR = storeRoot

  photos = await import('@/lib/contribution-photo')

  app = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(
    app,
    `+2788${String(++counter).padStart(7, '0')}`,
  )
  organiserId = organiser.id
})

afterAll(async () => {
  await app.$disconnect()
})

async function newEvent(): Promise<{ id: string; title: string }> {
  const draft = await createDraft(app, {
    organiserId,
    archetype: 'umngcwabo',
    title: 'Nokuthula Mthembu',
    subtitle: null,
    place: null,
    eventDate: null,
  })

  return { id: draft.id, title: 'Nokuthula Mthembu' }
}

/** A photo with the family's house in it, the way a phone hands one over. */
async function phonePhoto(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 900, height: 600, channels: 3, background: '#4A7C59' } })
      .withExif({
        IFD0: { Make: 'Apple', Model: 'iPhone 13' },
        IFD3: {
          GPSLatitudeRef: 'S',
          GPSLatitude: '29/1 51/1 3600/1000',
          GPSLongitudeRef: 'E',
          GPSLongitude: '31/1 1/1 7200/1000',
        },
      })
      .jpeg()
      .toBuffer(),
  )
}

const asFile = (bytes: Uint8Array, name = 'photo.jpg', type = 'image/jpeg'): File =>
  new File([bytes as unknown as BlobPart], name, { type })

describe('accepting a photo', () => {
  it('stores four derivatives and nothing else', async () => {
    const event = await newEvent()
    const outcome = await photos.acceptPhoto(asFile(await phonePhoto()), event.id)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const written = (await readdir(join(storeRoot, 'photo', event.id)))
      .filter((name) => !name.endsWith('.type'))
      .sort()

    expect(written).toEqual([
      `${outcome.digest}-full.avif`,
      `${outcome.digest}-full.webp`,
      `${outcome.digest}-thumb.avif`,
      `${outcome.digest}-thumb.webp`,
    ])
  })

  /**
   * **The original is never written.** Keeping it "just in case" would keep the
   * GPS with it, in a bucket, for as long as the bucket exists — which is the
   * one outcome this whole task is here to prevent.
   */
  it('leaves nothing on disk that still knows where the photo was taken', async () => {
    const event = await newEvent()
    const outcome = await photos.acceptPhoto(asFile(await phonePhoto()), event.id)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const { objectStore } = await import('@/adapters/storage')
    const store = objectStore()

    for (const size of ['full', 'thumb'] as const) {
      for (const format of ['avif', 'webp'] as const) {
        const stored = await store.get(photoKey(event.id, outcome.digest, size, format))

        expect(stored).not.toBeNull()
        expect(stored?.contentType).toBe(`image/${format}`)
        expect(scanImageMetadata(stored?.bytes ?? new Uint8Array())).toEqual([])
        expect(findGpsFix(stored?.bytes ?? new Uint8Array())).toBeNull()
      }
    }
  })

  it.each([
    ['an SVG wearing a .jpg', new TextEncoder().encode('<svg xmlns="x"><script/></svg>')],
    ['a PDF', new TextEncoder().encode('%PDF-1.7\nnot a photo')],
  ])('refuses %s, whatever the name and content type say', async (_what, content) => {
    const event = await newEvent()
    const outcome = await photos.acceptPhoto(
      asFile(new Uint8Array(content), 'holiday.jpg', 'image/jpeg'),
      event.id,
    )

    expect(outcome).toEqual({ ok: false, reason: 'not-an-image' })
  })

  it('refuses a HEIC by name, so the message can say what to do', async () => {
    const event = await newEvent()
    const heic = new Uint8Array([
      0, 0, 0, 24, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0,
    ])

    expect(await photos.acceptPhoto(asFile(heic, 'IMG_0001.HEIC'), event.id)).toEqual({
      ok: false,
      reason: 'heic',
    })
  })

  it('refuses anything over the cap', async () => {
    const event = await newEvent()
    const huge = new Uint8Array(9 * 1024 * 1024)
    huge.set([0xff, 0xd8, 0xff])

    expect(await photos.acceptPhoto(asFile(huge), event.id)).toEqual({
      ok: false,
      reason: 'too-big',
    })
  })

  it('refuses a JPEG that is only the first few bytes of one', async () => {
    const event = await newEvent()
    const truncated = (await phonePhoto()).slice(0, 300)

    expect(await photos.acceptPhoto(asFile(truncated), event.id)).toEqual({
      ok: false,
      reason: 'unreadable',
    })
  })

  it('gives the same photo the same name twice', async () => {
    const event = await newEvent()
    const photo = await phonePhoto()

    const first = await photos.acceptPhoto(asFile(photo), event.id)
    const second = await photos.acceptPhoto(asFile(photo), event.id)

    expect(first.ok && second.ok && first.digest).toBe(second.ok && second.digest)
  })
})

describe('the ticket that carries it forward', () => {
  it('is accepted for the umcimbi it was signed for', async () => {
    const event = await newEvent()
    const outcome = await photos.acceptPhoto(asFile(await phonePhoto()), event.id)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(photos.digestFromTicket(outcome.ticket, event.id)).toBe(outcome.digest)
  })

  it('is refused for any other umcimbi, and refused if edited', async () => {
    const event = await newEvent()
    const other = await newEvent()
    const outcome = await photos.acceptPhoto(asFile(await phonePhoto()), event.id)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(photos.digestFromTicket(outcome.ticket, other.id)).toBeNull()
    expect(photos.digestFromTicket(outcome.digest, event.id)).toBeNull()
    expect(
      photos.digestFromTicket(`${'0'.repeat(32)}.${outcome.ticket.split('.')[1] ?? ''}`, event.id),
    ).toBeNull()
  })
})

describe('the row', () => {
  it('carries the key, and the organiser’s queue carries it back out', async () => {
    const event = await newEvent()
    const outcome = await photos.acceptPhoto(asFile(await phonePhoto()), event.id)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const started = await startContribution(app, {
      eventId: event.id,
      eventTitle: event.title,
      type: 'cash',
      amountCents: fromCents(50_000n),
      contributorName: 'Thandi Ngcobo',
      message: 'Sisemuva kwenu.',
      visibility: 'public',
      photoKey: photos.fullPhotoKey(event.id, outcome.digest),
    })

    await selfReport(app, { contributionId: started.id })

    const row = await app.contribution.findUniqueOrThrow({ where: { id: started.id } })
    expect(row.photoKey).toBe(`photo/${event.id}/${outcome.digest}-full.avif`)

    const queue = await pendingReports(app, { eventId: event.id, organiserId })
    expect(queue[0]?.photoKey).toBe(row.photoKey)
    expect(photos.digestFromKey(queue[0]?.photoKey ?? null)).toBe(outcome.digest)
  })

  it('is a complete contribution without one', async () => {
    const event = await newEvent()
    const started = await startContribution(app, {
      eventId: event.id,
      eventTitle: event.title,
      type: 'cash',
      amountCents: fromCents(10_000n),
      contributorName: 'Sipho Dlamini',
      visibility: 'public',
    })

    const row = await app.contribution.findUniqueOrThrow({ where: { id: started.id } })
    expect(row.photoKey).toBeNull()
  })
})
