/* eslint-disable @next/next/no-head-element --
 * The rule assumes an App Router page, where Next owns the document. This file
 * *is* the document: it is rendered with renderToStaticMarkup and served from a
 * route handler, so there is no <Head /> to use and no layout above it. See
 * docs/decisions.md M1-08.
 */

import type { ArchetypeConfig } from '@/domain/archetype'
import { albumCopy } from '@/copy/album'
import { archetypeEventCopy, eventCopy } from '@/copy/event'
import { reportCopy } from '@/copy/report'
import { nameList, witnessCopy } from '@/copy/witness'
import type { PublicEvent } from '@/db/repositories/event'

import { formatDayMonth } from '@/lib/dates'
import { formatEventDate } from '@/lib/event-card'

import { PUBLIC_PAGE_CSS } from './public-page-css'
import { formatReference } from '@/domain/reference'

import { BoardNotice, NeedsBoard, SuggestForm, type BoardOutcome } from './needs-board'
import { LedgerStrand } from './strand'
import { STRAND_CSS } from './strand-css'
import { accentStyle } from './theme'
import { TOKENS_CSS } from './tokens'

import type { StrandBead } from '@/db/repositories/strand'

/**
 * The public event page, as markup.
 *
 * Rendered with `renderToStaticMarkup` and served from a route handler, so
 * **none of this ships a byte of JavaScript**. An App Router page for the same
 * content measured 199KB of first load, 174KB of which was React and the
 * router, against a 150KB ceiling — see docs/decisions.md M1-08 and Part G.
 *
 * That is why this file builds its own `<html>`: there is no root layout here,
 * no `metadata` export, and no CSS Modules. The head is written by hand and the
 * critical CSS is inlined, which is also what Part G's budget assumed.
 *
 * The Ledger Strand (M2-06) and claiming (M2-03) are not here. Nothing has been
 * contributed yet and there is nothing to claim, so the page says so rather
 * than showing an empty frame.
 */

export interface PublicPageProps {
  readonly event: PublicEvent
  readonly archetype: ArchetypeConfig
  /** What just happened to a claim, if anything. Rendered by the server. */
  readonly outcome?: BoardOutcome | undefined
  /** Whether this browser holds the undo capability for that claim. */
  readonly canUndo?: boolean | undefined
  /** Every confirmed contribution, in the order the chain recorded them. */
  readonly beads?: readonly StrandBead[] | undefined
  /** The bead whose panel is open, from `?bead=`. */
  readonly openBeadId?: string | undefined
  /** Passed in so "3 days ago" is decided by the request, not by the render. */
  readonly now?: Date | undefined
  /**
   * The link preview (M2-07). Absent only in tests that do not care — a page
   * rendered without it is a page WhatsApp shows as a bare URL.
   */
  readonly card?: PageCard | undefined
  /** What just happened to a suggestion, from `?suggested=` (UX-19). */
  readonly suggested?: 'done' | 'empty' | undefined
}

export interface PageCard {
  /** Absolute. A relative og:image is ignored by every crawler there is. */
  readonly imageUrl: string
  readonly pageUrl: string
  readonly width: number
  readonly height: number
  readonly description: string
}

export function PublicEventPage({
  event,
  archetype,
  outcome,
  canUndo,
  beads = [],
  openBeadId,
  now,
  card,
  suggested,
}: PublicPageProps) {
  const copy = archetypeEventCopy[event.archetype]
  const when = [formatEventDate(event.eventDate), event.place]
    .filter((part) => part !== null && part !== '')
    .join(' · ')

  /**
   * The badge (M3-02). True or absent, never softened — a badge nobody earned
   * teaches people the badge means nothing (M1-08 §5).
   *
   * Publishing requires the check, so on a page a stranger can reach this is
   * always set. It is read rather than assumed anyway: a page that assumes will
   * eventually assert something false, and this is the assertion people decide
   * whether to send money on.
   */
  const verifiedOn = formatDayMonth(event.organiserVerifiedAt)

  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* A death in the family must not be findable on Google (§10). The
            header on the response says the same thing, for crawlers that never
            parse the document. */}
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${event.title} · Isipheko`}</title>

        {/*
          The link preview. More people see this than see the page — for most
          of a family it *is* the product (architecture §9.1) — so the tags are
          written out here rather than left to a crawler to guess at.

          `noindex` above and these are not in conflict: WhatsApp is not a
          search engine and does not read robots directives. What is kept off
          Google is the page; what is given to the person in the chat is a card.
        */}
        {card === undefined ? null : (
          <>
            <meta property="og:type" content="website" />
            <meta property="og:site_name" content="Isipheko" />
            <meta property="og:title" content={event.title} />
            <meta property="og:description" content={card.description} />
            <meta property="og:url" content={card.pageUrl} />
            <meta property="og:image" content={card.imageUrl} />
            <meta property="og:image:secure_url" content={card.imageUrl} />
            <meta property="og:image:type" content="image/png" />
            <meta property="og:image:width" content={String(card.width)} />
            <meta property="og:image:height" content={String(card.height)} />
            <meta property="og:image:alt" content={event.title} />
            <meta name="twitter:card" content="summary_large_image" />
          </>
        )}
        <style
          // Inlined rather than linked: one round trip instead of two, on a
          // connection where the round trip is the expensive part.
          dangerouslySetInnerHTML={{
            __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}${STRAND_CSS}`,
          }}
        />
        {/* ~1.5KB gzipped, deferred, and the page works identically without
            it. It removes the reload on a claim and runs the undo countdown; it
            does not implement either. A separate file rather than an inline
            script because §10 forbids `unsafe-inline` in script-src. */}
        <script src="/needs-board.js" defer />
      </head>

      <body>
        <div
          className="page"
          data-archetype={event.archetype}
          // The same helper ArchetypeTheme spreads: bereavement declares no
          // accent, nothing is set, and var(--accent, #16233D) renders indigo
          // on its own (rule 2).
          {...accentStyle(archetype)}
        >
          <header className="header">
            <p className="kicker">{archetype.kicker}</p>
            <h1 className="title">{event.title}</h1>
            {event.subtitle === null ? null : (
              <p className="subtitle">{event.subtitle}</p>
            )}
            {when === '' ? null : (
              <p className="when" data-numeric="">
                {when}
              </p>
            )}
            {event.organiserName === null ? null : (
              <p className="organiser">{eventCopy.organiser.by(event.organiserName)}</p>
            )}
            {/* Above the fold, beside the name it belongs to, with the date on
                it. The tick is decorative — the sentence beside it is what a
                screen reader reads, and the accessible name carries the name
                and the date rather than a bare "verified". */}
            {event.witnesses.length === 0 ? null : (
              /*
                "Their names go on the page beside yours" — the promise the
                setup screen makes, kept literally (M3-03).

                Only those who agreed, names only, and no count. This is honour
                rather than audit: a declined invitation is a private answer to
                a private question, and publishing it would turn a courtesy into
                a record of who refused a grieving family.
              */
              <p className="witnesses" aria-label={witnessCopy.public.label}>
                {witnessCopy.public.standingWith(nameList(event.witnesses))}
              </p>
            )}
            {verifiedOn === null ? null : (
              <p
                className="verified"
                aria-label={
                  event.organiserName === null
                    ? undefined
                    : eventCopy.organiser.badgeLabel(event.organiserName, verifiedOn)
                }
              >
                <span className="verifiedTick" aria-hidden="true">
                  ✓
                </span>
                <span data-numeric="">{eventCopy.organiser.badge(verifiedOn)}</span>
              </p>
            )}
          </header>

          {/* A landmark around everything between the banner and the footer:
              without it the safety block sits outside any region, which axe
              fails and which costs a screen-reader user the ability to jump
              straight to the content. */}
          <main>
            {/* The id is a landing point: the contribute flow's "bring
                something" option links to `/e/<slug>#needs`, because claiming
                happens here and only here (M2-03). */}
            <section className="section" id="needs" aria-labelledby="needs-heading">
              <h2 className="heading" id="needs-heading">
                {eventCopy.needs.heading}
              </h2>
              <p className="intro">{copy.needsIntro}</p>

              <form
                method="get"
                action={`/e/${event.slug}/contribute`}
                className="claimForm"
              >
                <button type="submit" className="buttonPrimary">
                  {archetype.verb}
                </button>
              </form>

              <BoardNotice outcome={outcome} />

              <NeedsBoard
                slug={event.slug}
                items={event.needs.map((need) => ({
                  id: need.id,
                  label: need.label,
                  // "the tent", as it appears in "I'll bring the tent".
                  noun: need.label.toLowerCase(),
                  note: need.note,
                  quantityRequired: need.quantityRequired,
                  quantityClaimed: need.quantityClaimed,
                  remaining: need.quantityRequired - need.quantityClaimed,
                  unit: need.unit ?? '',
                  allowsPartialClaim: need.quantityRequired > 1,
                }))}
                outcome={outcome}
                canUndo={canUndo}
              />

              {/* The contributor's half of suggestions (UX-19): built in
                  M2-04, answered by M3-08, askable only now. */}
              <SuggestForm slug={event.slug} suggested={suggested} />
            </section>

            <section className="section" id="strand" aria-labelledby="strand-heading">
              <h2 className="heading" id="strand-heading">
                {copy.strandHeading}
              </h2>

              <LedgerStrand
                slug={event.slug}
                archetype={archetype}
                beads={beads}
                openId={openBeadId}
                now={now}
              />

              {/*
                The album (M4-02). Offered only once there is something in it —
                an empty state here would be a second empty state under the one
                the strand already shows.

                *"The whole record"* rather than *"View album"*: album is a word
                the product invented for a thing that already has a name, and
                this link appears on a funeral page.
              */}
              {beads.length === 0 ? null : (
                <p className="claimHelp">
                  <a className="checkLink" href={`/e/${event.slug}/album`}>
                    {albumCopy.link}
                  </a>
                </p>
              )}
            </section>

            <div className="safety">
              {/* Unreachable on a published page since M3-02, and kept because
                  the page reads the status rather than assuming it. */}
              {verifiedOn === null ? (
                <p className="safetyLine">{eventCopy.organiser.unverified}</p>
              ) : null}
              <p className="safetyLine">
                {eventCopy.safety.line}{' '}
                <a className="safetyLink" href="#trust">
                  {eventCopy.safety.check}
                </a>
              </p>
            </div>

            <section className="trust" id="trust" aria-labelledby="trust-heading">
              <h2 className="heading" id="trust-heading">
                {eventCopy.trust.heading}
              </h2>
              <p className="intro">{eventCopy.trust.intro}</p>

              <div className="trustBlock">
                <h3 className="trustHeading">{eventCopy.trust.checkedHeading}</h3>
                {verifiedOn === null || event.organiserName === null ? (
                  <p className="trustBody">{eventCopy.trust.checkedNothing}</p>
                ) : (
                  <>
                    <p className="trustBody">
                      {eventCopy.trust.checkedVerified(event.organiserName, verifiedOn)}
                    </p>
                    {/* The limit of what a badge means, said by us rather than
                        left for somebody to assume. It confirms the organiser,
                        not the ceremony. */}
                    <p className="trustBody">{eventCopy.trust.checkedNote}</p>
                  </>
                )}
              </div>

              <div className="trustBlock">
                <h3 className="trustHeading">{eventCopy.trust.yourselfHeading}</h3>
                <p className="trustBody">{eventCopy.trust.yourselfIntro}</p>
                <ul className="trustList">
                  <li>{eventCopy.trust.yourselfAsk}</li>
                  <li>{eventCopy.trust.yourselfSender}</li>
                  {/* Never a number on this page — verification that points back
                      at the thing being verified proves nothing (voice rules). */}
                  <li data-numeric="">
                    {eventCopy.trust.yourselfCheck(formatReference(event.reference))}
                    {/*
                      The link sits *under* the instruction and never replaces
                      it. Labelled with the address itself, so the label teaches
                      the shape of the real one — which is what helps somebody
                      spot a fake later (M3-04).

                      `rel="noreferrer"` because /check must not learn which
                      page somebody arrived from: the answer has to be
                      independent of the thing being checked, and a Referer
                      header would quietly make it not.
                    */}
                    <a className="checkLink" href="/check" rel="noreferrer">
                      {eventCopy.trust.yourselfCheckLink}
                    </a>
                  </li>
                </ul>
              </div>

              <div className="trustBlock">
                <h3 className="trustHeading">{eventCopy.trust.neverHeading}</h3>
                <p className="trustBody">{eventCopy.trust.neverBody}</p>
                {/*
                  What this page can do with money, and it is a different answer
                  per mode (M5-02b). The ledger-only sentence says the page
                  cannot take a payment, which stopped being true of a hosted
                  event the moment M5-02 built a checkout reachable from here —
                  in the panel that exists to be believed, on the screen before
                  the one that takes it. Read from the event rather than assumed,
                  the same posture as the badge above.
                */}
                <p className="trustBody">
                  {event.mode === 'hosted'
                    ? eventCopy.trust.moneyBodyHosted
                    : eventCopy.trust.moneyBody}
                </p>
              </div>

              <div className="trustBlock">
                <h3 className="trustHeading">{eventCopy.trust.wrongHeading}</h3>
                <p className="trustBody">{eventCopy.trust.wrongBody}</p>
                {/* Under the instruction and labelled with the address, like
                    the link to /check (M3-04 §2). It carries the slug so the
                    report knows what it is about without her retyping it, and
                    `noreferrer` for the same reason /check does. */}
                <a
                  className="checkLink"
                  href={`/report?e=${event.slug}`}
                  rel="noreferrer"
                >
                  {reportCopy.linkLabel}
                </a>
              </div>
            </section>
          </main>

          <footer className="footer">
            <p className="footerText">{eventCopy.footer}</p>
          </footer>
        </div>
      </body>
    </html>
  )
}

export function NotFoundPage() {
  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>Not found · Isipheko</title>
        <style dangerouslySetInnerHTML={{ __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}` }} />
      </head>
      <body>
        <div className="page">
          <header className="header">
            <h1 className="title">{eventCopy.notFound.title}</h1>
            <p className="intro">{eventCopy.notFound.body}</p>
          </header>
        </div>
      </body>
    </html>
  )
}
