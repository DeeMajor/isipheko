import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { archetypeSetupCopy, setupCopy } from '@/copy/setup'
import { prisma } from '@/db/client'
import { ARCHETYPES, ARCHETYPE_KEYS, type ArchetypeKey } from '@/domain/archetype'
import { currentSession } from '@/lib/session'
import { Button, Field } from '@/ui/primitives'

import { createFromDetails } from '../actions'
import { SetupShell } from '../setup-shell'

import styles from '../setup.module.css'

/**
 * Step two: the name, the day, the place — and the organiser's own name, which
 * sign-in deliberately did not ask for (M1-06 §2).
 *
 * Submitting this is what creates the draft: `events.title` is NOT NULL, so
 * there was nothing to write before now. Everything after this step edits a row
 * that exists, which is what makes a flat battery survivable.
 *
 * There is no target field on this screen for any archetype. Targets are a
 * money decision that belongs with the page itself, and putting one here would
 * be the obvious place to accidentally offer it on a funeral.
 */

export const metadata: Metadata = {
  title: 'The details · Isipheko',
  robots: { index: false, follow: false },
}

export default async function DetailsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; error?: string }>
}) {
  const session = await currentSession()
  if (session === null) redirect('/sign-in')

  const { kind, error } = await searchParams
  if (!ARCHETYPE_KEYS.includes(kind as ArchetypeKey)) redirect('/create')

  const archetype = ARCHETYPES[kind as ArchetypeKey]
  const copy = archetypeSetupCopy[archetype.key]

  // Prefilled for a returning organiser (UX-15): her name is on record from
  // the last umcimbi, and asking her to retype it on every new one made the
  // field read as a question the product already knew the answer to. Still
  // editable — it is her name, and the edit screen corrects it too (UX-07).
  const organiserName =
    (
      await prisma.organiser.findUnique({
        where: { id: session.organiserId },
        select: { displayName: true },
      })
    )?.displayName ?? ''

  return (
    <SetupShell step="details" archetype={archetype} crumb={copy.zulu}>
      <h1 className={styles.title}>{copy.detailsTitle}</h1>
      <p className={styles.intro}>{setupCopy.details.intro}</p>

      <form action={createFromDetails} className={styles.form}>
        <input type="hidden" name="archetype" value={archetype.key} />

        <Field
          id="title"
          name="title"
          label={copy.nameLabel}
          help={copy.nameHelp}
          placeholder={copy.namePlaceholder}
          // Its own sentence, not the needs step's (UX-07): this used to
          // render "Add at least one thing to carry on" under the title field.
          error={error === 'no-title' ? setupCopy.details.noTitle : undefined}
          required
        />

        <Field
          id="subtitle"
          name="subtitle"
          label={`${copy.secondNameLabel} (${setupCopy.details.optional.toLowerCase()})`}
          placeholder={copy.secondNamePlaceholder}
        />

        <Field
          id="organiserName"
          name="organiserName"
          label={setupCopy.details.organiserNameLabel}
          help={setupCopy.details.organiserNameHelp}
          placeholder={setupCopy.details.organiserNamePlaceholder}
          defaultValue={organiserName}
          autoComplete="name"
          required
        />

        <Field
          id="eventDate"
          name="eventDate"
          type="date"
          label={setupCopy.details.dateLabel}
          help={copy.dateHelp}
          data-numeric=""
        />

        <Field
          id="place"
          name="place"
          label={setupCopy.details.placeLabel}
          help={setupCopy.details.placeHelp}
          placeholder={setupCopy.details.placePlaceholder}
        />

        <Button type="submit">{setupCopy.details.submit}</Button>
      </form>

      <p className={styles.foot}>{setupCopy.details.footNamed}</p>
    </SetupShell>
  )
}
