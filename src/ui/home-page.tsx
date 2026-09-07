/* eslint-disable @next/next/no-head-element -- see collection-page.tsx */

import { homeCopy } from '@/copy/home'

import { HOME_PAGE_CSS } from './home-page-css'
import { PUBLIC_PAGE_CSS } from './public-page-css'
import { TOKENS_CSS } from './tokens'

/**
 * The front page, and the 404 beside it.
 *
 * **A route handler's document, not an App Router page.** Part G.1 measured
 * 174KB of client runtime on a page with zero client components, and this is a
 * public path under the same 150KB ceiling as `/e/[slug]`. So it builds its own
 * `<html>` and is rendered with `renderToStaticMarkup`, exactly like
 * `check-page.tsx` and `public-page.tsx`. **Do not convert it to `page.tsx`.**
 *
 * **Unthemed.** It belongs to no ceremony, declares no `--accent`, and renders
 * indigo through the fallback (rule 2). Nothing here is archetype-keyed, which
 * is the one place in the product where that is correct.
 *
 * **Indexable, and it is the only public page that is.** Every event and
 * collection page carries `noindex` because a death in the family must not be
 * findable on Google (architecture §10). That rule is about pages that name a
 * family. This one names nobody, and a front door nobody can find is not a front
 * door — so the absence of the header here is deliberate and asserted in both
 * directions by `tests/unit/home-page.test.tsx`.
 */

function Chrome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style
          dangerouslySetInnerHTML={{ __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}${HOME_PAGE_CSS}` }}
        />
      </head>
      <body>
        <div className="page">{children}</div>
      </body>
    </html>
  )
}

/**
 * The product's own iconography, borrowed from the Ledger Strand: a solid bead
 * is money, a ringed bead with a centre bar is a thing brought — equal visual
 * mass, differing by form not prominence. Decorative and hidden from screen
 * readers; the sentence beside each says the same thing in words. Ink via
 * `currentColor`, never accent — this page has no ceremony.
 */
function BeadCash({ cx = 8, cy = 8 }: { cx?: number; cy?: number }) {
  return <circle cx={cx} cy={cy} r="5" fill="currentColor" />
}

function BeadKind({ cx = 8, cy = 8 }: { cx?: number; cy?: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x={cx - 2.5} y={cy - 0.75} width="5" height="1.5" fill="currentColor" />
    </>
  )
}

function BringGlyph() {
  return (
    <div className="cardGlyph" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16">
        <BeadCash />
      </svg>
      <svg width="16" height="16" viewBox="0 0 16 16">
        <BeadKind />
      </svg>
    </div>
  )
}

/** A short cord of mixed beads — the record, drawn rather than described. */
function CordGlyph() {
  return (
    <div className="cardGlyph" aria-hidden="true">
      <svg width="128" height="16" viewBox="0 0 128 16">
        <line x1="4" y1="8" x2="124" y2="8" stroke="currentColor" strokeWidth="1.5" />
        <BeadCash cx={12} />
        <BeadKind cx={38} />
        <BeadCash cx={64} />
        <BeadKind cx={90} />
        <BeadCash cx={116} />
      </svg>
    </div>
  )
}

/**
 * The cord that closes the ink plate — full width, drawn in paper on the ink
 * via `currentColor`, six beads alternating cash and kind. Decorative like the
 * card glyphs, and the same discipline: even spacing, fixed order, no counts.
 */
function PlateCord() {
  return (
    <div className="plateCord" aria-hidden="true">
      <svg viewBox="0 0 350 18" preserveAspectRatio="xMidYMid meet">
        <line x1="0" y1="9" x2="350" y2="9" stroke="currentColor" strokeWidth="1.5" />
        <BeadCash cx={30} cy={9} />
        <BeadKind cx={90} cy={9} />
        <BeadCash cx={150} cy={9} />
        <BeadKind cx={210} cy={9} />
        <BeadCash cx={270} cy={9} />
        <BeadKind cx={330} cy={9} />
      </svg>
    </div>
  )
}

export function HomePage() {
  return (
    <Chrome title={homeCopy.title}>
      {/*
        The ink plate: the door opens on solid ink with paper type reversed
        out, like the cover of the incwadi, and the pages below return to
        daylight. Literal --ink, never an accent — the front page belongs to
        no ceremony, and a plate that took an archetype's colour would be the
        front door wearing somebody's wedding.
      */}
      <header className="plate">
        <div className="topbar">
          <span className="wordmark">{homeCopy.title}</span>
        </div>
        <div className="plateHeader">
          <p className="plateKicker">{homeCopy.lead}</p>
          <h1 className="plateTitle">{homeCopy.headline}</h1>
          <p className="plateIntro">{homeCopy.intro}</p>
        </div>
        <PlateCord />
      </header>

      <main>
        <section className="section" aria-labelledby="start-heading">
          <h2 className="heading" id="start-heading">
            {homeCopy.start.heading}
          </h2>

          {/*
            The collection first and the umcimbi second — a deliberate reversal
            of Part D2.7's ordering, decided 6 September 2026 (UX-20 §7):
            collections are how people arrive, and the front door now leads
            with the route most first-time visitors are actually here for. The
            ceremony remains the centre of the product everywhere past this
            door.

            Both destinations sign in. `next` carries where somebody was going
            so they are not dropped at a phone-number field with no explanation
            of what they were doing (M1-09 §3) — it is an allowlisted path and
            authorises nothing, which is the test M5-02 §3 set for a value in a
            URL.
          */}
          <div className="cards">
            <article className="card">
              <h3 className="cardHeading">{homeCopy.start.collection.title}</h3>
              <p className="cardBody">{homeCopy.start.collection.body}</p>
              <a className="buttonPrimary" href="/sign-in?next=%2Fcollections%2Fnew">
                {homeCopy.start.collection.action}
              </a>
            </article>

            <article className="card">
              <h3 className="cardHeading">{homeCopy.start.event.title}</h3>
              <p className="cardBody">{homeCopy.start.event.body}</p>
              <a className="buttonSecondary" href="/sign-in?next=%2Fcreate">
                {homeCopy.start.event.action}
              </a>
            </article>
          </div>

          <p className="startNote">{homeCopy.start.signInNote}</p>
        </section>

        {/*
          The two explanations, folded to their headings (M1-09, revisited):
          the page's job is the two starts above, and somebody deciding wants
          the argument only if they ask for it. Native <details> — no script
          (rule 9), works with JavaScript disabled, and the summary is a real
          disclosure control to a screen reader. No aria-label on the section:
          the cards' own headings name this region, and an inlined label would
          be the one user-facing string outside src/copy.
        */}
        <section className="section">
          <div className="cards">
            <details className="card fold">
              <summary className="foldSummary">
                <BringGlyph />
                <h2 className="cardHeading">{homeCopy.bring.heading}</h2>
              </summary>
              <p className="cardBody foldBody">{homeCopy.bring.body}</p>
            </details>

            <details className="card fold">
              <summary className="foldSummary">
                <CordGlyph />
                <h2 className="cardHeading">{homeCopy.record.heading}</h2>
              </summary>
              <p className="cardBody foldBody">{homeCopy.record.body}</p>
            </details>
          </div>
        </section>

        <section className="trust" aria-labelledby="check-heading">
          <h2 className="heading" id="check-heading">
            {homeCopy.check.heading}
          </h2>
          <p className="intro">{homeCopy.check.body}</p>

          {/*
            Labelled with the literal address rather than "check a page", for
            the reason M3-04 §2 gives: a label that shows where it goes teaches
            the shape of the real one, which is what helps somebody recognise a
            fake later.
          */}
          <a className="checkLink" href="/check" rel="noreferrer">
            {homeCopy.check.action}
          </a>

          <p className="trustBody">{homeCopy.check.reportLead}</p>
          <a className="checkLink" href="/report" rel="noreferrer">
            {homeCopy.check.reportAction}
          </a>
          <p className="claimHelp">{homeCopy.check.reportNote}</p>
        </section>
      </main>

      <footer className="footer">
        <p className="footerText">{homeCopy.footer}</p>
      </footer>
    </Chrome>
  )
}

/**
 * The global 404 — an address that has never existed.
 *
 * Distinct from `NotFoundPage` in `public-page.tsx`, which answers about a
 * *specific* umcimbi and says the family may not have shared it yet. That
 * sentence is right there and wrong here: nothing was ever shared at an address
 * nobody issued, and telling somebody holding a forgery to go and wait is the
 * worst available answer.
 *
 * It points at `/check` and `/report` because **a link that resolves to nothing
 * is the scam case** (M3-06), and this is where somebody holding a forged link
 * lands.
 */
export function AddressNotFoundPage() {
  return (
    <Chrome title={`${homeCopy.notFound.title} · Isipheko`}>
      {/* The plain paper topbar, not the plate — this page is an answer to a
          bad address, and it should not open like a cover. */}
      <header className="topbar">
        <span className="wordmark">{homeCopy.title}</span>
      </header>
      <header className="header">
        <h1 className="title">{homeCopy.notFound.title}</h1>
        <p className="intro">{homeCopy.notFound.body}</p>
      </header>

      <main>
        <section className="trust">
          <p className="trustBody">{homeCopy.notFound.checkLead}</p>
          <a className="checkLink" href="/check" rel="noreferrer">
            {homeCopy.check.action}
          </a>

          <p className="trustBody">{homeCopy.check.reportLead}</p>
          <a className="checkLink" href="/report" rel="noreferrer">
            {homeCopy.check.reportAction}
          </a>
          <p className="claimHelp">{homeCopy.check.reportNote}</p>
        </section>

        <section className="section">
          <a className="buttonSecondary" href="/">
            {homeCopy.notFound.homeAction}
          </a>
        </section>
      </main>
    </Chrome>
  )
}
