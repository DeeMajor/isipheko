/* eslint-disable @next/next/no-head-element -- see collection-page.tsx */

import { checkCopy } from '@/copy/check'
import { reportCopy } from '@/copy/report'
import type { CheckResult } from '@/db/repositories/check'

import { PUBLIC_PAGE_CSS } from './public-page-css'
import { TOKENS_CSS } from './tokens'

/**
 * The independent verification route.
 *
 * **Unthemed on purpose.** Every other public page takes the archetype's accent;
 * this one does not, because it is not the umcimbi's page and must not look like
 * it. Somebody who typed this address is asking a question *about* a page, and
 * an answer wearing that page's colours would be the answer dressing up as the
 * thing it is checking. `var(--accent, #16233D)` renders indigo with nothing
 * declared, which is exactly right here (rule 2).
 *
 * No script, one form field, and **no link to the umcimbi**. The answer stands
 * on its own or it is not an independent answer.
 */

export type CheckState = 'asking' | 'found' | 'not-found' | 'too-many'

export interface CheckPageProps {
  readonly state: CheckState
  readonly typed?: string | undefined
  readonly result?: CheckResult | undefined
  readonly verifiedOn?: string | undefined
}

export function CheckPage({ state, typed, result, verifiedOn }: CheckPageProps) {
  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Not indexed, like everything else that names a family (§10). */}
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${checkCopy.title} · Isipheko`}</title>
        <style dangerouslySetInnerHTML={{ __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}` }} />
      </head>

      <body>
        <div className="page">
          <header className="header">
            <p className="kicker">Isipheko</p>
            <h1 className="title">{checkCopy.title}</h1>
            <p className="when">{checkCopy.lead}</p>
          </header>

          <main>
            <section className="section">
              {/*
                A GET form, so the answer has a URL somebody can read, re-open
                and compare — and so the whole thing works with no script.
              */}
              <form method="get" action="/check" className="claimForm">
                <div className="claimQuantity">
                  <label className="claimLabel" htmlFor="code">
                    {checkCopy.field.label}
                  </label>
                  <input
                    className="claimInput"
                    id="code"
                    name="code"
                    defaultValue={typed ?? ''}
                    autoComplete="off"
                    spellCheck={false}
                    data-numeric=""
                  />
                  <p className="claimHelp">{checkCopy.field.help}</p>
                </div>

                <button type="submit" className="buttonPrimary">
                  {checkCopy.submit}
                </button>
              </form>
            </section>

            {state === 'too-many' ? (
              <section className="section">
                <div className="conflict" role="alert">
                  <p className="claimedTitle">{checkCopy.tooMany.heading}</p>
                  <p className="claimedBody">{checkCopy.tooMany.body}</p>
                </div>
              </section>
            ) : null}

            {state === 'not-found' ? (
              <section className="section">
                {/*
                  Not `role="alert"`: somebody mistyping a code has not done
                  anything alarming, and the answer for a page nobody has shared
                  yet is the same one. It is information, not a warning.
                */}
                <div className="claimed">
                  <p className="claimedTitle">{checkCopy.notFound.heading}</p>
                  <p className="claimedBody">{checkCopy.notFound.body}</p>
                  <p className="claimedBody">{checkCopy.notFound.orNotShared}</p>
                  {/*
                    The most valuable report there is (M3-06): a link that
                    resolves to nothing is the scam case, and this is the moment
                    somebody has just discovered it. No slug goes with it —
                    there is nothing of ours to name.
                  */}
                  <p className="claimedBody">{checkCopy.notFound.tellUs}</p>
                  <a className="checkLink" href="/report" rel="noreferrer">
                    {reportCopy.linkLabel}
                  </a>
                </div>
              </section>
            ) : null}

            {state === 'found' && result !== undefined ? (
              <section className="section">
                <div className="claimed" role="status">
                  <p className="claimedTitle">{checkCopy.found.heading}</p>

                  <p className="claimedBody" data-numeric="">
                    {result.title}
                  </p>

                  {/*
                    True or absent, never softened (M1-08 §5) — on the page whose
                    entire subject is what is true.
                  */}
                  <p className="claimedBody">
                    {result.organiserName === null
                      ? checkCopy.found.noName
                      : result.verifiedAt !== null && verifiedOn !== undefined
                        ? checkCopy.found.verified(result.organiserName, verifiedOn)
                        : checkCopy.found.unverified(result.organiserName)}
                  </p>

                  <p className="claimedBody">{checkCopy.found.limit}</p>
                  <p className="claimedBody">{checkCopy.found.stillAsk}</p>
                </div>
              </section>
            ) : null}

            <section className="section">
              <p className="claimHelp">{checkCopy.foot}</p>
            </section>
          </main>
        </div>
      </body>
    </html>
  )
}
