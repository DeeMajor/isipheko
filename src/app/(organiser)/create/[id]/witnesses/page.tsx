import type { Metadata } from 'next'

import { prisma } from '@/db/client'
import { witnessesForEvent } from '@/db/repositories/event'
import { archetypeSetupCopy, setupCopy } from '@/copy/setup'
import { MAX_WITNESSES } from '@/domain/event'
import { Button, Field, Toast } from '@/ui/primitives'

import { witnessSummaryForEvent } from '@/db/repositories/witness'
import { env } from '@/lib/env'

import { askWitness, saveWitnesses } from '../../actions'
import { SetupShell } from '../../setup-shell'
import { loadDraft } from '../draft'

import styles from '../../setup.module.css'

/**
 * Step four: abakhaphi.
 *
 * They are **stored and not contacted**. No SMS provider is configured
 * (docs/decisions.md M1-06 §6), so the "what they will be asked" panel is
 * written in the future tense and stays true — no copy on this page claims a
 * message went out.
 */

export const metadata: Metadata = {
  title: 'Who stands with you · Isipheko',
  robots: { index: false, follow: false },
}

export default async function WitnessesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    add?: string
    error?: string
    who?: string
    invited?: string
    witness?: string
  }>
}) {
  const { id } = await params
  const { add, error, who, invited, witness: witnessId } = await searchParams
  const { draft, archetype, organiserId } = await loadDraft(id)

  const saved = await witnessesForEvent(prisma, draft.id)
  const summary = await witnessSummaryForEvent(prisma, { eventId: draft.id, organiserId })
  const organiserName = (
    await prisma.organiser.findUnique({
      where: { id: organiserId },
      select: { displayName: true },
    })
  )?.displayName
  const blank = { id: 'new', name: '', phoneE164: '' }
  const rows =
    saved.length === 0
      ? [blank]
      : add === '1' && saved.length < MAX_WITNESSES
        ? [...saved, blank]
        : saved

  return (
    <SetupShell
      step="witnesses"
      archetype={archetype}
      crumb={archetypeSetupCopy[archetype.key].zulu}
    >
      <h1 className={styles.title}>{setupCopy.witnesses.title}</h1>
      <p className={styles.lead}>{setupCopy.witnesses.lead}</p>
      <p className={styles.intro}>{setupCopy.witnesses.body}</p>

      {error === 'empty' ? (
        <div className={styles.form}>
          <Toast tone="problem">{setupCopy.witnesses.empty}</Toast>
        </div>
      ) : null}

      {/* A row with a name and an unusable number was refused, out loud, and
          by name (UX-08) — it used to vanish silently on save. */}
      {error === 'phone' ? (
        <div className={styles.form}>
          <Toast tone="problem">
            {setupCopy.witnesses.badPhone(who ?? 'That person')}
          </Toast>
        </div>
      ) : null}

      <form action={saveWitnesses} className={styles.form}>
        <input type="hidden" name="id" value={draft.id} />

        <div className={styles.stack}>
          {rows.map((row, index) => (
            <div key={row.id} className={styles.card}>
              <div className={styles.cardHead}>
                <p className={styles.ordinal}>
                  {setupCopy.witnesses.ordinals[index] ?? setupCopy.witnesses.ordinals[2]}
                </p>
                {rows.length > 1 ? (
                  <Button
                    type="submit"
                    name="remove"
                    value={String(index)}
                    variant="quiet"
                    inline
                    formNoValidate
                  >
                    {setupCopy.witnesses.remove}
                  </Button>
                ) : null}
              </div>

              <Field
                id={`name-${String(index)}`}
                name="name"
                label={setupCopy.witnesses.nameLabel}
                defaultValue={row.name}
              />

              <Field
                id={`phone-${String(index)}`}
                name="phone"
                type="tel"
                inputMode="tel"
                label={setupCopy.witnesses.phoneLabel}
                defaultValue={row.phoneE164}
                data-numeric=""
              />

              <p className={styles.hint}>
                {index === 0
                  ? setupCopy.witnesses.firstHint
                  : setupCopy.witnesses.laterHint}
              </p>
            </div>
          ))}
        </div>

        {rows.length < MAX_WITNESSES ? (
          <Button type="submit" name="action" value="add" variant="quiet" formNoValidate>
            {rows.length === 1 ? setupCopy.witnesses.add : setupCopy.witnesses.addThird}
          </Button>
        ) : null}

        <Button type="submit" name="action" value="continue">
          {setupCopy.witnesses.submit}
        </Button>
      </form>

      <section className={styles.panel} aria-labelledby="ask-heading">
        <h2 className={styles.panelTitle} id="ask-heading">
          {setupCopy.witnesses.askTitle}
        </h2>
        {/*
          **We send nothing.** This panel used to open "We send them one
          message", which was future tense while nothing could be sent and
          became false the moment M3-03 gave her a link. The quoted question is
          the design's, verbatim, and is the invite page's own words — a unit
          test asserts the two agree so the promise and the delivery cannot
          drift.
        */}
        <p className={styles.panelBody}>{setupCopy.witnesses.askBody}</p>
        <p className={styles.panelBody}>
          <em>
            {setupCopy.witnesses.askQuote(
              organiserName ?? 'The organiser',
              archetype.kicker,
              draft.title,
            )}
          </em>
        </p>
        <p className={styles.panelBody}>{setupCopy.witnesses.askAfter}</p>
      </section>

      {saved.length === 0 ? null : (
        <section className={styles.panel} aria-labelledby="asked-heading">
          <h2 className={styles.panelTitle} id="asked-heading">
            Who you have asked
          </h2>

          <div className={styles.stack}>
            {summary.map((person) => (
              <div key={person.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <p className={styles.ordinal}>{person.name}</p>
                  <p className={styles.hint}>
                    {person.status === 'accepted'
                      ? setupCopy.witnesses.statusAccepted
                      : person.status === 'declined'
                        ? setupCopy.witnesses.statusDeclined
                        : setupCopy.witnesses.statusInvited}
                  </p>
                </div>

                {/* Shown, never sent: no SMS provider and no BSP exist (M1-06
                    §6, M2-08 §12), so she passes it on the way she already
                    talks to these people — the same posture as the handover
                    link (M2-11 §7). */}
                {person.status === 'invited' ? (
                  <form action={askWitness}>
                    <input type="hidden" name="id" value={draft.id} />
                    <input type="hidden" name="witness" value={person.id} />
                    <Button type="submit" variant="secondary">
                      {setupCopy.witnesses.ask(person.name.split(' ')[0] ?? person.name)}
                    </Button>
                  </form>
                ) : null}

                {person.status === 'declined' ? (
                  <p className={styles.hint}>{setupCopy.witnesses.declinedNote}</p>
                ) : null}
              </div>
            ))}
          </div>

          {invited === undefined ? null : (
            <>
              <p className={styles.hint}>
                {setupCopy.witnesses.linkLabel(
                  summary.find((person) => person.id === witnessId)?.name.split(' ')[0] ??
                    'them',
                )}
              </p>
              <p className={styles.link}>{`${env.NEXT_PUBLIC_APP_URL}/k/${invited}`}</p>
              <p className={styles.hint}>{setupCopy.witnesses.linkNote}</p>
            </>
          )}
        </section>
      )}

      <p className={styles.foot}>{setupCopy.witnesses.foot}</p>
    </SetupShell>
  )
}
