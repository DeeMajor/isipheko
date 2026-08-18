import { prisma } from '@/db/client'
import { normalisePhone } from '@/domain/auth'
import { env } from '@/lib/env'
import { currentSession } from '@/lib/session'

/**
 * Who may open the review queue.
 *
 * **An environment allowlist, checked against the session that already exists.**
 * There is no admin account, no admin password and no second sign-in: a
 * reviewer signs in with the same phone and the same one-time code as anybody
 * else, and this decides whether the screen answers.
 *
 * The reason it is not a column is the one that settles it: the application
 * role holds UPDATE on `organisers`, so an `is_admin` field would be a
 * privilege the application could grant itself, and a flag the app can set on
 * itself is not a privilege boundary. This variable is set by whoever deploys
 * and the running code can only read it.
 *
 * **This is a stopgap shape and should be read as one.** It has no roles, no
 * revocation short of a redeploy, no record of who granted what, and it does
 * not scale past a handful of people. A real admin model would have all four.
 * Nobody arriving later should take the allowlist for the intended design — see
 * docs/decisions.md M3-07 §2.
 *
 * Everything this gates is logged, including merely looking (M3-07 §3).
 */

/**
 * Parsed once at module load. Numbers are normalised on both sides so that
 * `0821234567` in a deployment variable and `+27821234567` in the database are
 * the same person — a mismatch here fails closed and silently, which is the
 * worst way for an allowlist to be wrong.
 */
const ALLOWED: ReadonlySet<string> = new Set(
  env.ADMIN_PHONE_NUMBERS.split(',').flatMap((entry) => {
    const parsed = normalisePhone(entry.trim())
    return parsed.ok ? [parsed.value] : []
  }),
)

export interface CurrentAdmin {
  readonly organiserId: string
  /** Nullable on the column, and nothing here depends on it being set. */
  readonly displayName: string | null
}

/**
 * The signed-in organiser, if they are on the list.
 *
 * Three outcomes, and the caller needs to tell them apart: `no-session` sends
 * somebody to sign in, `refused` is a signed-in person who is not a reviewer —
 * which is worth a log row, because it is either a bug or somebody trying the
 * door — and `ok` is a reviewer.
 */
export type AdminOutcome =
  | { readonly ok: true; readonly admin: CurrentAdmin }
  | { readonly ok: false; readonly reason: 'no-session' }
  /** The organiser id comes back so the refusal can be logged against a person. */
  | { readonly ok: false; readonly reason: 'refused'; readonly organiserId: string }

export async function currentAdmin(now: Date = new Date()): Promise<AdminOutcome> {
  const session = await currentSession(now)
  if (session === null) return { ok: false, reason: 'no-session' }

  const organiser = await prisma.organiser.findUnique({
    where: { id: session.organiserId },
    select: { phoneE164: true, displayName: true },
  })

  if (organiser === null || !ALLOWED.has(organiser.phoneE164)) {
    return { ok: false, reason: 'refused', organiserId: session.organiserId }
  }

  return {
    ok: true,
    admin: { organiserId: session.organiserId, displayName: organiser.displayName },
  }
}

/** Whether anybody at all can review. Used by the queue's own empty state. */
export function reviewersConfigured(): boolean {
  return ALLOWED.size > 0
}
