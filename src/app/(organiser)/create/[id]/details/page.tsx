import type { Metadata } from 'next'

import { prisma } from '@/db/client'
import { archetypeSetupCopy, setupCopy } from '@/copy/setup'
import { Button, Field, Toast } from '@/ui/primitives'

import { saveDetails } from '../../actions'
import { SetupShell } from '../../setup-shell'
import { loadDraft } from '../draft'

import styles from '../../setup.module.css'

/**
 * Editing the details of an umcimbi that already exists (UX-07).
 *
 * The setup flow promised this from the start — *"Three things, and you can
 * change any of them later"*, and on a funeral, *"put your best guess and
 * change it later"* about the day — **and there was no screen behind either
 * sentence**. `saveDetails` had no caller, and its own error redirect pointed
 * at this address while nothing answered it. The cost was not hypothetical: a
 * misspelled name of the deceased on a published funeral page was
 * uncorrectable through the product, which is the exact scenario M2-07 §2's
 * card versioning was built to survive ("before the family fixed the spelling
 * of their mother's name") — the versioning worked and the fix it waited for
 * could never be made.
 *
 * Editing the title mints a new OG card URL by itself (the version is a hash
 * of what the card draws), so the next person to receive the link sees the
 * corrected name. That machinery has been waiting for this screen since M2-07.
 *
 * The kind is deliberately not editable here — or anywhere. Changing the
 * archetype of a live event re-keys its copy, its accent, its visibility
 * default and its bereavement guards; the kind step now says plainly that it
 * is the one choice that cannot be changed, instead of promising a change
 * nothing offered.
 */

export const metadata: Metadata = {
  title: 'The details · Isipheko',
  robots: { index: false, follow: false },
}

export default async function EditDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const { draft, archetype, organiserId } = await loadDraft(id)

  const copy = archetypeSetupCopy[archetype.key]
  const organiserName =
    (
      await prisma.organiser.findUnique({
        where: { id: organiserId },
        select: { displayName: true },
      })
    )?.displayName ?? ''

  // As the <input type="date"> wants it. UTC, like the write side (dateOrNull
  // parses into a UTC midnight), so the day round-trips unchanged.
  const day = draft.eventDate?.toISOString().slice(0, 10) ?? ''

  return (
    <SetupShell step="details" archetype={archetype} crumb={copy.zulu}>
      <h1 className={styles.title}>{copy.detailsTitle}</h1>
      <p className={styles.intro}>{setupCopy.details.intro}</p>

      {error === 'no-title' ? (
        <div className={styles.form}>
          <Toast tone="problem">{setupCopy.details.noTitle}</Toast>
        </div>
      ) : null}

      <form action={saveDetails} className={styles.form}>
        <input type="hidden" name="id" value={draft.id} />

        <Field
          id="title"
          name="title"
          label={copy.nameLabel}
          help={copy.nameHelp}
          placeholder={copy.namePlaceholder}
          defaultValue={draft.title}
          required
        />

        <Field
          id="subtitle"
          name="subtitle"
          label={`${copy.secondNameLabel} (${setupCopy.details.optional.toLowerCase()})`}
          placeholder={copy.secondNamePlaceholder}
          defaultValue={draft.subtitle ?? ''}
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
          defaultValue={day}
          data-numeric=""
        />

        <Field
          id="place"
          name="place"
          label={setupCopy.details.placeLabel}
          help={setupCopy.details.placeHelp}
          placeholder={setupCopy.details.placePlaceholder}
          defaultValue={draft.place ?? ''}
        />

        <Button type="submit">{setupCopy.details.saveChanges}</Button>
      </form>

      <p className={styles.foot}>
        {draft.isPublished
          ? setupCopy.details.footPublished
          : setupCopy.details.footNamed}
      </p>
    </SetupShell>
  )
}
