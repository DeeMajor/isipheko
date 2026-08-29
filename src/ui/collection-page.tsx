/* eslint-disable @next/next/no-head-element --
 * Like the event page, this file *is* the document: rendered with
 * renderToStaticMarkup and served from a route handler, because an App Router
 * page would put 174KB of framework back on a public contributor path
 * (docs/decisions.md M1-08).
 */

import { archetypeCollectionCopy, collectionCopy } from '@/copy/collection'
import type { CollectionPage } from '@/db/repositories/collection'
import type { ArchetypeConfig } from '@/domain/archetype'
import { formatMoneyWhole, fromCents } from '@/domain/money'
import { reportCopy } from '@/copy/report'
import { formatDayMonth } from '@/lib/dates'

import { COLLECTION_PAGE_CSS } from './collection-page-css'
import { PUBLIC_PAGE_CSS } from './public-page-css'
import { accentStyle } from './theme'
import { TOKENS_CSS } from './tokens'

/**
 * The collection's own page.
 *
 * **Rule 16 and Part D2.6 are the whole of this screen's job.** The people
 * reading it are about to give money to a private person on the strength of a
 * link, and what they are trusting is her, not us. So the custody panel says
 * that in her name, near the top, before anything asks them to join — and the
 * trust panel answers *"is this real"* and *"who holds the money"* as two
 * separate questions, because they are.
 *
 * Both blocks are verbatim from `design/collection.html`.
 *
 * **The amounts here are the group's own.** The host's page shows one bead that
 * opens to names and no breakdown (rule 14); this page shows the roster with
 * what each person put in, because these are people who know each other and the
 * total has to add up for them. Somebody who joined quietly is quiet from the
 * wider world, not from the eight cousins.
 */

export interface CollectionPageProps {
  readonly collection: CollectionPage
  readonly archetype: ArchetypeConfig
  readonly joined?: boolean
}

/**
 * `formatMoneyWhole`, so R800 is R800 and R800,50 keeps its cents (M1-03 §6).
 * A roster of amounts ending in ,00 is noise on a small screen.
 */
const money = (cents: bigint | null) =>
  cents === null ? null : formatMoneyWhole(fromCents(cents))

export function CollectionPublicPage({
  collection,
  archetype,
  joined = false,
}: CollectionPageProps) {
  const copy = collectionCopy.page
  const archetypeCopy = archetypeCollectionCopy[collection.archetype]
  const organiser = collection.organiserName ?? ''
  // Who the giving is for: what she typed, then the host event's name, and
  // only then the group's own name — "Goes to The Ngcobo cousins" would be the
  // page telling the cousins their money goes to themselves.
  const forWhom = collection.purpose ?? collection.event?.title ?? collection.title
  const people = collection.roster.length
  const marked = collection.roster.filter(
    (member) => member.status === 'confirmed',
  ).length
  const verifiedOn = formatDayMonth(collection.organiserVerifiedAt)

  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Somebody's collection for a family funeral must not be findable on
            Google either (§10). */}
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${collection.title} · Isipheko`}</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}${COLLECTION_PAGE_CSS}`,
          }}
        />
      </head>

      <body>
        <div
          className="page"
          data-archetype={collection.archetype}
          {...accentStyle(archetype)}
        >
          <header className="header">
            <p className="kicker">{`${copy.kicker} · ${archetype.kicker}`}</p>
            <h1 className="title">{collection.title}</h1>
            {collection.purpose === null ? null : (
              <p className="subtitle">{collection.purpose}</p>
            )}
            <p className="when" data-numeric="">
              {/*
                The verified line is stated as fact or not at all — never
                softened into "verification coming soon" (M1-08 §5). Any page
                somebody can reach implies a verified organiser, because that is
                what the share gate means (rule 13).
              */}
              {verifiedOn === null
                ? copy.heldBy(organiser)
                : `${copy.heldBy(organiser)} · ${copy.verifiedOn(verifiedOn)}`}
            </p>
          </header>

          <main>
            {joined ? (
              <div className="claimed" role="status">
                <p className="claimedTitle">{collectionCopy.join.doneTitle}</p>
                <p className="claimedBody">{collectionCopy.join.doneBody(organiser)}</p>
              </div>
            ) : null}

            {/* The custody panel. It is the first thing under the header on
                purpose: it is what somebody needs before they decide. */}
            <section className="section" aria-labelledby="custody-heading">
              <div className="custody">
                <p className="custodyTitle" id="custody-heading">
                  {copy.custodyTitle(organiser)}
                </p>
                <p className="custodyBody">{copy.custodyBody}</p>
                {/*
                  Why there is no card here when an event page may have one
                  (M5-12). Unasked before M5-02 built a checkout; unavoidable
                  after it, and silence would read as broken rather than honest.
                */}
                <p className="custodyBody">{copy.custodyNoCard(organiser)}</p>
                <p className="custodyBody">
                  <a className="safetyLink" href="#trust">
                    {copy.custodyLink}
                  </a>
                </p>
              </div>
            </section>

            <section className="section" aria-labelledby="giving-heading">
              <h2 className="heading" id="giving-heading">
                {copy.givingHeading}
              </h2>
              <p className="intro">{archetypeCopy.beadNote}</p>

              {collection.needItem === null ? null : (
                <div className="givingCard">
                  <div className="givingHead">
                    <p className="givingTitle">{collection.needItem.label}</p>
                    <span className="givingTag">{copy.claimedHeldByUs}</span>
                  </div>
                  {/*
                    No shortfall arithmetic. The design computes "still R300
                    short" from an item's cost, and a need item carries the
                    organiser's free text — "Around R1 200 to hire" — rather
                    than a number (M1-07 §3). Parsing prose into money on a page
                    about money is not a trade worth making, and telling a group
                    they are R300 short when they are not is the failure it buys.
                  */}
                  <p className="givingBody">{copy.claimedBody(people)}</p>
                  <p className="givingWhy">{copy.claimedWhy}</p>
                </div>
              )}

              <div className="givingCard">
                <p className="givingTitle">{copy.restTitle}</p>
                <p className="givingBody">{copy.restBody(forWhom)}</p>
              </div>

              <div className="total">
                <p className="totalLabel">{copy.totalLabel}</p>
                <p className="totalAmount" data-numeric="">
                  {money(collection.confirmedCents) ?? formatMoneyWhole(fromCents(0n))}
                </p>
                <p className="totalNote" data-numeric="">
                  {copy.totalNote(people, marked)}
                </p>
              </div>
            </section>

            <section className="section" aria-labelledby="members-heading">
              <h2 className="heading" id="members-heading">
                {copy.membersHeading(people)}
              </h2>
              <p className="intro">
                {collection.event === null
                  ? copy.membersIntroStandalone(organiser)
                  : copy.membersIntro(organiser, collection.event.title, people)}
              </p>

              <ul className="roster">
                {collection.roster.map((member) => (
                  <li key={member.id} className="rosterRow">
                    <span className="rosterName">
                      {member.name ?? collectionCopy.members.quiet}
                      {member.status === 'confirmed' ? null : (
                        // Said they have sent it; she has not marked it off.
                        // Hiding this would make somebody think their join
                        // never registered.
                        <span className="rosterNote">{copy.notMarkedOff}</span>
                      )}
                    </span>
                    <span className="rosterAmount" data-numeric="">
                      {money(member.amountCents) ?? ''}
                    </span>
                  </li>
                ))}
              </ul>

              <form method="get" action={`/c/${collection.slug ?? ''}/join`}>
                <button type="submit" className="buttonPrimary">
                  {copy.joinLabel}
                </button>
              </form>
              <p className="claimHelp">{copy.joinNote(organiser)}</p>
            </section>

            <section className="trust" id="trust" aria-labelledby="trust-heading">
              <h2 className="heading" id="trust-heading">
                {copy.trustHeading}
              </h2>
              <p className="intro">{copy.trustIntro}</p>

              {verifiedOn === null ? null : (
                <div className="trustBlock">
                  <h3 className="trustHeading">{copy.checkedHeading}</h3>
                  <p className="trustBody">{copy.checkedBody(organiser, verifiedOn)}</p>
                </div>
              )}

              <div className="trustBlock">
                <h3 className="trustHeading">{copy.holdsHeading}</h3>
                <p className="trustBody">{copy.holdsBody(organiser)}</p>
              </div>

              <div className="trustBlock">
                <h3 className="trustHeading">{copy.weGiveHeading}</h3>
                <p className="trustBody">{copy.weGiveBody}</p>
                <ul className="trustList">
                  {copy.weGive.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>

              <div className="trustBlock">
                <h3 className="trustHeading">{copy.occasionHeading}</h3>
                <p className="trustBody" data-numeric="">
                  {/* Never a number on this page — verification that points back
                      at the thing being verified proves nothing (voice rules). */}
                  {collection.event === null
                    ? copy.occasionBodyNoCode
                    : copy.occasionBody(collection.event.reference)}
                </p>
              </div>

              <div className="trustBlock">
                <h3 className="trustHeading">{copy.wrongHeading}</h3>
                <p className="trustBody">{copy.wrongBody}</p>
                {/* Under the instruction, labelled with the address (M3-04 §2). */}
                <a
                  className="checkLink"
                  href={`/report?c=${collection.slug}`}
                  rel="noreferrer"
                >
                  {reportCopy.linkLabel}
                </a>
              </div>
            </section>
          </main>
        </div>
      </body>
    </html>
  )
}
