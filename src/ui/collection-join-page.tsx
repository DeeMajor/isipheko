/* eslint-disable @next/next/no-head-element -- see collection-page.tsx */

import { collectionCopy } from '@/copy/collection'
import type { ArchetypeConfig } from '@/domain/archetype'

import { COLLECTION_PAGE_CSS } from './collection-page-css'
import { PUBLIC_PAGE_CSS } from './public-page-css'
import { accentStyle } from './theme'
import { TOKENS_CSS } from './tokens'

/**
 * Joining a collection: three screens of forms, and the contribution flow's
 * shape without its money.
 *
 * **No account, no login, no email field** — anywhere, on any step (rule 4).
 * Somebody arrives from a WhatsApp group, puts their name and an amount on a
 * list, and leaves. State moves in hidden fields, so there is nothing to expire
 * and the back button works.
 *
 * **There is no payment step, because there is no payment rail.** The last
 * screen says where to send it — her own account, in her own words — and the
 * button says "I've sent it", which is a claim about the world rather than an
 * instruction to us. We never touch the money (rule 12), and the copy on that
 * screen says so before anybody sends anything.
 */

export type JoinStep = 'amount' | 'who' | 'hand' | 'done'

export const JOIN_STEPS: readonly JoinStep[] = ['amount', 'who', 'hand', 'done']

export function isJoinStep(value: string): value is JoinStep {
  return (JOIN_STEPS as readonly string[]).includes(value)
}

export function nextJoinStep(step: JoinStep): JoinStep | null {
  const index = JOIN_STEPS.indexOf(step)

  return index === -1 || index === JOIN_STEPS.length - 1
    ? null
    : (JOIN_STEPS[index + 1] ?? null)
}

export interface CollectionJoinPageProps {
  readonly slug: string
  readonly collectionTitle: string
  readonly organiserName: string
  /** Free text, in her words. Never an account we hold or could pay into. */
  readonly bankHint: string | null
  readonly archetype: ArchetypeConfig
  readonly step: JoinStep
  readonly carried: Readonly<Record<string, string>>
  readonly error?: keyof typeof collectionCopy.join.errors | undefined
}

function Hidden({
  carried,
  except,
}: {
  carried: Readonly<Record<string, string>>
  except?: string
}) {
  return (
    <>
      {Object.entries(carried)
        .filter(([key, value]) => key !== except && value !== '')
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
    </>
  )
}

export function CollectionJoinPage({
  slug,
  collectionTitle,
  organiserName,
  bankHint,
  archetype,
  step,
  carried,
  error,
}: CollectionJoinPageProps) {
  const copy = collectionCopy.join

  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${copy.title} · Isipheko`}</title>
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
            <h1 className="title">{copy.title}</h1>
          </header>

          <main>
            <section className="section">
              {error === undefined ? null : (
                <div className="conflict" role="alert">
                  <p className="claimedBody">{copy.errors[error]}</p>
                </div>
              )}

              {step === 'amount' ? (
                <form method="post" action={`/c/${slug}/join`} className="claimForm">
                  <Hidden carried={carried} except="amount" />
                  <input type="hidden" name="step" value="amount" />

                  <label className="claimLabel" htmlFor="amount">
                    {copy.amountLabel}
                  </label>
                  <input
                    className="claimInput"
                    id="amount"
                    name="amount"
                    inputMode="decimal"
                    placeholder={copy.amountPlaceholder}
                    defaultValue={carried.amount ?? ''}
                    data-numeric=""
                    required
                  />
                  <p className="claimHelp">{copy.amountHelp}</p>

                  <button type="submit" className="buttonPrimary">
                    {copy.continue}
                  </button>
                </form>
              ) : null}

              {step === 'who' ? (
                <form method="post" action={`/c/${slug}/join`} className="claimForm">
                  <Hidden carried={carried} except="name" />
                  <input type="hidden" name="step" value="who" />

                  <label className="claimLabel" htmlFor="name">
                    {copy.nameLabel}
                  </label>
                  <input
                    className="claimInput"
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    defaultValue={carried.name ?? ''}
                    required
                  />
                  <p className="claimHelp">{copy.nameHelp}</p>

                  <label className="claimLabel" htmlFor="phone">
                    {copy.phoneLabel}
                  </label>
                  <input
                    className="claimInput"
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    defaultValue={carried.phone ?? ''}
                    data-numeric=""
                  />
                  <p className="claimHelp">{copy.phoneHelp}</p>

                  {/*
                    Quiet from the wider world, not from the group: the amount
                    stays in the list either way, because the total has to add
                    up for the people who put it there.
                  */}
                  <label className="claimLabel" htmlFor="named">
                    {copy.quietlyLabel}
                  </label>
                  <input
                    type="checkbox"
                    id="named"
                    name="named"
                    value="yes"
                    defaultChecked={carried.named !== 'no'}
                  />
                  <p className="claimHelp">{copy.quietlyHelp}</p>

                  <button type="submit" className="buttonPrimary">
                    {copy.continue}
                  </button>
                </form>
              ) : null}

              {step === 'hand' ? (
                bankHint === null || bankHint === '' ? (
                  <>
                    {/*
                      Nowhere to send it, so no "I've sent it" (UX-17). The
                      button used to render under the refusal, and a member
                      could claim to have sent money the screen had just said
                      it could not point anywhere — a roster row about a
                      payment that had no destination. The same posture as the
                      pay step's `noNumberBody` (M2-05 §1): a blank where a
                      payment destination belongs is how somebody pays the
                      wrong person, and a claim over that blank is worse.
                    */}
                    <h2 className="heading">{copy.handTitle(organiserName)}</h2>
                    <div className="conflict" role="alert">
                      <p className="claimedBody">{copy.handMissing}</p>
                    </div>
                    <form method="get" action={`/c/${slug}`} className="claimForm">
                      <button type="submit" className="buttonQuiet">
                        {copy.back}
                      </button>
                    </form>
                  </>
                ) : (
                  <form method="post" action={`/c/${slug}/join`} className="claimForm">
                    <Hidden carried={carried} />
                    <input type="hidden" name="step" value="hand" />

                    <h2 className="heading">{copy.handTitle(organiserName)}</h2>
                    <p className="intro">{copy.handBody(organiserName)}</p>

                    <div className="custody">
                      {/* Her words, free text, and never an account we could
                          pay into — the moment it is one, rule 12 is gone. */}
                      <p className="custodyTitle" data-numeric="">
                        {bankHint}
                      </p>
                    </div>

                    <button type="submit" className="buttonPrimary">
                      {copy.submit}
                    </button>
                  </form>
                )
              ) : null}

              {step === 'done' ? (
                <>
                  <h2 className="heading">{copy.doneTitle}</h2>
                  <p className="intro">{copy.doneBody(organiserName)}</p>
                  <form method="get" action={`/c/${slug}`} className="claimForm">
                    <button type="submit" className="buttonQuiet">
                      {copy.back}
                    </button>
                  </form>
                </>
              ) : null}
            </section>
          </main>
        </div>
      </body>
    </html>
  )
}
