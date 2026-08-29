import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { collectionCopy } from '@/copy/collection'
import { verifyCopy } from '@/copy/verify'
import { prisma } from '@/db/client'
import {
  collectionForOrganiser,
  handoverHasEvidence,
  collectionPageBySlug,
} from '@/db/repositories/collection'
import { env } from '@/lib/env'
import { formatMoney, fromCents } from '@/domain/money'
import { currentSession } from '@/lib/session'
import { Button, Card, Field, Toast } from '@/ui/primitives'

import {
  askHost,
  askWitness,
  markArrived,
  markHandedOver,
  requestShareLink,
  saveCollectionDetails,
} from '../actions'

import styles from '../collections.module.css'

/**
 * The organiser's own screen: who has joined, who has actually paid her, and
 * the link she cannot have yet.
 *
 * **The share request refuses, and that is the feature.** With a host we could
 * withhold a payout; with a collection she has the money before we could
 * object, so the absence of a shareable link is the only leverage that exists
 * (rule 13). M3-01 is what would satisfy it and M3-01 does not exist, so the
 * screen says so in plain words rather than hiding the button or pretending the
 * check is coming this week.
 *
 * **Deliberately plain — M3-08 replaces it**, the same treatment `/account` and
 * `/manage/[id]` got.
 */

export const metadata: Metadata = {
  title: 'Your collection · Isipheko',
  robots: { index: false, follow: false },
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    blocked?: string
    shared?: string
    confirmed?: string
    closed?: string
    details?: string
    witness?: string
    member?: string
    host?: string
    handover?: string
  }>
}) {
  const session = await currentSession()
  if (session === null) redirect('/sign-in')

  const { id } = await params
  const { blocked, shared, confirmed, closed, details, witness, member, host, handover } =
    await searchParams

  const collection = await collectionForOrganiser(prisma, {
    id,
    organiserId: session.organiserId,
  })
  if (collection === null) redirect('/account')

  // The public view, for the handover's own account of itself: who confirmed
  // it, and when.
  const page =
    collection.slug === null ? null : await collectionPageBySlug(prisma, collection.slug)

  // Whether her own handover carries a photograph (M4-01b). Scoped to her, and
  // a boolean rather than a key — nothing renders the photograph, and the view
  // the public page shares must not learn that one exists.
  const hasEvidence = await handoverHasEvidence(prisma, {
    id,
    organiserId: session.organiserId,
  })

  const members = await prisma.collectionMember.findMany({
    where: { collectionId: id },
    orderBy: { joinedAt: 'asc' },
    select: { id: true, name: true, amountCents: true, status: true },
  })

  const waiting = members.filter((person) => person.status === 'pending')

  const handedOverOn =
    page?.handoverAt == null
      ? null
      : new Intl.DateTimeFormat('en-ZA', {
          day: 'numeric',
          month: 'long',
          timeZone: 'UTC',
        }).format(page.handoverAt)

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{collection.title}</h1>
      <p className={styles.body}>{collectionCopy.holdsTheMoneyShort('You')}</p>

      {confirmed === '1' ? <Toast>{collectionCopy.manage.markedArrived}</Toast> : null}
      {shared === '1' ? <Toast>{collectionCopy.manage.linkReady}</Toast> : null}
      {details === 'saved' ? <Toast>{collectionCopy.manage.detailsSaved}</Toast> : null}
      {details === 'incomplete' ? (
        <Toast tone="problem">{collectionCopy.manage.detailsIncomplete}</Toast>
      ) : null}
      {details === 'closed' ? (
        <Toast tone="problem">{collectionCopy.manage.detailsClosed}</Toast>
      ) : null}

      {/*
        Editing what the collection says about itself (UX-09). The bank hint
        is the string members are told to send money to, and until this card a
        typo in it was permanent — the "pays the wrong account" failure as an
        uncorrectable field. Gone once the record closes: the seal says it
        cannot be edited by anyone, including her, and the UPDATE refuses too.
      */}
      {collection.handoverStatus === 'not_started' ? (
        <Card
          title={collectionCopy.manage.detailsTitle}
          titleAs="h2"
          className={styles.card}
        >
          <p className={styles.body}>{collectionCopy.manage.detailsIntro}</p>

          <form action={saveCollectionDetails} className={styles.form}>
            <input type="hidden" name="id" value={id} />

            <Field
              id="title"
              name="title"
              label={collectionCopy.setup.nameLabel}
              defaultValue={collection.title}
              required
            />
            <Field
              id="purpose"
              name="purpose"
              label={collectionCopy.setup.forWhomLabel}
              defaultValue={collection.purpose ?? ''}
            />
            <Field
              id="bankHint"
              name="bankHint"
              label={collectionCopy.setup.bankHintLabel}
              defaultValue={collection.organiserBankHint ?? ''}
            />

            <Button type="submit" variant="secondary">
              {collectionCopy.manage.detailsSave}
            </Button>
          </form>
        </Card>
      ) : null}

      <Card title={collectionCopy.manage.linkTitle} titleAs="h2" className={styles.card}>
        {collection.slug === null ? (
          <>
            {/*
              No bypass exists, deliberately. A flag that made this work for a
              demo would spend the one piece of leverage this product has over
              somebody who is already holding the money.
            */}
            <p className={styles.body}>{collectionCopy.shareBlocked}</p>

            {/*
              The way through, added in M3-01. Until it existed this screen was a
              refusal with no route out of it — the gap M2-10 §10 left open
              deliberately, because there was nothing to point at. Verification
              belongs to the person, so one check here unlocks every collection
              she runs and every event she sets up.
            */}
            <form method="get" action="/verify">
              <input type="hidden" name="returnTo" value={`/collections/${id}`} />
              <Button type="submit">{verifyCopy.fromCollection}</Button>
            </form>

            <form action={requestShareLink}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="secondary">
                Try to get the link
              </Button>
            </form>
            {blocked === undefined ? null : (
              <Toast tone="problem">{collectionCopy.shareBlocked}</Toast>
            )}
          </>
        ) : (
          <p
            className={styles.link}
          >{`${env.NEXT_PUBLIC_APP_URL}/c/${collection.slug}`}</p>
        )}
      </Card>

      <Card
        title={collectionCopy.manage.joinedTitle}
        titleAs="h2"
        className={styles.card}
      >
        <p className={styles.body}>
          Mark somebody off once their money has actually reached you. Only what you have
          marked counts toward what the family is told the group handed over.
        </p>

        {members.length === 0 ? (
          <p className={styles.body}>Nobody yet.</p>
        ) : (
          <ul className={styles.members}>
            {members.map((member) => (
              <li key={member.id} className={styles.member}>
                <span className={styles.memberName}>{member.name}</span>
                <span className={styles.memberAmount} data-numeric="">
                  {member.amountCents === null
                    ? 'Bringing something'
                    : formatMoney(fromCents(member.amountCents))}
                </span>

                {member.status === 'pending' ? (
                  <form action={markArrived}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="member" value={member.id} />
                    <Button type="submit" variant="secondary">
                      It arrived
                    </Button>
                  </form>
                ) : (
                  <span className={styles.memberStatus}>{member.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {waiting.length === 0 ? null : (
          <p className={styles.body}>{`${String(waiting.length)} still to mark off.`}</p>
        )}
      </Card>

      <Card title={collectionCopy.handover.heading} titleAs="h2" className={styles.card}>
        {closed === '1' ? <Toast>{collectionCopy.manage.recordClosed}</Toast> : null}
        {handover === undefined ? null : (
          <Toast tone="problem">
            {collectionCopy.handover.errors[
              handover as keyof typeof collectionCopy.handover.errors
            ] ?? collectionCopy.handover.errors['not-confirmable']}
          </Toast>
        )}

        {collection.handoverStatus === 'not_started' ? (
          <>
            <p className={styles.body}>{collectionCopy.handover.lead}</p>
            <p className={styles.body}>{collectionCopy.handover.body}</p>

            {/*
              A witness is one of the group who will be standing there (Part
              D2.4) — never the family, who are burying their mother and have
              nothing to do in here (rule 15).
            */}
            {members.length === 0 ? (
              <p className={styles.body}>{collectionCopy.manage.nobodyJoined}</p>
            ) : (
              <ul className={styles.members}>
                {members.map((person) => (
                  <li key={person.id} className={styles.member}>
                    <span className={styles.memberName}>{person.name}</span>
                    <form action={askWitness}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="member" value={person.id} />
                      <Button type="submit" variant="secondary">
                        {collectionCopy.handover.ask(
                          person.name.split(' ')[0] ?? person.name,
                        )}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            {witness === undefined ? null : (
              <>
                <p className={styles.body}>
                  {collectionCopy.handover.linkLabel(
                    members.find((person) => person.id === member)?.name.split(' ')[0] ??
                      'their',
                  )}
                </p>
                {/* Shown, not sent: no BSP exists (M2-08), and she passes it on
                    the way she already talks to these people. */}
                <p className={styles.link}>{`${env.NEXT_PUBLIC_APP_URL}/w/${witness}`}</p>
                <p className={styles.body}>{collectionCopy.handover.linkNote}</p>
              </>
            )}

            <h3 className={styles.subheading}>{collectionCopy.handover.myselfHeading}</h3>
            <p className={styles.body}>{collectionCopy.handover.myselfBody}</p>
            {/*
              The photograph (M4-01b), and it is optional in the markup as well
              as in the words: no `required`, and the button closes the record
              with or without a file. She may have no signal, no camera, or
              nobody willing to be photographed at a graveside.

              Stripped by M4-01's pipeline before it is stored — the only one
              there is — because a JPEG off a phone carries the GPS of the house
              it was taken at, which here is the family's address.
            */}
            <form action={markHandedOver}>
              <input type="hidden" name="id" value={id} />

              <label className={styles.body} htmlFor="handover-photo">
                {collectionCopy.handover.myselfPhotoLabel}
              </label>
              <input
                id="handover-photo"
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
              />
              <p className={styles.body}>{collectionCopy.handover.myselfPhotoHelp}</p>

              <Button type="submit" variant="secondary">
                {collectionCopy.handover.myselfLabel}
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className={styles.body}>
              {collection.handoverStatus === 'witness_confirmed'
                ? collectionCopy.handover.sealWitness(page?.witnessName ?? '')
                : collectionCopy.handover.sealOrganiser}
            </p>
            <p className={styles.body}>
              {collection.handoverStatus === 'witness_confirmed'
                ? collectionCopy.handover.sealWitnessBody(
                    page?.witnessName ?? '',
                    handedOverOn ?? '',
                  )
                : hasEvidence
                  ? collectionCopy.handover.sealOrganiserWithPhotoBody
                  : collectionCopy.handover.sealOrganiserBody}
            </p>

            {/*
              Said where she can see it, and only where it is true. The record
              claims a photograph exists; this is the screen that can honestly
              tell her it does.
            */}
            {hasEvidence ? (
              <p className={styles.body}>{collectionCopy.handover.myselfPhotoAttached}</p>
            ) : null}

            {collection.slug === null ? null : (
              <form method="get" action={`/c/${collection.slug}/incwadi`}>
                <Button type="submit">{collectionCopy.incwadi.print}</Button>
              </form>
            )}

            {/* Optional, and never required (rule 15). Offered after the record
                is closed, because there is nothing to acknowledge before it. */}
            <h3 className={styles.subheading}>{collectionCopy.handover.hostHeading}</h3>
            <p className={styles.body}>{collectionCopy.handover.hostDoesNothing}</p>

            {host === undefined ? (
              <form action={askHost}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="secondary">
                  Get a link for the family
                </Button>
              </form>
            ) : (
              <p className={styles.link}>{`${env.NEXT_PUBLIC_APP_URL}/h/${host}`}</p>
            )}
          </>
        )}
      </Card>
    </main>
  )
}
