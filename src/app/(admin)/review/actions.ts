'use server'

import { redirect } from 'next/navigation'

import { prisma } from '@/db/client'
import { triageReport } from '@/db/repositories/report'
import { isReportStatus, type ReportStatus } from '@/domain/report'
import { recordAdminAction, requestFingerprint } from '@/lib/audit'

import { requireAdmin } from './guard'

/**
 * A person moving a report along — the only two writes this whole section makes.
 *
 * **Neither of them touches an event.** `triageReport` writes to `reports` and
 * nothing else, and there is no import of the event repository in this file,
 * deliberately. Closing a report records that somebody read it and decided; if
 * the decision is that an umcimbi should come down, that is a separate act on
 * the event, by a person, with its own audit row. See docs/decisions.md M3-06
 * §1 and M3-07 §4.
 *
 * Server actions, so both work with JavaScript disabled: the browser posts, the
 * action runs, and the redirect carries any refusal back as a code the page
 * turns into copy.
 *
 * **Only these two are exported.** Every export from a `'use server'` module is
 * a callable endpoint, so a helper taking an actor id as an argument would be a
 * way for anybody to write an audit row in somebody else's name. The
 * *"a reviewer opened this"* row is written by the detail page itself, where the
 * actor comes from the session rather than from a parameter.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

async function move(formData: FormData, to: ReportStatus): Promise<never> {
  const admin = await requireAdmin()
  const id = text(formData, 'id')
  const from = text(formData, 'from')

  if (!isReportStatus(from)) redirect('/review?problem=not-a-transition')

  const now = new Date()
  const outcome = await triageReport(prisma, { id, from, to, now })

  if (!outcome.ok) redirect(`/review?problem=${outcome.reason}`)

  await recordAdminAction({
    action: 'report.triaged',
    organiserId: admin.organiserId,
    target: { type: 'report', id },
    fingerprint: await requestFingerprint(),
    // The transition, not the report. What somebody alleged stays in `reports`
    // where two people can read it, rather than in a log that is exported,
    // shipped and kept far longer (rule 8).
    metadata: { from: outcome.from, to: outcome.to },
    now,
  })

  redirect(to === 'closed' ? '/review?done=1' : `/review/${id}`)
}

export async function startReading(formData: FormData): Promise<void> {
  await move(formData, 'reviewing')
}

export async function closeReport(formData: FormData): Promise<void> {
  await move(formData, 'closed')
}
