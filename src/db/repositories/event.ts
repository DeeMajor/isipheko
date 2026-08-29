import type { PrismaClient } from '@/db/generated/client'
import { ARCHETYPES, type ArchetypeKey } from '@/domain/archetype'
import type { PaymentMode } from '@/domain/contribution'
import { generateSlug } from '@/domain/event'
import { derivePrefix, generateCode } from '@/domain/reference'
import { needTemplate } from '@/copy/need-templates'

/**
 * Events and their drafts.
 *
 * Two things here are load-bearing rather than convenient:
 *
 * **Every read is scoped to an organiser, except the public one.** A draft
 * fetched by id alone would be readable by anybody who learned an id, and the
 * only thing making that hard would be that ids are hard to guess — which is
 * not an access control.
 *
 * **`publicEventBySlug` filters on `status: 'published'`.** That single clause
 * is what makes a draft unreachable, so it lives here rather than in a route,
 * where the next route would forget it.
 */

export interface DraftSummary {
  id: string
  slug: string
  archetype: ArchetypeKey
  title: string
  subtitle: string | null
  place: string | null
  eventDate: Date | null
  isPublished: boolean
  needCount: number
  witnessCount: number
  /** M3-01's status, which M3-02 turned into the publish gate. */
  organiserVerified: boolean
  /**
   * How this event takes money (M5-02). The dashboard needs it because *where
   * the money is* has a different answer per mode, and it is the sentence an
   * organiser acts on.
   */
  mode: PaymentMode
}

/**
 * Creates the draft and seeds its needs from the archetype's template, in one
 * transaction — a draft that lost its list halfway through would look to the
 * organiser like the template simply failed to appear.
 */
export async function createDraft(
  db: PrismaClient,
  {
    organiserId,
    archetype,
    title,
    subtitle,
    place,
    eventDate,
  }: {
    organiserId: string
    archetype: ArchetypeKey
    title: string
    subtitle: string | null
    place: string | null
    eventDate: Date | null
  },
): Promise<{ id: string; slug: string }> {
  const config = ARCHETYPES[archetype]
  const template = needTemplate(config.needsTemplate)

  return db.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        organiserId,
        slug: generateSlug(),
        // The code on the trust panel, which a contributor types into
        // isipheko.co.za/check themselves rather than trusting a number on the
        // page (§10). Allocated here so an event never exists without one; a
        // collision is refused by the unique index and retried by
        // `allocateEventReference`.
        refPrefix: derivePrefix(title),
        refCode: generateCode(),
        archetype,
        // Denormalised, and a CHECK constraint refuses a pair that disagrees.
        // Taken from the config rather than from the form, so the two cannot.
        archetypeGroup: config.group,
        title,
        subtitle,
        place,
        eventDate,
        visibilityDefault: config.amountsPublic ? 'public' : 'name_only',
      },
      select: { id: true, slug: true },
    })

    await tx.needItem.createMany({
      data: template.map((item, index) => ({
        eventId: event.id,
        label: item.label,
        note: item.note,
        // Marks the row as ours rather than theirs, so the needs step can say
        // "Suggested — edit or remove it". Saving the step clears it: from then
        // on the list is the organiser's.
        category: 'template',
        sortOrder: index,
      })),
    })

    return event
  })
}

/** Scoped to the organiser: an id is not a permission. */
export async function draftForOrganiser(
  db: PrismaClient,
  { id, organiserId }: { id: string; organiserId: string },
): Promise<DraftSummary | null> {
  const event = await db.event.findFirst({
    where: { id, organiserId },
    select: {
      id: true,
      slug: true,
      archetype: true,
      title: true,
      subtitle: true,
      place: true,
      eventDate: true,
      status: true,
      mode: true,
      organiser: { select: { idVerificationStatus: true } },
      _count: { select: { needItems: true, witnesses: true } },
    },
  })

  if (event === null) return null

  return {
    id: event.id,
    slug: event.slug,
    archetype: event.archetype,
    title: event.title,
    subtitle: event.subtitle,
    place: event.place,
    eventDate: event.eventDate,
    isPublished: event.status === 'published',
    needCount: event._count.needItems,
    witnessCount: event._count.witnesses,
    organiserVerified: event.organiser.idVerificationStatus === 'verified',
    mode: event.mode,
  }
}

export interface NeedRow {
  id: string
  label: string
  note: string | null
  fromTemplate: boolean
}

export async function needsForEvent(
  db: PrismaClient,
  eventId: string,
): Promise<readonly NeedRow[]> {
  const items = await db.needItem.findMany({
    where: { eventId, status: 'active' },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, label: true, note: true, category: true },
  })

  return items.map((item) => ({
    id: item.id,
    label: item.label,
    note: item.note,
    // `category` is 'template' until the organiser touches the row. It is how
    // the screen knows to say "Suggested — edit or remove it".
    fromTemplate: item.category === 'template',
  }))
}

/** A claim that still holds its quantity (M2-03 §4): the row it is on is
 *  somebody's promise or somebody's delivery, and must not disappear. */
const LIVE_CLAIM_STATUSES = ['claimed', 'delivered'] as const

export interface ReconcileNeedsResult {
  /**
   * Labels of rows the organiser removed that stayed anyway, because a live
   * claim stands on them. Everything else she did was saved.
   */
  readonly kept: readonly string[]
}

/**
 * Saves the needs list by identity, and refuses to delete a claimed row.
 *
 * **This replaced a delete-everything-and-recreate** (UX-03). That shape was
 * harmless while a need item was only a label — and stopped being harmless the
 * moment M2-03 hung claims off the rows: `need_claims.need_item_id` cascades,
 * so one revisit of the needs step after publishing deleted every claim on the
 * umcimbi — "I'll bring the tent", message and photograph included — silently.
 * The exact class M3-03 §1 fixed for witnesses, one table over.
 *
 * So rows are reconciled on their ids: a row still on screen keeps its id and
 * its claims, only rows actually removed are deleted, and **a removed row with
 * a live claim is kept rather than deleted** — taking it off the list would
 * take somebody's promise off the record, and a cascade that eats a message
 * and a photo attached to "I'll bring the tent" is not recoverable. The kept
 * labels come back so the screen can say why the row is still there.
 *
 * The refusal's mechanism is the conditional delete (`claims: none`), not the
 * pre-read: a claim landing between the read and the delete still survives,
 * and the re-read after a short count is what names it.
 *
 * Scoped to `status: 'active'` throughout — the setup screen shows only those,
 * so suggested and declined rows are not "absent from the form", they were
 * never on it. The old delete-everything erased them too.
 *
 * An untouched row keeps its `category`, so a template row the organiser has
 * not edited stays marked "Suggested — edit or remove it"; editing one clears
 * the marker, which is what the marker means.
 */
export async function reconcileNeeds(
  db: PrismaClient,
  eventId: string,
  items: readonly { id: string | null; label: string; note: string }[],
): Promise<ReconcileNeedsResult> {
  return db.$transaction(async (tx) => {
    const existing = await tx.needItem.findMany({
      where: { eventId, status: 'active' },
      select: {
        id: true,
        label: true,
        note: true,
        claims: {
          where: { status: { in: [...LIVE_CLAIM_STATUSES] } },
          select: { id: true },
          take: 1,
        },
      },
    })

    const byId = new Map(existing.map((row) => [row.id, row]))
    const submittedIds = new Set(
      items.map((item) => item.id).filter((id): id is string => id !== null),
    )

    const removed = existing.filter((row) => !submittedIds.has(row.id))
    const kept = removed.filter((row) => row.claims.length > 0).map((row) => row.label)
    const removable = removed.filter((row) => row.claims.length === 0)

    if (removable.length > 0) {
      const { count } = await tx.needItem.deleteMany({
        where: {
          id: { in: removable.map((row) => row.id) },
          eventId,
          claims: { none: { status: { in: [...LIVE_CLAIM_STATUSES] } } },
        },
      })

      if (count !== removable.length) {
        // A claim landed between the read and the delete. The conditional
        // delete held; the survivor is named like the ones the read caught.
        const survivors = await tx.needItem.findMany({
          where: { id: { in: removable.map((row) => row.id) } },
          select: { label: true },
        })
        kept.push(...survivors.map((row) => row.label))
      }
    }

    let sortOrder = 0
    for (const item of items) {
      const row = item.id === null ? undefined : byId.get(item.id)

      if (row === undefined) {
        // A new row — or an id this event does not own, which counts as one:
        // an id in a form is not a permission to edit somebody else's row.
        await tx.needItem.create({
          data: {
            eventId,
            label: item.label,
            note: item.note === '' ? null : item.note,
            sortOrder,
          },
        })
      } else {
        const touched = row.label !== item.label || (row.note ?? '') !== item.note

        await tx.needItem.update({
          where: { id: row.id },
          data: {
            label: item.label,
            note: item.note === '' ? null : item.note,
            sortOrder,
            ...(touched ? { category: null } : {}),
          },
        })
      }

      sortOrder += 1
    }

    // Rows that stayed against the organiser's removal render after the ones
    // she kept on purpose, in a stable order.
    for (const label of kept) {
      const row = existing.find((candidate) => candidate.label === label)
      if (row !== undefined) {
        await tx.needItem.update({ where: { id: row.id }, data: { sortOrder } })
        sortOrder += 1
      }
    }

    return { kept }
  })
}

export interface WitnessRow {
  id: string
  name: string
  phoneE164: string
}

export async function witnessesForEvent(
  db: PrismaClient,
  eventId: string,
): Promise<readonly WitnessRow[]> {
  return db.witness.findMany({
    where: { eventId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, phoneE164: true },
  })
}

/**
 * Saves the list the organiser has on screen, **without losing what anybody has
 * already answered**.
 *
 * Written as `invited`, and nothing is sent: no SMS provider is configured
 * (M1-06 §6), so M3-03 gives her a link to pass on the way she already talks to
 * these people.
 *
 * **This used to delete every row and write them again**, which was fine while
 * a witness was only a name and a number. It is not fine now. Every path in the
 * setup flow saves what is on screen first (M1-07 §8), so adding a third
 * umkhaphi would have wiped the acceptances and the live invite links of the
 * first two — silently, with no error and nothing in the interface to suggest
 * anything had happened.
 *
 * So it reconciles on the phone number, which is what identifies a person here
 * and what the unique index is already on: a row whose number is still in the
 * list keeps its id, its status and its invite, and only a person actually
 * removed is deleted. A renamed row keeps its answer, because correcting the
 * spelling of somebody's name is not un-asking them.
 */
export async function replaceWitnesses(
  db: PrismaClient,
  eventId: string,
  people: readonly { name: string; phoneE164: string }[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.witness.findMany({
      where: { eventId },
      select: { id: true, name: true, phoneE164: true },
    })

    const keeping = new Set(people.map((person) => person.phoneE164))

    await tx.witness.deleteMany({
      where: { eventId, phoneE164: { notIn: [...keeping] } },
    })

    for (const person of people) {
      const match = existing.find((row) => row.phoneE164 === person.phoneE164)

      if (match === undefined) {
        await tx.witness.create({
          data: { eventId, name: person.name, phoneE164: person.phoneE164 },
        })
      } else if (match.name !== person.name) {
        await tx.witness.update({ where: { id: match.id }, data: { name: person.name } })
      }
    }
  })
}

export async function updateDetails(
  db: PrismaClient,
  { id, organiserId }: { id: string; organiserId: string },
  details: {
    title: string
    subtitle: string | null
    place: string | null
    eventDate: Date | null
  },
): Promise<void> {
  await db.event.updateMany({ where: { id, organiserId }, data: details })
}

/**
 * Publishing is a conditional update on `status`, scoped to the organiser, to
 * the draft state, and — since M3-02 — to the organiser being verified. Two
 * taps on a slow connection publish once, and a caller that never asked
 * `canPublish` publishes nothing.
 *
 * **This is a second refusal and it earns its place.** M2-05 §7 warns that two
 * application-level checks of one condition are one check with a spare, because
 * neither one's removal is noticed. Here the second layer is Postgres: the
 * condition is part of the UPDATE, it refuses atomically, and an integration
 * test calls this function directly on an unverified organiser and watches the
 * row stay a draft.
 *
 * Deliberately **not** a read of the organiser followed by a write to the
 * event. That reintroduces exactly the race the conditional update exists to
 * close, and it would do so in the one statement that decides whether a page
 * asking strangers for money becomes reachable.
 */
export async function publishDraft(
  db: PrismaClient,
  { id, organiserId }: { id: string; organiserId: string },
): Promise<boolean> {
  const { count } = await db.event.updateMany({
    where: {
      id,
      organiserId,
      status: 'draft',
      organiser: { is: { idVerificationStatus: 'verified' } },
    },
    data: { status: 'published' },
  })

  return count === 1
}

export interface PublicEvent {
  /** Server-side only — the ledger chain is keyed by it. Never rendered. */
  id: string
  slug: string
  /** `MTH-4K7B2X` — what a contributor types into /check themselves. */
  reference: { prefix: string; code: string }
  archetype: ArchetypeKey
  title: string
  subtitle: string | null
  place: string | null
  eventDate: Date | null
  organiserName: string | null
  /**
   * How this event takes money (M5-02).
   *
   * The public page needs it because the trust panel's money sentence has a
   * different answer per mode, and the ledger-only one — *"nothing on this page
   * can take money from you yet"* — is false on a hosted event, on the panel a
   * stranger reads to decide whether to trust the page at all (M5-02b).
   */
  mode: PaymentMode
  /**
   * Null when the organiser is not verified. After M3-02 a published event
   * implies a verified organiser, so this is set on every page a stranger can
   * reach — but the page reads it rather than assuming it, because a page that
   * assumes will eventually assert something false.
   */
  organiserVerifiedAt: Date | null
  /**
   * Abakhaphi who **agreed**, by name only (M3-03).
   *
   * Never a phone number, never a count of who was asked, and never anybody who
   * declined or has not answered. A name here means that person said yes — this
   * is honour, not audit.
   */
  witnesses: readonly string[]
  needs: readonly {
    id: string
    label: string
    note: string | null
    quantityRequired: number
    quantityClaimed: number
    unit: string | null
  }[]
}

/**
 * The one read that is not scoped to an organiser — and the only place the
 * `published` filter can be forgotten, which is why it is one function rather
 * than a query written out at each call site.
 *
 * A draft returns null here however correct the slug is.
 */
export async function publicEventBySlug(
  db: PrismaClient,
  slug: string,
): Promise<PublicEvent | null> {
  const event = await db.event.findFirst({
    where: { slug, status: 'published' },
    select: {
      id: true,
      slug: true,
      refPrefix: true,
      refCode: true,
      archetype: true,
      title: true,
      subtitle: true,
      place: true,
      eventDate: true,
      mode: true,
      organiser: { select: { displayName: true, idVerifiedAt: true } },
      witnesses: {
        where: { status: 'accepted' },
        orderBy: { createdAt: 'asc' },
        // Names only. A phone number on a public page is a phone number
        // published to everybody the link reaches.
        select: { name: true },
      },
      needItems: {
        // Active only. A contributor's suggestion is not on the board until the
        // organiser has looked at it (M2-03).
        where: { status: 'active' },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          label: true,
          note: true,
          quantityRequired: true,
          quantityClaimed: true,
          unit: true,
        },
      },
    },
  })

  if (event === null) return null

  return {
    id: event.id,
    slug: event.slug,
    reference: { prefix: event.refPrefix, code: event.refCode },
    archetype: event.archetype,
    title: event.title,
    subtitle: event.subtitle,
    place: event.place,
    eventDate: event.eventDate,
    mode: event.mode,
    organiserName: event.organiser.displayName,
    organiserVerifiedAt: event.organiser.idVerifiedAt,
    witnesses: event.witnesses.map((witness) => witness.name),
    needs: event.needItems,
  }
}

export interface EventCard {
  id: string
  slug: string
  archetype: ArchetypeKey
  title: string
  subtitle: string | null
  place: string | null
  eventDate: Date | null
  organiserName: string | null
  /** Drives the badge on the card, and therefore its version hash (M2-07 §2). */
  organiserVerifiedAt: Date | null
}

/**
 * Just what the OG card draws (M2-07).
 *
 * A separate read from {@link publicEventBySlug} because that one pulls the
 * needs board with it, and the image route has no use for a list of tents. The
 * `published` filter is here for the same reason it is there: a draft's card
 * would be a preview of a page nobody can open.
 */
export async function eventCardBySlug(
  db: PrismaClient,
  slug: string,
): Promise<EventCard | null> {
  const event = await db.event.findFirst({
    where: { slug, status: 'published' },
    select: {
      id: true,
      slug: true,
      archetype: true,
      title: true,
      subtitle: true,
      place: true,
      eventDate: true,
      organiser: { select: { displayName: true, idVerifiedAt: true } },
    },
  })

  if (event === null) return null

  return {
    id: event.id,
    slug: event.slug,
    archetype: event.archetype,
    title: event.title,
    subtitle: event.subtitle,
    place: event.place,
    eventDate: event.eventDate,
    organiserName: event.organiser.displayName,
    organiserVerifiedAt: event.organiser.idVerifiedAt,
  }
}

export async function eventsForOrganiser(
  db: PrismaClient,
  organiserId: string,
): Promise<readonly { id: string; slug: string; title: string; isPublished: boolean }[]> {
  const events = await db.event.findMany({
    where: { organiserId },
    // The id makes the order total (M3-07b §3): `created_at` is milliseconds
    // and two rows created in one can come back either way round otherwise.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, slug: true, title: true, status: true },
  })

  return events.map((event) => ({
    id: event.id,
    slug: event.slug,
    title: event.title,
    isPublished: event.status === 'published',
  }))
}

export async function setOrganiserName(
  db: PrismaClient,
  organiserId: string,
  displayName: string,
): Promise<void> {
  await db.organiser.update({ where: { id: organiserId }, data: { displayName } })
}
