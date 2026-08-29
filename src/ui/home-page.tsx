/* eslint-disable @next/next/no-head-element -- see collection-page.tsx */

import { homeCopy } from '@/copy/home'

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
        <style dangerouslySetInnerHTML={{ __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}` }} />
      </head>
      <body>
        <div className="page">{children}</div>
      </body>
    </html>
  )
}

export function HomePage() {
  return (
    <Chrome title={homeCopy.title}>
      <header className="header">
        <h1 className="title">{homeCopy.title}</h1>
        <p className="when">{homeCopy.lead}</p>
        <p className="intro">{homeCopy.intro}</p>
      </header>

      <main>
        <section className="section" aria-labelledby="bring-heading">
          <h2 className="heading" id="bring-heading">
            {homeCopy.bring.heading}
          </h2>
          <p className="intro">{homeCopy.bring.body}</p>
        </section>

        <section className="section" aria-labelledby="record-heading">
          <h2 className="heading" id="record-heading">
            {homeCopy.record.heading}
          </h2>
          <p className="intro">{homeCopy.record.body}</p>
        </section>

        <section className="section" aria-labelledby="start-heading">
          <h2 className="heading" id="start-heading">
            {homeCopy.start.heading}
          </h2>

          {/*
            The umcimbi first and the collection second, and the order is a
            decision rather than a layout: Part D2.7 says collections are how
            people arrive and the ceremony is why they stay, so leading with the
            group pot would position this as the undifferentiated thing it is
            not.

            Both destinations sign in. `next` carries where somebody was going
            so they are not dropped at a phone-number field with no explanation
            of what they were doing (M1-09 §3) — it is an allowlisted path and
            authorises nothing, which is the test M5-02 §3 set for a value in a
            URL.
          */}
          <div className="trustBlock">
            <h3 className="trustHeading">{homeCopy.start.event.title}</h3>
            <p className="trustBody">{homeCopy.start.event.body}</p>
            <a className="buttonPrimary" href="/sign-in?next=%2Fcreate">
              {homeCopy.start.event.action}
            </a>
          </div>

          <div className="trustBlock">
            <h3 className="trustHeading">{homeCopy.start.collection.title}</h3>
            <p className="trustBody">{homeCopy.start.collection.body}</p>
            <a className="buttonSecondary" href="/sign-in?next=%2Fcollections%2Fnew">
              {homeCopy.start.collection.action}
            </a>
          </div>

          <p className="claimHelp">{homeCopy.start.signInNote}</p>
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
