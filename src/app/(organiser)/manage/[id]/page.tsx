import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { payDetailsCopy } from '@/copy/contribute'
import { dashboardCopy } from '@/copy/dashboard'
import { setupCopy } from '@/copy/setup'
import { prisma } from '@/db/client'
import { latestRender } from '@/db/repositories/album-render'
import { pendingReports } from '@/db/repositories/contribution'
import { draftForOrganiser } from '@/db/repositories/event'
import { awaitingDelivery, organiserBoard } from '@/db/repositories/needs'
import { bankAccountVerified, payoutApprovedByWitness } from '@/db/repositories/payout'
import { balanceForEvent } from '@/db/repositories/payout'
import { strandForEvent } from '@/db/repositories/strand'
import { witnessSummaryForEvent } from '@/db/repositories/witness'
import { ARCHETYPES } from '@/domain/archetype'
import { payoutConditions } from '@/domain/payout'
import { formatEventDate } from '@/lib/event-card'
import { env } from '@/lib/env'
import { currentSession } from '@/lib/session'
import { Button, Card, Field, Toast } from '@/ui/primitives'
import { LedgerStrand } from '@/ui/strand'
import { ArchetypeTheme } from '@/ui/theme'

import { askWitnessHere, savePayDetails } from './actions'
import { NeedsBoard } from './board'
import { MoneySection } from './money'
import { ConfirmationQueue, buildQueue } from './queue'
import { PrintSection } from './print'

import styles from './page.module.css'

/**
 * The organiser's dashboard — `design/dashboard.html`, replacing the plain
 * stub M2-05 put here.
 *
 * Four sections in the order she needs them: **what is waiting for her**, what
 * is still missing from the list, the record, and where the money stands.
 *
 * ## Three things in the design file are not shipped as written
 *
 * All three would be copied faithfully by somebody working from the file, so
 * they are named here as well as in `src/copy/dashboard.ts` and
 * docs/decisions.md M3-08 §2:
 *
 * 1. The **R1 test deposit** for bank verification — replaced by Stitch BAV per
 *    Part F.
 * 2. The **countdown on the bereavement variant** — *"in 4 days"*. Rule 1
 *    forbids countdowns on bereavement, and `allowsCountdown` is the config
 *    field that says so. It is read below rather than assumed.
 * 3. **"Money sits in a held Isipheko account"** and the **Request payout**
 *    button — Mode B, which is not built. See `money.tsx`.
 *
 * ## It is reachable before publishing
 *
 * `draftForOrganiser` answers for a draft as well, and that is deliberate: the
 * identity condition is unmet exactly then, which is what keeps it from being a
 * condition that always passes.
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
    details?: string
    confirmed?: string
    released?: string
    error?: string
    invited?: string
    witness?: string
    listed?: string
    album?: string
  }>
}) {
  const session = await currentSession()
  if (session === null) redirect('/sign-in')

  const { id } = await params
  const {
    saved,
    details: detailsSaved,
    confirmed,
    released,
    error,
    invited,
    witness: witnessId,
    listed,
    album: requestedAlbum,
  } = await searchParams

  const organiserId = session.organiserId
  const draft = await draftForOrganiser(prisma, { id, organiserId })
  if (draft === null) redirect('/account')

  const archetype = ARCHETYPES[draft.archetype]
  const now = new Date()

  const [event, organiser, reports, arrivals, board, witnesses, beads, balance] =
    await Promise.all([
      prisma.event.findUniqueOrThrow({
        where: { id },
        select: { directPayDetails: true, place: true, eventDate: true },
      }),
      prisma.organiser.findUniqueOrThrow({
        where: { id: organiserId },
        select: { idVerificationStatus: true, idVerifiedAt: true },
      }),
      pendingReports(prisma, { eventId: id, organiserId }),
      awaitingDelivery(prisma, { eventId: id, organiserId }),
      organiserBoard(prisma, { eventId: id, organiserId }),
      witnessSummaryForEvent(prisma, { eventId: id, organiserId }),
      strandForEvent(prisma, id),
      balanceForEvent(prisma, { eventId: id, now }),
    ])

  const [bankVerified, witnessApproved, albumRender] = await Promise.all([
    bankAccountVerified(prisma, organiserId),
    payoutApprovedByWitness(prisma, id),
    latestRender(prisma, id),
  ])

  const details = event.directPayDetails as { phone?: string; name?: string } | null

  const conditions = payoutConditions({
    identityVerified: organiser.idVerificationStatus === 'verified',
    bankVerified,
    settling: balance.settling,
    available: balance.available,
    witnessApproved,
  })

  /*
   * "Saturday, 15 August · KwaMashu". **The design appends "in 4 days" on the
   * funeral variant**, which rule 1 forbids — a countdown on a page about a
   * burial. `allowsCountdown` is the field that decides it, and no code here
   * asks which archetype this is.
   */
  const whenParts = [formatEventDate(event.eventDate), event.place].filter(
    (part) => part !== null && part !== '',
  )
  const whenLine = whenParts.join(' · ')

  const accepted = witnesses.find((person) => person.status === 'accepted')

  /*
   * The theme wrapper sets `--accent` and nothing else; `<main>` inside it does
   * the layout and is the landmark. Collapsing the two would either lose the
   * landmark — which axe catches and a screen-reader user pays for — or put the
   * accent on the element whose class does the layout.
   */
  return (
    <ArchetypeTheme archetype={archetype}>
      <main className={styles.page}>
        <p className={styles.viewNote}>{dashboardCopy.viewNote}</p>
        <p className={styles.kicker}>{archetype.kicker}</p>
        <h1 className={styles.title}>{draft.title}</h1>
        {whenLine === '' ? null : (
          <p className={styles.when} data-numeric="">
            {whenLine}
          </p>
        )}

        {/*
          The way out (UX-04): the page itself, and the share step for sending
          the link again. On a draft neither exists yet, so the one honest link
          is back into the setup flow.
        */}
        <p className={styles.body}>
          {draft.isPublished ? (
            <>
              <a href={`/e/${draft.slug}`}>{dashboardCopy.links.publicPage}</a>
              {' · '}
              <a href={`/create/${id}/share`}>{dashboardCopy.links.shareAgain}</a>
            </>
          ) : (
            <a href={`/create/${id}/needs`}>{dashboardCopy.links.finishSetup}</a>
          )}
          {' · '}
          <a href={`/create/${id}/details`}>{dashboardCopy.links.editDetails}</a>
        </p>

        {saved === '1' ? (
          <Toast>{payDetailsCopy.saved(details?.phone ?? '')}</Toast>
        ) : null}
        {detailsSaved === '1' ? <Toast>{dashboardCopy.toasts.detailsSaved}</Toast> : null}
        {confirmed === '1' ? <Toast>{dashboardCopy.toasts.confirmed}</Toast> : null}
        {released === '1' ? <Toast>{dashboardCopy.toasts.released}</Toast> : null}
        {listed === '1' ? <Toast>{dashboardCopy.toasts.listUpdated}</Toast> : null}
        {/* An empty record is information, not a failure (UX-12). */}
        {requestedAlbum === 'empty' ? (
          <Toast>{dashboardCopy.toasts.albumEmpty}</Toast>
        ) : null}
        {error === undefined ? null : (
          <Toast tone="problem">
            {dashboardCopy.errors[error as keyof typeof dashboardCopy.errors] ??
              dashboardCopy.errors.generic}
          </Toast>
        )}

        {/* Leads the page. Everything else is below it, deliberately. */}
        <ConfirmationQueue
          eventId={id}
          slug={draft.slug}
          rows={buildQueue(reports, arrivals)}
        />

        <NeedsBoard eventId={id} board={board} />

        <Card title={dashboardCopy.record.heading} titleAs="h2" className={styles.card}>
          <p className={styles.body}>
            {archetype.amountsPublic
              ? dashboardCopy.record.intro
              : dashboardCopy.record.introPrivate}
          </p>

          {beads.length === 0 ? (
            <p className={styles.body}>{dashboardCopy.record.empty}</p>
          ) : (
            <LedgerStrand
              slug={draft.slug}
              archetype={archetype}
              beads={beads}
              now={now}
            />
          )}

          {/*
            The printed album (M4-03). Under the strand, because it is the same
            record in another form — and offered only once there is something in
            it, like the link to the album itself (M4-02).
          */}
          {beads.length === 0 ? null : (
            <PrintSection
              eventId={id}
              slug={draft.slug}
              render={albumRender}
              justRequested={requestedAlbum === '1'}
            />
          )}
        </Card>

        <MoneySection
          facts={{
            mode: draft.mode,
            balance,
            conditions,
            confirmedCount: beads.filter((bead) => bead.amount !== null).length,
            verifiedOn: organiser.idVerifiedAt,
            witnessName: accepted?.name ?? null,
            hasInKind: beads.some((bead) => bead.form === 'in_kind'),
          }}
        />

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
            <Button type="submit" variant="secondary">
              {payDetailsCopy.submit}
            </Button>
          </form>

          {details?.phone === undefined ? (
            <p className={styles.body}>{payDetailsCopy.missing}</p>
          ) : null}
        </Card>

        {/*
        Abakhaphi, after publishing (M3-03). The setup step is where she names
        them; this is where she is when somebody has not answered yet, or when a
        phone was lost and the link needs issuing again.
      */}
        <Card title={setupCopy.witnesses.heading} titleAs="h2" className={styles.card}>
          <p className={styles.body}>{setupCopy.witnesses.foot}</p>

          {witnesses.length === 0 ? (
            <p className={styles.body}>{setupCopy.witnesses.noneAsked}</p>
          ) : (
            <ul className={styles.boardRows}>
              {witnesses.map((person) => (
                <li key={person.id} className={styles.boardRow}>
                  <p className={styles.rowName}>{person.name}</p>
                  <p className={styles.meta}>
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
                        {setupCopy.witnesses.ask(
                          person.name.split(' ')[0] ?? person.name,
                        )}
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
                  witnesses
                    .find((person) => person.id === witnessId)
                    ?.name.split(' ')[0] ?? 'them',
                )}
              </p>
              {/* Shown, never sent (M1-06 §6, M2-08 §12). */}
              <p className={styles.link}>{`${env.NEXT_PUBLIC_APP_URL}/k/${invited}`}</p>
              <p className={styles.body}>{setupCopy.witnesses.linkNote}</p>
            </>
          )}
        </Card>
      </main>
    </ArchetypeTheme>
  )
}
