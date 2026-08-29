import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { authCopy } from '@/copy/auth'
import { prisma } from '@/db/client'
import { collectionsForOrganiser } from '@/db/repositories/collection'
import { eventsForOrganiser } from '@/db/repositories/event'
import { currentSession } from '@/lib/session'
import { Button, Card } from '@/ui/primitives'

import { signOut, signOutEverywhere } from '../../(auth)/sign-in/actions'

import styles from './page.module.css'

/**
 * Where signing in lands — and, since UX-04, the way back to everything.
 *
 * This was a stub with two sign-out buttons and one "set up your umcimbi"
 * action, which made every return visit a dead end: the confirmation queue on
 * `/manage/[id]`, a half-finished draft, and every collection were reachable
 * only from a bookmark. `eventsForOrganiser` existed in the repository and was
 * rendered nowhere — the M3-08 §8 shape, on the screen the whole organiser
 * side routes through.
 *
 * A draft resumes at its needs step, because the setup flow walks forward from
 * there; a published umcimbi opens on `/manage/[id]`, which is where the two
 * actions of her day live.
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

  const [events, collections] = await Promise.all([
    eventsForOrganiser(prisma, session.organiserId),
    collectionsForOrganiser(prisma, session.organiserId),
  ])

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Card title={authCopy.signedIn.title} titleAs="h1">
          <p className={styles.body}>{authCopy.signedIn.body}</p>

          <div className={styles.actions}>
            <form action="/create">
              <Button type="submit">{authCopy.signedIn.setUp}</Button>
            </form>

            <form action="/collections/new">
              <Button type="submit" variant="secondary">
                {authCopy.signedIn.startCollection}
              </Button>
            </form>
          </div>
        </Card>

        {events.length === 0 ? null : (
          <Card title={authCopy.signedIn.eventsTitle} titleAs="h2">
            <ul className={styles.list}>
              {events.map((event) => (
                <li key={event.id} className={styles.listRow}>
                  <span className={styles.listTitle}>{event.title}</span>
                  <span className={styles.listTag}>
                    {event.isPublished
                      ? authCopy.signedIn.publishedTag
                      : authCopy.signedIn.draftTag}
                  </span>
                  <Link
                    className={styles.listLink}
                    href={
                      event.isPublished
                        ? `/manage/${event.id}`
                        : `/create/${event.id}/needs`
                    }
                  >
                    {event.isPublished
                      ? authCopy.signedIn.open
                      : authCopy.signedIn.carryOn}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {collections.length === 0 ? null : (
          <Card title={authCopy.signedIn.collectionsTitle} titleAs="h2">
            <ul className={styles.list}>
              {collections.map((collection) => (
                <li key={collection.id} className={styles.listRow}>
                  <span className={styles.listTitle}>{collection.title}</span>
                  <span className={styles.listTag}>
                    {collection.isClosed
                      ? authCopy.signedIn.collectionClosedTag
                      : authCopy.signedIn.collectionOpenTag}
                  </span>
                  <Link
                    className={styles.listLink}
                    href={`/collections/${collection.id}`}
                  >
                    {authCopy.signedIn.open}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="">
          <div className={styles.actions}>
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
      </div>
    </main>
  )
}
