import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { archetypeCollectionCopy, collectionCopy } from '@/copy/collection'
import { archetypeSetupCopy } from '@/copy/setup'
import { ARCHETYPES, ARCHETYPE_KEYS, type ArchetypeKey } from '@/domain/archetype'
import { currentSession } from '@/lib/session'
import { Button, Card, Field, Select, Toast } from '@/ui/primitives'

import { startCollection } from '../actions'

import styles from '../collections.module.css'

/**
 * Starting a collection. Four questions, and no money anywhere in them.
 *
 * **Deliberately plain, like `/manage/[id]`.** The organiser side of
 * collections is not the product's front door — Part D2.7 is explicit that
 * collections are how people arrive and the ceremony is why they stay — so this
 * is the smallest screen that lets somebody rally a group honestly.
 *
 * The bank hint is free text and says so: *"Nomsa's Capitec, ending 4471"*. It
 * is never an account we hold, verify or pay into, and the moment it became one
 * rule 12 would be gone along with the regulatory position that rests on it.
 */

export const metadata: Metadata = {
  title: 'Start a collection · Isipheko',
  robots: { index: false, follow: false },
}

export default async function NewCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; kind?: string }>
}) {
  if ((await currentSession()) === null) redirect('/sign-in')

  const { error, kind } = await searchParams
  const chosen: ArchetypeKey =
    kind !== undefined && ARCHETYPE_KEYS.includes(kind as ArchetypeKey)
      ? (kind as ArchetypeKey)
      : 'umngcwabo'

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Start a collection</h1>
      <p className={styles.body}>
        For when a group of you want to give together and hand over one thing.
      </p>

      {error === undefined ? null : (
        <Toast tone="problem">It needs a name and an occasion before it can start.</Toast>
      )}

      <Card title="What you are putting together" titleAs="h2" className={styles.card}>
        <form action={startCollection} className={styles.form}>
          <Select
            id="archetype"
            name="archetype"
            label="The occasion"
            help="A collection always names one — it drives the words and the tone."
            defaultValue={chosen}
            options={ARCHETYPE_KEYS.map((key) => ({
              value: key,
              label: `${archetypeSetupCopy[key].title} · ${ARCHETYPES[key].kicker}`,
            }))}
          />

          <Field
            id="title"
            name="title"
            label="What the group is called"
            help="e.g. The Ngcobo cousins, or the office collection."
            required
          />

          <Field
            id="purpose"
            name="purpose"
            label="Who it is for"
            help={archetypeCollectionCopy[chosen].purposeLead}
          />

          <Field
            id="bankHint"
            name="bankHint"
            label="Where people should send it"
            help="In your words — e.g. “Nomsa's Capitec, ending 4471”. Isipheko never holds this money, so this is only so the group knows where to pay you."
          />

          <Button type="submit">Start it</Button>
        </form>

        <p className={styles.body}>{collectionCopy.holdsTheMoneyShort('You')}</p>
      </Card>
    </main>
  )
}
