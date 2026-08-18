/* eslint-disable @next/next/no-head-element -- see collection-page.tsx */

import { collectionCopy } from '@/copy/collection'
import type { ArchetypeConfig } from '@/domain/archetype'

import { COLLECTION_PAGE_CSS } from './collection-page-css'
import { PUBLIC_PAGE_CSS } from './public-page-css'
import { accentStyle } from './theme'
import { TOKENS_CSS } from './tokens'

/**
 * The page at the end of a handover link: one sentence and one button.
 *
 * **A witness is one of the group who is standing there** (Part D2.4), tapping
 * once on their own phone. No account, no session, nothing to sign into (rule
 * 4) — the link is the capability, and it is spent by the tap.
 *
 * The host's version of this page is the same shape and says plainly that
 * nothing depended on them: the record was already closed by the people who
 * handed it over (rule 15).
 *
 * *"Nothing moves because of this tap. It only closes the record."*
 */

export type TapKind = 'witness' | 'host'

export type TapState = 'ready' | 'done' | 'error'

export interface HandoverTapPageProps {
  readonly kind: TapKind
  readonly token: string
  readonly collectionTitle: string
  readonly organiserName: string
  readonly archetype: ArchetypeConfig
  readonly state: TapState
  readonly error?: keyof typeof collectionCopy.handover.errors | undefined
}

export function HandoverTapPage({
  kind,
  token,
  collectionTitle,
  organiserName,
  archetype,
  state,
  error,
}: HandoverTapPageProps) {
  const copy = collectionCopy.handover
  const witness = kind === 'witness'

  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${witness ? copy.witnessLead : copy.hostHeading} · Isipheko`}</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}${COLLECTION_PAGE_CSS}`,
          }}
        />
      </head>

      <body>
        <div className="page" data-archetype={archetype.key} {...accentStyle(archetype)}>
          <header className="header">
            <p className="kicker">{collectionTitle}</p>
            <h1 className="title">{witness ? copy.witnessLead : copy.hostHeading}</h1>
          </header>

          <main>
            <section className="section">
              {state === 'error' ? (
                <div className="conflict" role="alert">
                  <p className="claimedBody">{copy.errors[error ?? 'not-found']}</p>
                </div>
              ) : null}

              {state === 'ready' ? (
                <>
                  <p className="intro">
                    {witness
                      ? copy.witnessBody(collectionTitle, organiserName)
                      : copy.hostBody(collectionTitle)}
                  </p>

                  {/* A form post, so it works with no script at all — the same
                      posture as every other action in this product. */}
                  <form method="post" action={`/${witness ? 'w' : 'h'}/${token}`}>
                    <button type="submit" className="buttonPrimary">
                      {witness ? copy.witnessConfirm : copy.hostConfirm}
                    </button>
                  </form>

                  <p className="claimHelp">{witness ? copy.foot : copy.hostNote}</p>
                </>
              ) : null}

              {state === 'done' ? (
                <div className="claimed" role="status">
                  <p className="claimedTitle">
                    {witness ? copy.witnessDone : copy.hostDone}
                  </p>
                  <p className="claimedBody">
                    {witness ? copy.witnessDoneBody : copy.hostNote}
                  </p>
                </div>
              ) : null}
            </section>
          </main>
        </div>
      </body>
    </html>
  )
}
