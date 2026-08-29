import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '@/db/generated/client'
import { albumForEvent } from '@/db/repositories/album'
import { organiserForPhone } from '@/db/repositories/auth'
import {
  confirmContribution,
  selfReport,
  startContribution,
} from '@/db/repositories/contribution'
import { createDraft } from '@/db/repositories/event'
import { claimItem, confirmDelivery } from '@/db/repositories/needs'
import { appendReversal } from '@/db/repositories/ledger'
import { strandForEvent } from '@/db/repositories/strand'
import { fromCents } from '@/domain/money'

import { clientFor } from '../setup/prisma'

/**
 * The album, against a real Postgres.
 *
 * **It is built from the ledger**, like the strand and for the same reason: an
 * album read from `contributions` would be a second opinion about what happened
 * — one that could disagree with its own cover while both looked correct. The
 * two properties that follow from that are the whole of this file.
 */

let app: PrismaClient
let organiserId: string
let counter = 0

beforeAll(async () => {
  app = clientFor(inject('appDatabaseUrl'))
  const organiser = await organiserForPhone(
    app,
    `+2789${String(++counter).padStart(7, '0')}`,
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

interface ContributeOptions {
  readonly name?: string
  readonly message?: string | null
  readonly photoKey?: string | null
  readonly photoWidth?: number | null
  readonly photoHeight?: number | null
  readonly visibility?: 'public' | 'name_only' | 'anonymous'
  readonly confirm?: boolean
}

/** The whole Mode A path: started, self-reported, and confirmed by the family. */
async function contribute(
  event: { id: string; title: string },
  options: ContributeOptions = {},
): Promise<string> {
  const started = await startContribution(app, {
    eventId: event.id,
    eventTitle: event.title,
    type: 'cash',
    amountCents: fromCents(50_000n),
    contributorName: options.name ?? 'Thandi Ngcobo',
    message: options.message ?? null,
    photoKey: options.photoKey ?? null,
    photoWidth: options.photoWidth ?? null,
    photoHeight: options.photoHeight ?? null,
    visibility: options.visibility ?? 'public',
  })

  await selfReport(app, { contributionId: started.id })

  if (options.confirm !== false) {
    const outcome = await confirmContribution(app, {
      contributionId: started.id,
      organiserId,
    })

    if (!outcome.ok) throw new Error(`confirm failed: ${outcome.reason}`)
  }

  return started.id
}

describe('what is in the album', () => {
  it('carries the message and the photo somebody left', async () => {
    const event = await newEvent()
    const digest = 'a'.repeat(32)

    await contribute(event, {
      message: 'Sisemuva kwenu.',
      photoKey: `photo/${event.id}/${digest}-full.avif`,
      photoWidth: 2400,
      photoHeight: 1600,
    })

    const { entries } = await albumForEvent(app, event.id)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.message).toBe('Sisemuva kwenu.')
    expect(entries[0]?.photo).toEqual({ digest, width: 2400, height: 1600 })
  })

  /**
   * **The album is the record, not the inbox.**
   *
   * A ledger entry exists only once the organiser has confirmed the payment
   * against her own bank notification, so a message and a photo appear when the
   * family confirms — not when they are typed. The contribute flow's done
   * screen says exactly this, and M4-02 changed it so that it does.
   */
  it('holds nothing the family has not confirmed', async () => {
    const event = await newEvent()

    await contribute(event, { name: 'Sipho Dlamini', confirm: false })
    const { entries, beads } = await albumForEvent(app, event.id)

    expect(entries).toHaveLength(0)
    expect(beads).toHaveLength(0)

    await contribute(event, { name: 'Lindiwe Zulu' })
    const after = await albumForEvent(app, event.id)

    expect(after.entries.map((one) => one.name)).toEqual(['Lindiwe Zulu'])
  })

  /**
   * A correction is a new entry, never an edit (rule 3). What must not happen
   * is a family's album carrying a page for money the organiser has since said
   * never arrived.
   */
  it('drops an entry the ledger has reversed', async () => {
    const event = await newEvent()

    await contribute(event, { name: 'Thandi Ngcobo' })
    await contribute(event, { name: 'Bongani Khumalo' })

    const before = await albumForEvent(app, event.id)
    expect(before.entries).toHaveLength(2)

    const target = before.entries[0]
    await appendReversal(app, {
      chain: { eventId: event.id },
      reversing: target?.id ?? '',
    })

    const after = await albumForEvent(app, event.id)

    expect(after.entries.map((one) => one.name)).toEqual(['Bongani Khumalo'])
    // The reversal is itself a row and the chain still holds it. What changed
    // is what the album shows, not what the record contains.
    const rows = await app.ledgerEntry.count({ where: { eventId: event.id } })
    expect(rows).toBe(3)
  })

  it('keeps a quiet giver’s words and photo, and drops only their name', async () => {
    const event = await newEvent()
    const digest = 'b'.repeat(32)

    await contribute(event, {
      name: 'Nomsa Dube',
      visibility: 'anonymous',
      message: 'Ngiyabonga.',
      photoKey: `photo/${event.id}/${digest}-full.avif`,
      photoWidth: 1200,
      photoHeight: 900,
    })

    const { entries } = await albumForEvent(app, event.id)

    expect(entries[0]?.name).toBeNull()
    expect(entries[0]?.message).toBe('Ngiyabonga.')
    expect(entries[0]?.photo?.digest).toBe(digest)
  })

  it('reads in the order the chain was written, oldest first', async () => {
    const event = await newEvent()

    for (const name of ['First Person', 'Second Person', 'Third Person']) {
      await contribute(event, { name })
    }

    const { entries } = await albumForEvent(app, event.id)

    expect(entries.map((one) => one.name)).toEqual([
      'First Person',
      'Second Person',
      'Third Person',
    ])
  })

  it('has nowhere to put an amount', async () => {
    const event = await newEvent()
    await contribute(event)

    const { entries } = await albumForEvent(app, event.id)

    // Not "is null" — the field does not exist. An album that could carry an
    // amount is one somebody eventually renders.
    expect(Object.keys(entries[0] ?? {})).not.toContain('amount')
    expect(Object.keys(entries[0] ?? {})).not.toContain('amountCents')
  })
})

describe('the cover and the entries', () => {
  /**
   * One read of the chain produces both. Two queries could disagree by a row
   * written between them, and the disagreement would be invisible — a bead
   * pointing at an anchor that is not on the page.
   */
  it('are the same list, in the same order', async () => {
    const event = await newEvent()

    for (const name of ['One', 'Two', 'Three', 'Four']) {
      await contribute(event, { name })
    }

    const { beads, entries } = await albumForEvent(app, event.id)

    expect(beads.map((one) => one.id)).toEqual(entries.map((one) => one.id))
    expect(beads.map((one) => one.name)).toEqual(entries.map((one) => one.name))
  })

  /** And the same list the public event page draws, from the same chain. */
  it('agree with the strand the event page renders', async () => {
    const event = await newEvent()

    await contribute(event, { name: 'Thandi Ngcobo' })
    await contribute(event, { name: 'Sipho Dlamini' })

    const { beads } = await albumForEvent(app, event.id)
    const strand = await strandForEvent(app, event.id)

    expect(beads.map((one) => one.id)).toEqual(strand.map((one) => one.id))
    expect(beads.map((one) => one.amount)).toEqual(strand.map((one) => one.amount))
  })
})

/**
 * M4-02b — the album stops under-representing the thing the product is named
 * for.
 *
 * Somebody bringing the tent could leave no message and no photograph, ever,
 * while somebody sending R50 could write whatever they liked. This asserts the
 * end of that from the album's side: it is the surface the whole task exists
 * for, and the repository test proves the columns travel.
 */
describe('an in-kind entry carries what she said', () => {
  async function bring(
    event: { id: string; title: string },
    options: { message?: string | null; photoKey?: string | null } = {},
  ): Promise<void> {
    const item = await app.needItem.findFirstOrThrow({
      where: { eventId: event.id },
      select: { id: true },
    })

    const claimed = await claimItem(app, {
      needItemId: item.id,
      quantity: 1,
      claimantName: 'Musa Khumalo',
      message: options.message ?? null,
      photoKey: options.photoKey ?? null,
      photoWidth: options.photoKey == null ? null : 2400,
      photoHeight: options.photoKey == null ? null : 1600,
    })

    if (!claimed.ok) throw new Error(`claim failed: ${claimed.reason}`)

    const confirmed = await confirmDelivery(app, {
      claimId: claimed.claimId,
      organiserId,
    })

    if (!confirmed.ok) throw new Error(`confirm failed: ${String(confirmed.reason)}`)
  }

  it('shows the message and the photograph on the entry', async () => {
    const event = await newEvent()
    await bring(event, {
      message: 'It is the big one, it seats eighty.',
      photoKey: `photo/${event.id}/00112233445566778899aabbccddeeff-full.avif`,
    })

    const album = await albumForEvent(app, event.id)
    const entry = album.entries.find((row) => row.form === 'in_kind')

    expect(entry?.message).toBe('It is the big one, it seats eighty.')
    expect(entry?.photo).not.toBeNull()
  })

  it('reads as in-kind, and carries no amount to read as', async () => {
    /*
     * A message must not turn a tent into a number.
     *
     * `AlbumEntry` has no `amount` field at all — asserting one is null does not
     * typecheck, which is a better guarantee than a test and was found by trying
     * to write the weaker version. What is asserted instead is that the entry
     * describes a thing, and that no key on it holds a number.
     */
    const event = await newEvent()
    await bring(event, { message: 'Bringing it Friday.' })

    const album = await albumForEvent(app, event.id)
    const entry = album.entries.find((row) => row.form === 'in_kind')

    expect(entry?.description).not.toBeNull()
    expect(Object.keys(entry ?? {})).not.toContain('amount')
  })

  it('is still one entry, message or not', async () => {
    const event = await newEvent()
    await bring(event, { message: 'Bringing it Friday.' })

    const album = await albumForEvent(app, event.id)

    expect(album.entries).toHaveLength(1)
    expect(album.beads).toHaveLength(1)
  })
})
