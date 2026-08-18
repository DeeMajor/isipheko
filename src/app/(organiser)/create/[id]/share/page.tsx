import type { Metadata } from 'next'

import { prisma } from '@/db/client'
import { eventCardBySlug } from '@/db/repositories/event'
import { archetypeSetupCopy, setupCopy } from '@/copy/setup'
import { archetypeShareCopy, shareCopy } from '@/copy/share'
import { smsUrl, whatsappUrl } from '@/domain/share'
import { env } from '@/lib/env'
import { cardFacts, cardMeta } from '@/lib/event-card'
import { Button, Toast } from '@/ui/primitives'

import { publish } from '../../actions'
import { SetupShell } from '../../setup-shell'
import { loadDraft } from '../draft'

import styles from '../../setup.module.css'

/**
 * Step six: publish, then the link.
 *
 * Publishing is the only thing on this page that changes anything, and it is a
 * conditional update scoped to the organiser and to the draft state — two taps
 * on a slow connection publish once.
 *
 * The link is not shown before publishing. A draft URL that worked would be
 * shared by somebody the moment they saw it.
 *
 * **The chat preview is drawn from the same facts as the card** (M2-07). It is
 * a mock rather than the PNG itself: the organiser is being shown how their
 * name will read at the size their relatives see, and fetching a 53KB image to
 * demonstrate that would be beside the point. The mock and the card share their
 * copy and their meta line, so the two cannot say different things.
 */

export const metadata: Metadata = {
  title: 'Send it · Isipheko',
  robots: { index: false, follow: false },
}

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; published?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const { draft, archetype } = await loadDraft(id)

  const url = `${env.NEXT_PUBLIC_APP_URL}/e/${draft.slug}`
  const blocker =
    error !== undefined && error in setupCopy.blockers
      ? setupCopy.blockers[error as keyof typeof setupCopy.blockers]
      : undefined

  // Only exists once published — a draft has no public page and therefore no
  // card. Null before that, and the branch below never asks for one.
  const card = draft.isPublished ? await eventCardBySlug(prisma, draft.slug) : null
  const message = archetypeShareCopy[draft.archetype].message(draft.title)
  // The same facts the card is hashed and drawn from, so the mock cannot show
  // the organiser something the picture does not say.
  const facts = card === null ? null : cardFacts(archetype, card)

  return (
    <SetupShell
      step="share"
      archetype={archetype}
      crumb={archetypeSetupCopy[archetype.key].zulu}
    >
      <h1 className={styles.title}>{setupCopy.share.title}</h1>
      {/* The verified wording, which M1-08 §5 refused when nothing was checked.
          An event cannot be published unverified since M3-02, so by the time
          this page has a link to show, the sentence is true. */}
      <p className={styles.intro}>
        {draft.organiserVerified ? shareCopy.introVerified : shareCopy.intro}
      </p>

      {blocker === undefined ? null : (
        <div className={styles.form}>
          <Toast tone="problem">{blocker}</Toast>
        </div>
      )}

      {draft.isPublished ? (
        <>
          <div className={styles.sendButtons}>
            {/* Plain links. `wa.me` opens the app when it is installed and the
                web client when it is not, and neither needs a byte of script. */}
            <a className={styles.sendPrimary} href={whatsappUrl(message, url)}>
              {shareCopy.whatsapp}
            </a>
            <a className={styles.sendSecondary} href={smsUrl(message, url)}>
              {shareCopy.sms}
            </a>
          </div>

          <p className={styles.hint}>{shareCopy.linkLabel}</p>
          <div className={styles.copyRow} data-copy-row="">
            <input
              className={styles.copyInput}
              value={url}
              readOnly
              aria-label={shareCopy.linkLabel}
              data-copy-source=""
            />
            {/*
              A real button, hidden by the browsers that cannot use it.

              A copy button that does nothing without JavaScript is worse than
              no button — the URL is right there and selectable either way. The
              two obvious fixes are both wrong: unhiding it from a script is a
              hydration mismatch, because React rendered one thing and finds
              another, and writing it in from a script is the same mismatch one
              level down. `<noscript>` is parsed only when scripting is off, so
              the stylesheet inside it hides the button exactly there, nothing
              mutates the DOM, and the markup React rendered is the markup it
              hydrates.
            */}
            <noscript>
              <style>{'[data-copy-button]{display:none}'}</style>
            </noscript>
            <button
              type="button"
              className={styles.sendSecondary}
              data-copy-button=""
              data-copy-label={shareCopy.copy}
              data-copied-label={shareCopy.copied}
            >
              {shareCopy.copy}
            </button>
          </div>

          <form action={`/e/${draft.slug}`}>
            <Button type="submit" variant="secondary">
              {setupCopy.share.view}
            </Button>
          </form>

          <div className={styles.panel}>
            <p className={styles.panelTitle}>{shareCopy.previewTitle}</p>
            <p className={styles.panelBody}>{shareCopy.previewIntro}</p>

            <div className={styles.chat}>
              <div className={styles.bubble}>
                <div className={styles.previewCard}>
                  <div className={styles.previewBanner}>
                    <span className={styles.previewBead} />
                    <span className={styles.previewWordmark}>
                      {shareCopy.card.wordmark}
                    </span>
                  </div>
                  <div className={styles.previewBody}>
                    <p className={styles.previewTitle}>{draft.title}</p>
                    {card?.organiserName == null ? null : (
                      <p className={styles.previewOrganiser}>
                        {/* Read from the card's own facts rather than decided
                            again here, so the mock cannot show a tick the
                            picture does not draw. */}
                        {facts?.verified === true
                          ? shareCopy.card.organiserVerified(card.organiserName)
                          : shareCopy.card.organiser(card.organiserName)}
                      </p>
                    )}
                    <p className={styles.previewMeta} data-numeric="">
                      {card === null ? '' : cardMeta(archetype, card)}
                    </p>
                    <p className={styles.previewHost}>{shareCopy.card.host}</p>
                  </div>
                </div>
                <p className={styles.previewMessage}>{message}</p>
              </div>
            </div>

            <div className={styles.thumbRow}>
              <div className={styles.thumb}>
                <div className={styles.thumbBanner}>
                  <span className={styles.thumbBead} />
                </div>
                <div className={styles.thumbBody}>
                  <p className={styles.thumbTitle}>{draft.title}</p>
                  {card?.organiserName == null ? null : (
                    <p className={styles.thumbOrganiser}>{card.organiserName}</p>
                  )}
                </div>
              </div>
              <p className={styles.thumbNote}>{shareCopy.thumbnailNote}</p>
            </div>

            <p className={styles.hint}>{shareCopy.badgeCarried}</p>
          </div>
        </>
      ) : (
        <>
          <form action={publish} className={styles.form}>
            <input type="hidden" name="id" value={draft.id} />
            <Button type="submit">{setupCopy.share.publish}</Button>
          </form>

          {draft.organiserVerified ? null : (
            <>
              {/*
                The question, answered where it is asked.

                A native `<details>` — no JavaScript, and she does not have to
                leave a screen she is mid-flow on to find out why. The public
                page keeps its single posture of server round-trips (M2-06 §3);
                an organiser screen is a different context and may use a
                disclosure. See docs/decisions.md M3-02.

                The answer is `verify.why`, which is the design's own copy and
                explains the reason rather than demanding compliance.
              */}
              <details className={styles.disclosure}>
                <summary className={styles.summary}>{setupCopy.whyNotSkip}</summary>
                {setupCopy.verify.why.map((reason) => (
                  <p key={reason.slice(0, 24)} className={styles.panelBody}>
                    {reason}
                  </p>
                ))}
                <p className={styles.panelBody}>{setupCopy.verify.whyClose}</p>
              </details>

              <form method="get" action="/verify" className={styles.form}>
                <input
                  type="hidden"
                  name="returnTo"
                  value={`/create/${draft.id}/share`}
                />
                <Button type="submit" variant="secondary">
                  {setupCopy.verifyNow}
                </Button>
              </form>
            </>
          )}

          <p className={styles.foot}>{setupCopy.share.draftNote}</p>
        </>
      )}
    </SetupShell>
  )
}
