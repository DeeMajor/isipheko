import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { payDetailsCopy } from '@/copy/contribute'
import { setupCopy } from '@/copy/setup'
import { prisma } from '@/db/client'
import { pendingReports } from '@/db/repositories/contribution'
import { draftForOrganiser } from '@/db/repositories/event'
import { awaitingDelivery, inKindDescription } from '@/db/repositories/needs'
import { witnessSummaryForEvent } from '@/db/repositories/witness'
import { formatMoney, fromCents } from '@/domain/money'
import { env } from '@/lib/env'
import { currentSession } from '@/lib/session'
import { Button, Card, Field, Toast } from '@/ui/primitives'

import { askWitnessHere, confirmArrival, confirmReport, savePayDetails } from './actions'

import styles from './page.module.css'

/**
 * **A deliberately plain stub. M3-08 replaces it** with the real dashboard —
 * the same treatment M1-07's `/account` got.
 *
 * It exists because Mode A cannot work without two things nothing else
 * provides: somewhere for the organiser to say how people pay them, and
 * somewhere to confirm that somebody did. Without the first, the contribution
 * flow dead-ends at the step it exists for.
 */

export const metadata: Metadata = {
  title: 'Your umcimbi · Isipheko',
  robots: { index: false, follow: false },
}

export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    saved?: string
    confirmed?: string
    error?: string
    invited?: string
    witness?: string
  }>
}) {
  const session = await currentSession()
  if (session === null) redirect('/sign-in')

  const { id } = await params
  const { saved, confirmed, error, invited, witness: witnessId } = await searchParams

  const draft = await draftForOrganiser(prisma, { id, organiserId: session.organiserId })
  if (draft === null) redirect('/account')

  const event = await prisma.event.findUniqueOrThrow({
    where: { id },
    select: { directPayDetails: true },
  })

  const details = event.directPayDetails as { phone?: string; name?: string } | null
  const reports = await pendingReports(prisma, {
    eventId: id,
    organiserId: session.organiserId,
  })

  const witnesses = await witnessSummaryForEvent(prisma, {
    eventId: id,
    organiserId: session.organiserId,
  })

  const arrivals = await awaitingDelivery(prisma, {
    eventId: id,
    organiserId: session.organiserId,
  })

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{draft.title}</h1>

      {saved === '1' ? <Toast>{payDetailsCopy.saved}</Toast> : null}
      {confirmed === '1' ? <Toast>Recorded on the ledger.</Toast> : null}
      {error === undefined ? null : (
        <Toast tone="problem">That did not go through. Nothing was changed.</Toast>
      )}

      <Card title={payDetailsCopy.title} titleAs="h2" className={styles.card}>
        <p className={styles.body}>{payDetailsCopy.intro}</p>

        <form action={savePayDetails} className={styles.form}>
          <input type="hidden" name="id" value={id} />
          <Field
            id="phone"
            name="phone"
            label={payDetailsCopy.numberLabel}
            help={payDetailsCopy.numberHelp}
            defaultValue={details?.phone ?? ''}
            inputMode="tel"
            data-numeric=""
            required
          />
          <Field
            id="name"
            name="name"
            label={payDetailsCopy.nameLabel}
            help={payDetailsCopy.nameHelp}
            defaultValue={details?.name ?? ''}
            required
          />
          <Button type="submit">{payDetailsCopy.submit}</Button>
        </form>

        {details?.phone === undefined ? (
          <p className={styles.body}>{payDetailsCopy.missing}</p>
        ) : null}
      </Card>

      <Card title="Waiting for you" titleAs="h2" className={styles.card}>
        <p className={styles.body}>
          People who have told us they paid. Check each one against your own bank
          notification before you confirm it — once confirmed it is on the ledger, and a
          correction is a new entry rather than an edit.
        </p>

        {reports.length === 0 ? (
          <p className={styles.body}>
            Nothing is waiting for you. You can put the phone down.
          </p>
        ) : (
          <ul className={styles.reports}>
            {reports.map((report) => (
              <li key={report.id} className={styles.report}>
                <p className={styles.reportName}>{report.contributorName}</p>
                <p className={styles.reportMeta} data-numeric="">
                  {report.amountCents === null
                    ? 'Something brought'
                    : formatMoney(fromCents(report.amountCents))}
                  {' · '}
                  {report.reference}
                </p>
                {report.message === null ? null : (
                  <p className={styles.body}>{report.message}</p>
                )}

                <form action={confirmReport}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="contribution" value={report.id} />
                  <Button type="submit" variant="secondary">
                    Yes, this arrived
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Things people are bringing" titleAs="h2" className={styles.card}>
        <p className={styles.body}>
          Say so when something has arrived. That is what puts it on the strand — until
          then the family is still waiting for it, and the record says so.
        </p>

        {arrivals.length === 0 ? (
          <p className={styles.body}>Nobody is bringing anything at the moment.</p>
        ) : (
          <ul className={styles.reports}>
            {arrivals.map((arrival) => (
              <li key={arrival.claimId} className={styles.report}>
                <p className={styles.reportName}>{arrival.claimantName}</p>
                <p className={styles.reportMeta} data-numeric="">
                  {inKindDescription(arrival.label, arrival.quantity)}
                </p>

                <form action={confirmArrival}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="claim" value={arrival.claimId} />
                  <Button type="submit" variant="secondary">
                    Yes, this arrived
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/*
        Abakhaphi, after publishing (M3-03). The setup step is where she names
        them; this is where she is when somebody has not answered yet, or when a
        phone was lost and the link needs issuing again.

        Still the plain screen M3-08 replaces.
      */}
      <Card title="Abakhaphi" titleAs="h2" className={styles.card}>
        <p className={styles.body}>{setupCopy.witnesses.foot}</p>

        {witnesses.length === 0 ? (
          <p className={styles.body}>Nobody has been asked yet.</p>
        ) : (
          <ul className={styles.reports}>
            {witnesses.map((person) => (
              <li key={person.id} className={styles.report}>
                <p className={styles.reportName}>{person.name}</p>
                <p className={styles.reportMeta}>
                  {person.status === 'accepted'
                    ? setupCopy.witnesses.statusAccepted
                    : person.status === 'declined'
                      ? setupCopy.witnesses.statusDeclined
                      : setupCopy.witnesses.statusInvited}
                </p>

                {person.status === 'invited' ? (
                  <form action={askWitnessHere}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="witness" value={person.id} />
                    <Button type="submit" variant="secondary">
                      {setupCopy.witnesses.ask(person.name.split(' ')[0] ?? person.name)}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {invited === undefined ? null : (
          <>
            <p className={styles.body}>
              {setupCopy.witnesses.linkLabel(
                witnesses.find((person) => person.id === witnessId)?.name.split(' ')[0] ??
                  'them',
              )}
            </p>
            {/* Shown, never sent (M1-06 §6, M2-08 §12). */}
            <p className={styles.link}>{`${env.NEXT_PUBLIC_APP_URL}/k/${invited}`}</p>
            <p className={styles.body}>{setupCopy.witnesses.linkNote}</p>
          </>
        )}
      </Card>
    </main>
  )
}
