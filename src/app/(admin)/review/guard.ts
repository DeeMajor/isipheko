import { redirect } from 'next/navigation'

import { currentAdmin, type CurrentAdmin } from '@/lib/admin'
import { recordAdminAction, requestFingerprint } from '@/lib/audit'

/**
 * The one door onto the review queue.
 *
 * Every entry point calls this — the list, the detail screen and both triage
 * actions — so there is a single place the allowlist is consulted and a single
 * place a refusal is recorded. A guard duplicated per route is a guard that is
 * eventually forgotten on one of them.
 *
 * **A refusal is logged.** A signed-in organiser asking for this screen is
 * either a bug or somebody trying the door, and it is the row worth alerting on
 * (`admin.access.refused`). Somebody with no session at all is not logged: that
 * is an expired cookie far more often than it is anything else, and recording
 * every one would bury the rows that mean something.
 *
 * A refusal redirects to `/account` rather than rendering an explanation. The
 * screen does not confirm to somebody who may not know it exists that it does.
 */
export async function requireAdmin(): Promise<CurrentAdmin> {
  const outcome = await currentAdmin()

  if (outcome.ok) return outcome.admin

  if (outcome.reason === 'no-session') redirect('/sign-in')

  await recordAdminAction({
    action: 'admin.access.refused',
    organiserId: outcome.organiserId,
    fingerprint: await requestFingerprint(),
  })

  redirect('/account')
}
