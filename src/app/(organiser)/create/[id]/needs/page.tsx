import type { Metadata } from 'next'

import { prisma } from '@/db/client'
import { needsForEvent } from '@/db/repositories/event'
import { archetypeSetupCopy, setupCopy } from '@/copy/setup'
import { Button, Field, Toast } from '@/ui/primitives'

import { saveNeeds } from '../../actions'
import { SetupShell } from '../../setup-shell'
import { loadDraft } from '../draft'

import styles from '../../setup.module.css'

/**
 * Step three: what is needed, pre-filled from the archetype's template.
 *
 * The list arrives already written because of the sentence on the screen: *"You
 * do not have to think of it all yourself."* A family arranging a funeral in
 * the same week as the death should not be handed an empty box.
 *
 * Adding and removing rows are **submit buttons**, not click handlers, so the
 * step works with no JavaScript at all. Each of them saves what is on screen
 * first, so removing the third row does not discard what was typed into the
 * fourth.
 */

export const metadata: Metadata = {
  title: "What's needed · Isipheko",
  robots: { index: false, follow: false },
}

export default async function NeedsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ add?: string; error?: string; held?: string }>
}) {
  const { id } = await params
  const { add, error, held } = await searchParams
  const { draft, archetype } = await loadDraft(id)

  const saved = await needsForEvent(prisma, draft.id)
  const rows =
    add === '1'
      ? [...saved, { id: 'new', label: '', note: '', fromTemplate: false }]
      : saved

  return (
    <SetupShell
      step="needs"
      archetype={archetype}
      crumb={archetypeSetupCopy[archetype.key].zulu}
    >
      <h1 className={styles.title}>{setupCopy.needs.title}</h1>
      <p className={styles.intro}>
        {archetype.amountsPublic
          ? setupCopy.needs.introPublic
          : setupCopy.needs.introHidden}
      </p>

      {error === 'empty' ? (
        <div className={styles.form}>
          <Toast tone="problem">{setupCopy.needs.empty}</Toast>
        </div>
      ) : null}

      {/* A note without a thing was refused, out loud (UX-08). */}
      {error === 'unlabelled' ? (
        <div className={styles.form}>
          <Toast tone="problem">{setupCopy.needs.unlabelled}</Toast>
        </div>
      ) : null}

      {/*
        A removed row with a live claim stayed (UX-03). Removing it would take
        somebody's promise off the record — the claim, its message and its
        photograph cascade with the row — so the row is kept and the screen
        says why rather than deleting it silently.
      */}
      {error === 'claimed' ? (
        <div className={styles.form}>
          <Toast tone="problem">{setupCopy.needs.claimed(held ?? '')}</Toast>
        </div>
      ) : null}

      <form action={saveNeeds} className={styles.form}>
        <input type="hidden" name="id" value={draft.id} />

        <div className={styles.stack}>
          {rows.map((row, index) => (
            <div key={row.id} className={styles.card}>
              {/* The row's identity, so saving reconciles rather than replaces
                  (UX-03): a row that keeps its id keeps its claims. The blank
                  added row has none and arrives as a new one. */}
              <input type="hidden" name="itemId" value={row.id === 'new' ? '' : row.id} />
              <div className={styles.row}>
                <div className={styles.rowMain}>
                  <Field
                    id={`label-${String(index)}`}
                    name="label"
                    label={setupCopy.needs.labelAria}
                    defaultValue={row.label}
                  />
                </div>
                <div className={styles.rowAction}>
                  <Button
                    type="submit"
                    name="remove"
                    value={String(index)}
                    variant="quiet"
                    inline
                    formNoValidate
                  >
                    {setupCopy.needs.remove}
                  </Button>
                </div>
              </div>

              <Field
                id={`note-${String(index)}`}
                name="note"
                label={setupCopy.needs.noteAria}
                placeholder={setupCopy.needs.notePlaceholder}
                defaultValue={row.note ?? ''}
              />

              {row.fromTemplate ? (
                <p className={styles.templateNote}>{setupCopy.needs.templateNote}</p>
              ) : null}
            </div>
          ))}
        </div>

        <Button type="submit" name="action" value="add" variant="quiet" formNoValidate>
          {setupCopy.needs.add}
        </Button>

        <Button type="submit" name="action" value="continue">
          {setupCopy.needs.submit}
        </Button>
      </form>

      <p className={styles.foot}>{setupCopy.needs.foot}</p>
      <p className={styles.foot}>{setupCopy.needs.footNote}</p>
    </SetupShell>
  )
}
