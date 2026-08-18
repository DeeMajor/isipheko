import type { PrismaClient } from '@/db/generated/client'
import { memberAmount, visibleMembers, type MemberState } from '@/domain/collection'
import { fromCents, type Money } from '@/domain/money'
import type { BeadForm } from '@/domain/strand'

/**
 * What the Ledger Strand is drawn from.
 *
 * **The ledger, not `contributions`.** The chain is the record (rule 3), and a
 * strand read from the contributions table would be a second opinion about what
 * happened — one that could disagree with the incwadi while both looked
 * correct. Reading the entries means the picture and the record are the same
 * thing rendered twice.
 *
 * A reversed entry drops off. The reversal is itself a row and the chain still
 * holds it, which is the point of an append-only record; what it must not do is
 * leave a bead on the page for money the organiser has since said never
 * arrived.
 *
 * Nothing here returns a total or a count. The caller receives a list.
 */

export interface StrandBead {
  /** The ledger entry's id — the strand is the chain, so this is its identity. */
  readonly id: string
  readonly form: BeadForm
  /** Null when the contributor asked to give quietly. */
  readonly name: string | null
  /** Drives the diameter only. It is never rendered, at any archetype. */
  readonly amount: Money | null
  /** "Chairs × 100" — what was brought, as the chain records it. */
  readonly description: string | null
  readonly message: string | null
  readonly at: Date
  /**
   * Collections (M2-09). A group bead is one act by many people — one bead,
   * never one per member (rule 14).
   *
   * The names of members who chose to be named. Somebody who gave quietly is
   * inside the bead and not in this list, which is why {@link memberCount} is
   * separate: the bead says how many people are in it without naming them.
   *
   * **No amounts.** The bead opens to names, not to a breakdown — the host
   * learns that the cousins stood with them, not who among the cousins gave
   * least.
   */
  readonly members?: readonly string[]
  readonly memberCount?: number
}

function formFor(type: string | undefined, description: string | null): BeadForm {
  if (type === 'in_kind') return 'in_kind'
  if (type === undefined && description !== null) return 'in_kind'

  return 'cash'
}

export async function strandForEvent(
  db: PrismaClient,
  eventId: string,
): Promise<readonly StrandBead[]> {
  const [entries, reversals] = await Promise.all([
    db.ledgerEntry.findMany({
      // Contributions **and collections**: an attached collection's entry lives
      // on this chain, which is what makes it render here as a single bead
      // rather than as one bead per cousin (rule 14, Part D2.3).
      where: { eventId, entryType: { in: ['contribution', 'collection'] } },
      // Sequence, not `created_at`: the order the chain was written in is the
      // order people came, and it is the only order that cannot be ambiguous.
      orderBy: { sequenceNo: 'asc' },
      select: {
        id: true,
        amountCents: true,
        inKindDescription: true,
        createdAt: true,
        entryType: true,
        referenceId: true,
        contribution: {
          select: { contributorName: true, visibility: true, type: true, message: true },
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
   * entry's `collection_id`.
   *
   * That column names the **chain** an entry belongs to, and a CHECK allows
   * exactly one — so an attached collection's entry carries the host event's
   * id there and nothing else. Which collection it is about is what
   * `reference_id` says. Reading the wrong one renders the cousins as a cash
   * bead, which is how this was found.
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

  return entries
    .filter((entry) => !reversed.has(entry.id))
    .map((entry) => {
      const contribution = entry.contribution
      const anonymous = contribution?.visibility === 'anonymous'

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

        return {
          id: entry.id,
          form: 'group' as const,
          // The group's own name — "The Ngcobo cousins" — not a member's.
          name: group.title,
          amount: entry.amountCents === null ? null : fromCents(entry.amountCents),
          description: entry.inKindDescription,
          message: null,
          at: entry.createdAt,
          members: visible.names,
          memberCount: visible.count,
        }
      }

      return {
        id: entry.id,
        form: formFor(contribution?.type, entry.inKindDescription),
        // `name_only` still shows the name — it hides the amount, and the
        // strand never shows an amount for anybody.
        name: contribution === null || anonymous ? null : contribution.contributorName,
        amount: entry.amountCents === null ? null : fromCents(entry.amountCents),
        description: entry.inKindDescription,
        // Somebody giving quietly still gets their words on the record if they
        // left any. What they withheld is their name.
        message: contribution?.message ?? null,
        at: entry.createdAt,
      }
    })
}
