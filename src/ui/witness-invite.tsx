/* eslint-disable @next/next/no-head-element -- see collection-page.tsx */

import { witnessCopy } from '@/copy/witness'
import type { ArchetypeConfig } from '@/domain/archetype'
import type { InviteRejection } from '@/domain/witness'

import { COLLECTION_PAGE_CSS } from './collection-page-css'
import { PUBLIC_PAGE_CSS } from './public-page-css'
import { accentStyle } from './theme'
import { TOKENS_CSS } from './tokens'

/**
 * The page at the end of an invite link: one question and two answers.
 *
 * **Being asked is a compliment, not an audit.** The question is the design's
 * own sentence, and the page carries the weight of it — *"not a small thing"* —
 * rather than treating the person as a control to be satisfied.
 *
 * No account, no session, nothing to sign into (rule 4). The link is the
 * capability, and it is spent by the answer, not by reading the page. Zero
 * JavaScript: two form posts, like every other decision on a public route.
 *
 * Declining is a full-width answer beside accepting, not a small grey escape.
 * A page that makes "no" hard to find is a page collecting agreements rather
 * than asking a question.
 */

export type InviteState = 'ready' | 'accepted' | 'declined' | 'problem' | 'not-found'

export interface WitnessInvitePageProps {
  readonly state: InviteState
  readonly token: string
  readonly witnessName: string
  readonly eventTitle: string
  readonly organiserName: string
  readonly archetype: ArchetypeConfig
  readonly problem?: InviteRejection | undefined
}

export function WitnessInvitePage({
  state,
  token,
  witnessName,
  eventTitle,
  organiserName,
  archetype,
  problem,
}: WitnessInvitePageProps) {
  const copy = witnessCopy

  const title =
    state === 'accepted'
      ? copy.accepted.title
      : state === 'declined'
        ? copy.declined.title
        : state === 'not-found'
          ? copy.notFound.title
          : state === 'problem'
            ? copy.invite.kicker
            : copy.invite.kicker

  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${title} · Isipheko`}</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}${COLLECTION_PAGE_CSS}`,
          }}
        />
      </head>

      <body>
        <div className="page" data-archetype={archetype.key} {...accentStyle(archetype)}>
          <header className="header">
            {state === 'ready' ? <p className="kicker">{copy.invite.kicker}</p> : null}
            <h1 className="title">{state === 'ready' ? eventTitle : title}</h1>
            {state === 'ready' && witnessName !== '' ? (
              <p className="organiser">{witnessName}</p>
            ) : null}
          </header>

          <main>
            <section className="section">
              {state === 'not-found' ? (
                <p className="intro">{copy.notFound.body}</p>
              ) : null}

              {/* A dead link says so and shows nothing about the family. */}
              {state === 'problem' ? (
                <div className="conflict" role="alert">
                  <p className="claimedBody">{copy.problems[problem ?? 'withdrawn']}</p>
                </div>
              ) : null}

              {state === 'ready' ? (
                <>
                  <p className="intro">
                    {copy.invite.question(organiserName, archetype.kicker, eventTitle)}
                  </p>
                  <p className="claimHelp">{copy.invite.weight}</p>
                  <p className="claimHelp">{copy.invite.meaning}</p>

                  {/*
                    Two posts to the same URL, distinguished by the button's
                    value. No script, and no default: neither answer is
                    pre-selected and neither is harder to reach than the other.
                  */}
                  <form method="post" action={`/k/${token}`} className="claimForm">
                    <button
                      type="submit"
                      name="answer"
                      value="accept"
                      className="buttonPrimary"
                    >
                      {copy.invite.accept}
                    </button>
                    <button
                      type="submit"
                      name="answer"
                      value="decline"
                      className="buttonSecondary"
                    >
                      {copy.invite.decline}
                    </button>
                  </form>

                  <p className="claimHelp">{copy.invite.noAccount}</p>
                </>
              ) : null}

              {/* The heading above already says which answer this is, so the
                  panel carries only what follows from it — repeating it would
                  be two elements saying one sentence, which is also two things
                  a screen reader reads out. */}
              {state === 'accepted' ? (
                <div className="claimed" role="status">
                  <p className="claimedBody">{copy.accepted.body(organiserName)}</p>
                  <p className="claimedBody">{copy.accepted.note}</p>
                </div>
              ) : null}

              {state === 'declined' ? (
                <div className="claimed" role="status">
                  <p className="claimedBody">{copy.declined.body}</p>
                </div>
              ) : null}
            </section>
          </main>
        </div>
      </body>
    </html>
  )
}
