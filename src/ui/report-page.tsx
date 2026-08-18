/* eslint-disable @next/next/no-head-element -- see collection-page.tsx */

import { reportCopy } from '@/copy/report'
import { REPORT_REASONS, type ReportRejection } from '@/domain/report'

import { PUBLIC_PAGE_CSS } from './public-page-css'
import { TOKENS_CSS } from './tokens'

/**
 * The report form, and what somebody sees after sending one.
 *
 * **Unthemed, like `/check`** — this is not the umcimbi's page and must not
 * wear its colours. Somebody may be reporting the very page whose accent it
 * would be borrowing.
 *
 * No account, no script, nothing required but a reason and something to go on.
 * The number is optional and the screen says what happens when it is blank,
 * because the alternative is somebody waiting for a message that was never
 * going to come.
 */

export type ReportState = 'asking' | 'filed'

export interface ReportPageProps {
  readonly state: ReportState
  /** What is being reported, when we know. */
  readonly aboutTitle?: string | undefined
  /** Carried through the post so the record knows what it is about. */
  readonly eventSlug?: string | undefined
  readonly collectionSlug?: string | undefined
  readonly problem?: ReportRejection | undefined
  readonly reference?: string | undefined
  readonly respondBy?: string | undefined
  readonly reachable?: boolean | undefined
}

export function ReportPage({
  state,
  aboutTitle,
  eventSlug,
  collectionSlug,
  problem,
  reference,
  respondBy,
  reachable,
}: ReportPageProps) {
  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${reportCopy.title} · Isipheko`}</title>
        <style dangerouslySetInnerHTML={{ __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}` }} />
      </head>

      <body>
        <div className="page">
          <header className="header">
            <p className="kicker">Isipheko</p>
            <h1 className="title">
              {state === 'filed' ? reportCopy.filed.heading : reportCopy.title}
            </h1>
            {state === 'asking' ? <p className="when">{reportCopy.lead}</p> : null}
          </header>

          <main>
            {state === 'filed' ? (
              <section className="section">
                <div className="claimed" role="status">
                  <p className="claimedTitle" data-numeric="">
                    {reportCopy.filed.reference(reference ?? '')}
                  </p>
                  <p className="claimedBody">{reportCopy.filed.keep}</p>
                  <p className="claimedBody">{reportCopy.filed.when(respondBy ?? '')}</p>
                  <p className="claimedBody">
                    {reachable === true
                      ? reportCopy.filed.reachable
                      : reportCopy.filed.unreachable}
                  </p>
                </div>

                {/*
                  Said here because somebody who has just reported a page will
                  otherwise go back, find it unchanged, and conclude that nothing
                  happened. Nothing did happen to the page — deliberately.
                */}
                <p className="claimHelp">{reportCopy.filed.whatHappens}</p>
                <p className="claimHelp">{reportCopy.filed.thanks}</p>
              </section>
            ) : (
              <section className="section">
                {problem === undefined ? null : (
                  <div className="conflict" role="alert">
                    <p className="claimedBody">{reportCopy.problems[problem]}</p>
                  </div>
                )}

                <form method="post" action="/report" className="claimForm">
                  {eventSlug === undefined ? null : (
                    <input type="hidden" name="event" value={eventSlug} />
                  )}
                  {collectionSlug === undefined ? null : (
                    <input type="hidden" name="collection" value={collectionSlug} />
                  )}

                  <h2 className="trustHeading">{reportCopy.aboutHeading}</h2>
                  {aboutTitle === undefined ? (
                    <div className="claimQuantity">
                      <p className="claimHelp">{reportCopy.aboutUnknown}</p>
                      <label className="claimLabel" htmlFor="about">
                        {reportCopy.aboutLabel}
                      </label>
                      <input
                        className="claimInput"
                        id="about"
                        name="about"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  ) : (
                    <p className="claimHelp">{reportCopy.aboutKnown(aboutTitle)}</p>
                  )}

                  <h2 className="trustHeading">{reportCopy.reasonHeading}</h2>
                  {/*
                    Radios rather than a select: every option visible at once, no
                    default chosen, and it works on any browser that has ever
                    existed. Somebody upset should not have to open a menu to
                    find the sentence that describes what happened to them.
                  */}
                  <fieldset className="reasons">
                    <legend className="claimLabel">{reportCopy.reasonHeading}</legend>
                    {REPORT_REASONS.map((reason) => (
                      <label className="reason" key={reason} htmlFor={`reason-${reason}`}>
                        <input
                          type="radio"
                          id={`reason-${reason}`}
                          name="reason"
                          value={reason}
                        />
                        <span>{reportCopy.reasons[reason]}</span>
                      </label>
                    ))}
                  </fieldset>

                  <div className="claimQuantity">
                    <label className="claimLabel" htmlFor="detail">
                      {reportCopy.detailLabel}
                    </label>
                    <textarea className="claimInput" id="detail" name="detail" rows={4} />
                    <p className="claimHelp">{reportCopy.detailHelp}</p>
                  </div>

                  <div className="claimQuantity">
                    <label className="claimLabel" htmlFor="phone">
                      {reportCopy.phoneLabel}
                    </label>
                    <input
                      className="claimInput"
                      id="phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      data-numeric=""
                    />
                    <p className="claimHelp">{reportCopy.phoneHelp}</p>
                    <p className="claimHelp">{reportCopy.phoneNone}</p>
                  </div>

                  <button type="submit" className="buttonPrimary">
                    {reportCopy.submit}
                  </button>
                </form>
              </section>
            )}
          </main>
        </div>
      </body>
    </html>
  )
}
