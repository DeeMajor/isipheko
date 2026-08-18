import type { PrismaClient } from '../generated/client.ts'
import { memberAmount, visibleMembers, type MemberState } from '../../domain/collection/index.ts'
import { fromCents } from '../../domain/money/index.ts'
import type { BeadForm } from '../../domain/strand/index.ts'
import type { StrandBead } from './strand.ts'

/**
 * The album: every message, every photo and every contribution on one page.
 *
 * **Read from the ledger, exactly like the strand.** An album built from
 * `contributions` would be a second opinion about what happened — one that
 * could disagree with the strand above it while both looked correct. The chain
 * is the record (rule 3), so the cover and the entries are the same thing
 * rendered twice.
 *
 * Two consequences, both intended:
 *
 *   - **A reversed entry is not in the album.** The reversal is itself a row
 *     and the chain still holds it; what must not happen is a family's album
 *     carrying a page for money the organiser has since said never arrived.
 *   - **An unconfirmed contribution is not in the album.** A ledger entry
 *     exists only once the organiser has confirmed the payment against her own
 *     bank notification, so somebody's message and photo appear when the family
 *     confirms — not when they are typed. The album is the record, not the
 *     inbox, and the contribute flow's done screen says so.
 *
 * **No total, no count, no amount.** Not returned, not computed, not available
 * to the caller. The strand's size bands are unlabelled so amounts cannot be
 * reverse-engineered (Part C.4), and an album that undid that in prose would be
 * worse than one that never had the discipline — it is the artefact that gets
 * printed and passed around.
 *
 * Relative imports, like the other repositories a script has to load — see
 * docs/decisions.md M2-01 §8.
 */

export interface AlbumPhoto {
  /** The 32 hex characters the derivatives are served under. */
  readonly digest: string
  /**
   * The full derivative's dimensions.
   *
   * Present so the markup can reserve the space before a lazy image lands. Null
   * for a photo stored before M4-02 added the columns; the renderer falls back
   * rather than guessing, because a guessed ratio is a crop.
   */
  readonly width: number | null
  readonly height: number | null
}

export interface AlbumEntry {
  /** The ledger entry's id — the album is the chain, so this is its identity. */
  readonly id: string
  readonly form: BeadForm
  /** Null when the contributor asked to give quietly. */
  readonly name: string | null
  /** "Chairs × 100" — what was brought, as the chain records it. */
  readonly description: string | null
  readonly message: string | null
  readonly photo: AlbumPhoto | null
  readonly at: Date
  /** Group entries only (rule 14): the members who chose to be named. */
  readonly members?: readonly string[]
  readonly memberCount?: number
}

function formFor(type: string | undefined, description: string | null): BeadForm {
  if (type === 'in_kind') return 'in_kind'
  if (type === undefined && description !== null) return 'in_kind'

  return 'cash'
}

/**
 * The digest back out of a stored key.
 *
 * The column holds a key because a key is what an object store is asked for.
 * The URL wants the digest, and the two are one regex apart — kept here rather
 * than imported from `src/lib/`, because a repository that reaches into the
 * app's helpers is a repository a script cannot load.
 */
function digestOf(key: string | null): string | null {
  return /\/([0-9a-f]{32})-full\.avif$/.exec(key ?? '')?.[1] ?? null
}

/**
 * The cover and the entries, from one read of the chain.
 *
 * The strand is the album's cover, so the two must be the same list — a cover
 * drawn from one query and entries from another could disagree by a row written
 * between them, and the disagreement would be invisible. `strandForEvent` is
 * left alone: it serves the public event page, which is the gated one, and this
 * is not the task to touch it in.
 *
 * The bead's `amount` rides along because a bead's **diameter** is banded by it
 * (Part C.4). It is never rendered, here or anywhere — `AlbumEntry` has no
 * amount field at all, so the entries below the cover cannot show one even by
 * accident.
 */
export interface Album {
  readonly beads: readonly StrandBead[]
  readonly entries: readonly AlbumEntry[]
}

export async function albumForEvent(
  db: PrismaClient,
  eventId: string,
): Promise<Album> {
  const [entries, reversals] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { eventId, entryType: { in: ['contribution', 'collection'] } },
      // Sequence, not `created_at`: the order the chain was written in is the
      // order people came, and a record reads in the order it happened.
      orderBy: { sequenceNo: 'asc' },
      select: {
        id: true,
        amountCents: true,
        inKindDescription: true,
        createdAt: true,
        entryType: true,
        referenceId: true,
        contribution: {
          select: {
            contributorName: true,
            visibility: true,
            type: true,
            message: true,
            photoKey: true,
            photoWidth: true,
            photoHeight: true,
          },
        },
      },
    }),
    db.ledgerEntry.findMany({
      where: { eventId, entryType: 'reversal' },
      select: { referenceId: true },
    }),
  ])

  // A reversal points at the ledger entry it corrects (M2-01 §6), not at the
  // contribution behind it, so this is a straight lookup.
  const reversed = new Set(
    reversals.flatMap((row) => (row.referenceId === null ? [] : [row.referenceId])),
  )

  /*
   * An attached collection is reached through `reference_id`, not through the
   * entry's `collection_id` — that column names the chain an entry belongs to,
   * and an attached collection's entry carries the host event's id there. The
   * strand repository learned this the hard way (M2-09).
   */
  const collectionIds = entries.flatMap((entry) =>
    entry.entryType === 'collection' && entry.referenceId !== null
      ? [entry.referenceId]
      : [],
  )

  const collections =
    collectionIds.length === 0
      ? []
      : await db.collection.findMany({
          where: { id: { in: collectionIds } },
          select: {
            id: true,
            title: true,
            members: {
              select: { name: true, amountCents: true, visibility: true, status: true },
            },
          },
        })

  const groups = new Map(collections.map((collection) => [collection.id, collection]))

  const rows = entries.filter((entry) => !reversed.has(entry.id))

  const beads: StrandBead[] = []
  const album: AlbumEntry[] = []

  for (const entry of rows) {
    const contribution = entry.contribution
    const anonymous = contribution?.visibility === 'anonymous'
    const amount = entry.amountCents === null ? null : fromCents(entry.amountCents)

    const group =
      entry.entryType === 'collection' && entry.referenceId !== null
        ? groups.get(entry.referenceId)
        : undefined

    if (group !== undefined) {
      const members: MemberState[] = group.members.map((member) => ({
        name: member.name,
        amount: memberAmount(member.amountCents),
        visibility: member.visibility,
        status: member.status,
      }))

      const visible = visibleMembers(members)

      const shared = {
        id: entry.id,
        form: 'group' as const,
        // The group's own name — "The Ngcobo cousins" — not a member's.
        name: group.title,
        description: entry.inKindDescription,
        at: entry.createdAt,
        members: visible.names,
        memberCount: visible.count,
      }

      beads.push({ ...shared, amount, message: null })
      album.push({ ...shared, message: null, photo: null })
      continue
    }

    const digest = digestOf(contribution?.photoKey ?? null)

    const shared = {
      id: entry.id,
      form: formFor(contribution?.type, entry.inKindDescription),
      // `name_only` still shows the name — it withholds the amount, and neither
      // the strand nor the album shows an amount for anybody.
      name: contribution === null || anonymous ? null : contribution.contributorName,
      description: entry.inKindDescription,
      // Somebody giving quietly still gets their words and their picture on the
      // record if they left any. What they withheld is their name.
      message: contribution?.message ?? null,
      at: entry.createdAt,
    }

    beads.push({ ...shared, amount })
    album.push({
      ...shared,
      photo:
        digest === null
          ? null
          : {
              digest,
              width: contribution?.photoWidth ?? null,
              height: contribution?.photoHeight ?? null,
            },
    })
  }

  return { beads, entries: album }
}
