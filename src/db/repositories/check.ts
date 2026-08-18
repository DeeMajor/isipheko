import type { PrismaClient } from '../generated/client.ts'
import { isValidSlug } from '../../domain/event/index.ts'
import { parseReference } from '../../domain/reference/index.ts'

/**
 * `/check` — the independent answer to *"is this real?"*.
 *
 * **It exposes nothing the public event page does not already show**: the
 * title, the organiser's name, and whether their identity was checked and
 * when. Never a phone number, never an amount, never a contributor, never the
 * needs list. Somebody who can reach this page could have reached the event
 * page, so it must not be a way to learn more by asking sideways.
 *
 * **A draft answers exactly like a code nobody was issued.** M1-07 §7 made
 * drafts unreachable and this must not become the exception that finds them —
 * a lookup that distinguished "not published yet" from "not one of ours" would
 * confirm the existence of a page the family has not shared.
 *
 * Relative imports with extensions, like the other repositories (M2-01 §8).
 */

export interface CheckResult {
  readonly title: string
  readonly organiserName: string | null
  readonly verifiedAt: Date | null
  /** What they typed, normalised — echoed back so the answer names its question. */
  readonly reference: string
}

/**
 * What somebody can type in.
 *
 * A reference code is what the page tells them to use. A slug or a whole link
 * is what they have if they were sent one and want to check it without opening
 * it — which is the more careful thing to do, and refusing it would punish the
 * more careful person.
 */
export type Lookup =
  | { readonly kind: 'reference'; readonly prefix: string; readonly code: string }
  | { readonly kind: 'slug'; readonly slug: string }

/**
 * Reads a code, a slug, or a link with either in it.
 *
 * Deliberately generous about the wrapper — `isipheko.co.za/e/<slug>`, a bare
 * slug, `MTH-4K7B2X`, `mth 4k7b2x` — because somebody pasting a link they were
 * sent is doing the right thing and should not have to tidy it first.
 */
export function parseLookup(input: string): Lookup | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  const reference = parseReference(trimmed)
  if (reference !== null) return { kind: 'reference', ...reference }

  // A link, or the tail of one. Every segment is considered rather than only
  // the last: `/e/<slug>/contribute` ends in a word, and somebody pasting the
  // page they were part-way through is doing exactly what this is for.
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? ''
  const segments = withoutQuery.split('/').filter((part) => part !== '')
  const slug = segments.find((part) => isValidSlug(part))

  return slug === undefined ? null : { kind: 'slug', slug }
}

/**
 * The answer, or nothing.
 *
 * A contribution's reference resolves to **its event**. Somebody holding the
 * code off their own payment is the person most likely to be checking, and the
 * event is the thing they are asking about — their contribution's own details
 * are not returned, because this endpoint takes no session and could not know
 * it was them.
 */
export async function check(
  db: PrismaClient,
  lookup: Lookup,
): Promise<CheckResult | null> {
  const published = { status: 'published' as const }

  const select = {
    title: true,
    refPrefix: true,
    refCode: true,
    organiser: { select: { displayName: true, idVerifiedAt: true } },
  }

  if (lookup.kind === 'slug') {
    const event = await db.event.findFirst({
      where: { slug: lookup.slug, ...published },
      select,
    })

    return event === null ? null : toResult(event)
  }

  const where = { refPrefix: lookup.prefix, refCode: lookup.code }

  const event = await db.event.findFirst({ where: { ...where, ...published }, select })
  if (event !== null) return toResult(event)

  const contribution = await db.contribution.findFirst({
    where,
    select: { event: { select: { ...select, status: true } } },
  })

  const behind = contribution?.event ?? null
  if (behind === null || behind.status !== 'published') return null

  return toResult(behind)
}

function toResult(event: {
  title: string
  refPrefix: string
  refCode: string
  organiser: { displayName: string | null; idVerifiedAt: Date | null }
}): CheckResult {
  return {
    title: event.title,
    organiserName: event.organiser.displayName,
    verifiedAt: event.organiser.idVerifiedAt,
    reference: `${event.refPrefix}-${event.refCode}`,
  }
}
