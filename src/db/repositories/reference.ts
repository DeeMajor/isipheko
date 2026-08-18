import type { PrismaClient } from '@/db/generated/client'
import {
  derivePrefix,
  formatReference,
  generateCode,
  parseReference,
} from '@/domain/reference'

/**
 * Allocating and resolving reference codes.
 *
 * **Uniqueness is enforced, not assumed.** Six Crockford characters is 32^6 ≈
 * 1.07 × 10^9, and the birthday bound over 100 000 codes gives about 4.7
 * expected collisions — so a generator that trusted randomness would produce
 * duplicates occasionally, and a test asserting otherwise would be flaky rather
 * than passing. The unique index on `(ref_prefix, ref_code)` refuses the
 * duplicate and this retries. At a load factor of 10^-4 that fires roughly five
 * times in a hundred thousand.
 */

/** Enough that exhausting them means something is wrong, not unlucky. */
const MAX_ATTEMPTS = 8

/** Prisma's code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002'

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  )
}

export interface AllocatedReference {
  readonly prefix: string
  readonly code: string
  /** `MTH-4K7B2X` — what goes in the banking app's reference field. */
  readonly formatted: string
}

/**
 * `generate` is injectable so the retry can be tested.
 *
 * A real collision has probability around 10^-9 per draw, so a test that waited
 * for one would never see it — and untested retry logic in the path that
 * guarantees uniqueness is exactly where a silent bug lives. Production always
 * passes the real generator.
 */
async function allocate(
  title: string,
  write: (prefix: string, code: string) => Promise<void>,
  generate: () => string = generateCode,
): Promise<AllocatedReference> {
  const prefix = derivePrefix(title)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = generate()

    try {
      await write(prefix, code)
      return { prefix, code, formatted: formatReference({ prefix, code }) }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Taken. Draw another.
    }
  }

  throw new Error(
    `Could not allocate a reference code after ${String(MAX_ATTEMPTS)} attempts. ` +
      'At this alphabet size that is not bad luck — check whether codes are being ' +
      'generated from a fixed seed.',
  )
}

export async function allocateEventReference(
  db: PrismaClient,
  {
    eventId,
    title,
    generate,
  }: { eventId: string; title: string; generate?: () => string },
): Promise<AllocatedReference> {
  return allocate(
    title,
    async (refPrefix, refCode) => {
      await db.event.update({ where: { id: eventId }, data: { refPrefix, refCode } })
    },
    generate,
  )
}

export async function allocateContributionReference(
  db: PrismaClient,
  {
    contributionId,
    title,
    generate,
  }: { contributionId: string; title: string; generate?: () => string },
): Promise<AllocatedReference> {
  return allocate(
    title,
    async (refPrefix, refCode) => {
      await db.contribution.update({
        where: { id: contributionId },
        data: { refPrefix, refCode },
      })
    },
    generate,
  )
}

export type ResolvedReference =
  | { readonly kind: 'event'; readonly id: string; readonly slug: string }
  | { readonly kind: 'contribution'; readonly id: string }

/**
 * What somebody typed, resolved to the one thing it can mean.
 *
 * Returns null for anything malformed rather than searching for a near match.
 * A reference that resolved approximately would credit a contribution to the
 * wrong family, and there is no way to notice that from either side.
 */
export async function resolveReference(
  db: PrismaClient,
  input: string,
): Promise<ResolvedReference | null> {
  const reference = parseReference(input)
  if (reference === null) return null

  const where = { refPrefix: reference.prefix, refCode: reference.code }

  const event = await db.event.findFirst({ where, select: { id: true, slug: true } })
  if (event !== null) return { kind: 'event', id: event.id, slug: event.slug }

  const contribution = await db.contribution.findFirst({ where, select: { id: true } })
  if (contribution !== null) return { kind: 'contribution', id: contribution.id }

  return null
}
