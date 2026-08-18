import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { authCopy } from '@/copy/auth'
import { currentSession } from '@/lib/session'
import { Button, Card } from '@/ui/primitives'

import { signOut, signOutEverywhere } from '../../(auth)/sign-in/actions'

import styles from './page.module.css'

/**
 * Where signing in lands, and the placeholder the organiser dashboard replaces
 * in M1-07.
 *
 * It exists at M1-06 for one reason: a login flow with nowhere to arrive cannot
 * be tested end to end, and "the session works" has to mean something a person
 * can see.
 *
 * Both sign-out actions are here because both are part of what a session is.
 * "Sign out on every device" is the answer to a lost phone, and it is only
 * possible because sessions are rows — see docs/decisions.md M1-06.
 */

export const metadata: Metadata = {
  title: 'Your account · Isipheko',
  robots: { index: false, follow: false },
}

export default async function AccountPage() {
  const session = await currentSession()

  // Absent, expired, revoked and unknown all land here. The page cannot tell
  // them apart and has no reason to.
  if (session === null) redirect('/sign-in')

  return (
    <main className={styles.page}>
      <Card title="You are signed in" titleAs="h1" className={styles.card}>
        <p className={styles.body}>Set up an umcimbi and share it when you are ready.</p>

        <div className={styles.actions}>
          <form action="/create">
            <Button type="submit">Set up your umcimbi</Button>
          </form>

          <form action={signOut}>
            <Button type="submit" variant="secondary">
              {authCopy.signedIn.signOut}
            </Button>
          </form>

          <form action={signOutEverywhere}>
            <Button type="submit" variant="quiet">
              {authCopy.signedIn.signOutEverywhere}
            </Button>
          </form>
        </div>
      </Card>
    </main>
  )
}
