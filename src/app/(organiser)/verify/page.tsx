import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { verifyView } from '@/lib/identity'
import { currentSession } from '@/lib/session'

import { withFormErrors } from './form-errors'
import { safeReturnTo } from './return-to'
import { VerifyPanel } from './verify-panel'

import styles from './verify.module.css'

/**
 * The identity check, on its own route.
 *
 * It is organiser-level rather than event-level because verification is a
 * property of the **person**, not of an umcimbi: one check verifies every event
 * they set up and every collection they run. That matters most for a collection
 * organiser, who has no publication step at all — on collections verification
 * gates *sharing* (rule 13), and until this route existed she reached a refusal
 * with no way through it (M2-10 §10).
 *
 * Step five of the setup flow renders the same component inside its shell.
 */

export const metadata: Metadata = {
  title: 'Confirm it is you · Isipheko',
  robots: { index: false, follow: false },
}

export default async function VerifyRoute({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string
    id?: string
    blocked?: string
    name?: string
  }>
}) {
  const session = await currentSession()
  if (session === null) redirect('/sign-in')

  const { returnTo, id, blocked, name } = await searchParams
  const view = withFormErrors(await verifyView(session.organiserId), {
    id,
    blocked,
    name,
  })

  return (
    <main className={styles.page}>
      <VerifyPanel view={view} returnTo={safeReturnTo(returnTo)} />
    </main>
  )
}
