/* eslint-disable @next/next/no-head-element --
 * Like the event page, this file *is* the document: rendered with
 * renderToStaticMarkup and served from a route handler, because an App Router
 * page would put 174KB of framework back on the path a stranger walks on a
 * prepaid bundle (docs/decisions.md M1-08).
 */

import { contributeCopy } from '@/copy/contribute'
import { eventCopy } from '@/copy/event'
import type { ArchetypeConfig } from '@/domain/archetype'
import type {
  ContributionRoute,
  ContributionStep,
  PaymentMode,
  Visibility,
} from '@/domain/contribution'
import {
  canReachPayStep,
  requiresPayment,
  stepNumber,
  stepsFor,
} from '@/domain/contribution'
import { formatMoney } from '@/domain/money'
import type { Money } from '@/domain/money'

import { PUBLIC_PAGE_CSS } from './public-page-css'
import { accentStyle } from './theme'
import { TOKENS_CSS } from './tokens'

/**
 * The contribution flow, as five screens of forms.
 *
 * No account, no login, no email field — anywhere, on any step. A contributor
 * arrives from a WhatsApp link, possibly on a borrowed phone, and leaves
 * without having been asked to become anything (CLAUDE.md rule 4). An E2E test
 * asserts there is no password, email or signup input in the whole flow.
 *
 * State moves between steps in hidden fields rather than a session: nothing to
 * expire, nothing to clean up, and the back button works.
 */

export interface ContributePageProps {
  readonly slug: string
  readonly eventTitle: string
  readonly organiserName: string | null
  readonly archetype: ArchetypeConfig
  readonly route: ContributionRoute
  readonly step: ContributionStep
  readonly amountsPublic: boolean
  readonly carried: Readonly<Record<string, string>>
  readonly needs: readonly { id: string; label: string; remaining: number }[]
  readonly amount?: Money | undefined
  readonly reference?: string | undefined
  readonly payDetails?: { phone: string; name: string } | null | undefined
  /**
   * How this event takes money (M5-02). `ledger_only` shows the organiser's
   * number and takes the contributor's word; `hosted` sends them to a checkout.
   */
  readonly mode: PaymentMode
  /**
   * Where a hosted payment settles. Opaque, and the page never renders it —
   * it is here only so the pay step can refuse honestly when there is nowhere
   * for the money to go.
   */
  readonly beneficiary?: string | null | undefined
  /**
   * Whether the payment has been confirmed by the time the done step renders.
   * `undefined` on the ledger-only path, where nothing is confirmed yet by
   * construction.
   */
  readonly paymentConfirmed?: boolean | undefined
  readonly defaultVisibility: Visibility
  readonly error?: keyof typeof contributeCopy.errors | undefined
  /** The organiser's verification date, so the badge follows them (M3-04). */
  readonly verifiedOn?: string | undefined
  /**
   * The 32 hex characters a stored photo is served under, if one is attached.
   *
   * Derived from the carried ticket rather than read out of it here — the ticket
   * carries a signature, and a signature has no business in markup.
   */
  readonly photoDigest?: string | undefined
  /** What they chose on the who step, so the done step can be honest about it. */
  readonly visibility?: Visibility | undefined
}

/**
 * `<picture>`: AVIF first, WebP as the `<img>` itself.
 *
 * The choice is made by the markup, so each URL names exactly one
 * representation and no cache has to understand `Vary` to get it right. Both
 * were produced by the same stripping pipeline — there is no path by which one
 * of the two still carries the location.
 */
function Photo({
  slug,
  digest,
  size,
  className,
}: {
  slug: string
  digest: string
  size: 'full' | 'thumb'
  className: string
}) {
  const base = `/e/${encodeURIComponent(slug)}/photo/${digest}-${size}`

  return (
    <picture>
      <source srcSet={`${base}.avif`} type="image/avif" />
      <img
        className={className}
        src={`${base}.webp`}
        alt=""
        loading="lazy"
        decoding="async"
      />
    </picture>
  )
}

function Shell({
  title,
  archetype,
  step,
  route,
  eventTitle,
  organiserName,
  verifiedOn,
  children,
}: {
  title: string
  archetype: ArchetypeConfig
  step: ContributionStep
  route: ContributionRoute
  eventTitle: string
  organiserName: string | null
  verifiedOn?: string | undefined
  children: React.ReactNode
}) {
  const steps = stepsFor(route)
  const index = stepNumber(route, step)

  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${title} · Isipheko`}</title>
        <style dangerouslySetInnerHTML={{ __html: `${TOKENS_CSS}${PUBLIC_PAGE_CSS}` }} />
        <script src="/needs-board.js" defer />
      </head>
      <body>
        <div className="page" data-archetype={archetype.key} {...accentStyle(archetype)}>
          <header className="header">
            <p className="kicker">{eventTitle}</p>
            {organiserName === null ? null : (
              <p className="organiser">{`Organised by ${organiserName}`}</p>
            )}
            {/*
              The badge follows them into the flow (M3-04). It was absent here
              with a comment saying nothing had been checked — true at M2-05,
              false since M3-02, and this is the screen where it counts most.
            */}
            {verifiedOn === undefined ? null : (
              <p className="verified">
                <span className="verifiedTick" aria-hidden="true">
                  ✓
                </span>
                <span data-numeric="">{eventCopy.organiser.badge(verifiedOn)}</span>
              </p>
            )}
            <p className="needStatus" data-numeric="">
              {step === 'done'
                ? 'Done'
                : `Step ${String(index)} of ${String(steps.length)}`}
            </p>
          </header>

          <main className="section">{children}</main>

          {/*
            The panel travels with them (M3-04).

            The full "Is this real?" panel is on the event page, and somebody in
            the middle of contributing has navigated away from it — which is
            exactly the moment they are looking at a phone number they are about
            to send money to. So the two sentences that matter most come along:
            do not use a number on this page, and type the address yourself.

            **Not styled as a warning**: paper, ink, no error colour and no
            alert role. It is a permanent part of the page rather than an alarm
            that has gone off, which is the whole posture of the panel it comes
            from.
          */}
          <aside className="stillReal" aria-labelledby="still-real">
            <p className="trustHeading" id="still-real">
              {eventCopy.safety.stillReal}
            </p>
            <p className="trustBody">{eventCopy.safety.stillRealBody}</p>
            <a className="checkLink" href="/check" rel="noreferrer">
              {eventCopy.trust.yourselfCheckLink}
            </a>
            <p className="trustBody">{eventCopy.safety.line}</p>
          </aside>
        </div>
      </body>
    </html>
  )
}

/**
 * The flow's state, as hidden fields.
 *
 * `except` is not decoration. A field rendered hidden *and* visible on the same
 * form is sent twice, and `FormData.get` returns the first — so the stale copy
 * wins and an edit is silently dropped. The who step shows name, number and
 * message as inputs, so it must not also carry them.
 */
function Carried({
  values,
  except = [],
}: {
  values: Readonly<Record<string, string>>
  except?: readonly string[]
}) {
  return (
    <>
      {Object.entries(values)
        .filter(([name]) => !except.includes(name))
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
    </>
  )
}

export function ContributePage(props: ContributePageProps) {
  const { archetype, step, route, slug } = props
  const action = `/e/${slug}/contribute`

  return (
    <Shell
      title={contributeCopy.choose.title}
      archetype={archetype}
      step={step}
      route={route}
      eventTitle={props.eventTitle}
      organiserName={props.organiserName}
      verifiedOn={props.verifiedOn}
    >
      {props.error === undefined ? null : (
        <div className="conflict" role="alert">
          <p className="claimedBody">{contributeCopy.errors[props.error]}</p>
        </div>
      )}

      {step === 'choose' ? <ChooseStep action={action} verb={archetype.verb} /> : null}
      {step === 'amount' ? <AmountStep action={action} {...props} /> : null}
      {step === 'item' ? <ItemStep action={action} {...props} /> : null}
      {step === 'who' ? <WhoStep action={action} {...props} /> : null}
      {step === 'pay' ? <PayStep action={action} {...props} /> : null}
      {step === 'done' ? <DoneStep {...props} /> : null}
    </Shell>
  )
}

function ChooseStep({ action, verb }: { action: string; verb: string }) {
  const routes: { route: ContributionRoute; title: string; blurb: string }[] = [
    {
      route: 'money',
      title: contributeCopy.choose.money(verb),
      blurb: contributeCopy.choose.moneyBlurb,
    },
    {
      route: 'item',
      title: contributeCopy.choose.item,
      blurb: contributeCopy.choose.itemBlurb,
    },
    {
      route: 'earmark',
      title: contributeCopy.choose.earmark(verb),
      blurb: contributeCopy.choose.earmarkBlurb,
    },
  ]

  return (
    <>
      <h1 className="title">{contributeCopy.choose.title}</h1>
      <p className="intro">{contributeCopy.choose.intro}</p>

      {routes.map((option) => (
        <form key={option.route} method="post" action={action} className="claimForm">
          <input type="hidden" name="route" value={option.route} />
          <input type="hidden" name="step" value="choose" />
          <button type="submit" className="buttonPrimary">
            {option.title}
          </button>
          <p className="claimHelp">{option.blurb}</p>
        </form>
      ))}
    </>
  )
}

function AmountStep({
  action,
  route,
  carried,
  amountsPublic,
}: ContributePageProps & { action: string }) {
  return (
    <>
      <h1 className="title">
        {amountsPublic
          ? contributeCopy.amount.titlePublic
          : contributeCopy.amount.titleHidden}
      </h1>
      <p className="intro">
        {amountsPublic
          ? contributeCopy.amount.introPublic
          : contributeCopy.amount.introHidden}
      </p>

      <form method="post" action={action} className="claimForm">
        <Carried values={carried} />
        <input type="hidden" name="route" value={route} />
        <input type="hidden" name="step" value="amount" />

        <label className="claimLabel" htmlFor="amount">
          {contributeCopy.amount.label}
        </label>
        <input
          className="claimInput"
          id="amount"
          name="amount"
          type="text"
          inputMode="decimal"
          placeholder={contributeCopy.amount.placeholder}
          data-numeric=""
          required
        />
        <p className="claimHelp">{contributeCopy.amount.help}</p>

        <button type="submit" className="buttonPrimary">
          {contributeCopy.amount.submit}
        </button>
      </form>
    </>
  )
}

function ItemStep({
  action,
  route,
  carried,
  needs,
}: ContributePageProps & { action: string }) {
  return (
    <>
      <h1 className="title">{contributeCopy.choose.item}</h1>
      <p className="intro">{contributeCopy.choose.itemBlurb}</p>

      <ul className="needs">
        {needs.map((need) => (
          <li key={need.id} className="need">
            <p className="needLabel">{need.label}</p>
            <p className="needStatus" data-numeric="">
              {`${String(need.remaining)} still needed`}
            </p>
            <form method="post" action={action} className="claimForm">
              <Carried values={carried} />
              <input type="hidden" name="route" value={route} />
              <input type="hidden" name="step" value="item" />
              <input type="hidden" name="item" value={need.id} />
              <button type="submit" className="buttonPrimary">
                {`Choose ${need.label.toLowerCase()}`}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  )
}

/** The visible inputs on the who step, which must not also be hidden fields. */
const WHO_FIELDS = ['name', 'phone', 'message'] as const

function WhoStep({
  action,
  route,
  slug,
  carried,
  amountsPublic,
  defaultVisibility,
  photoDigest,
}: ContributePageProps & { action: string }) {
  const options: { value: Visibility; label: string }[] = [
    { value: 'public', label: contributeCopy.who.visibilityPublic },
    { value: 'name_only', label: contributeCopy.who.visibilityNameOnly },
    { value: 'anonymous', label: contributeCopy.who.visibilityAnonymous },
  ]

  return (
    <>
      <h1 className="title">{contributeCopy.who.title}</h1>
      <p className="intro">
        {amountsPublic ? contributeCopy.who.introPublic : contributeCopy.who.introHidden}
      </p>

      {/*
        Multipart, because this step carries a file. It is the only step that
        does, and the one that has to keep working on a phone with no
        JavaScript — so the photo travels in the same plain form submit as the
        name, with no upload widget and nothing to fail separately.
      */}
      <form
        method="post"
        action={action}
        className="claimForm"
        encType="multipart/form-data"
      >
        <Carried values={carried} except={WHO_FIELDS} />
        <input type="hidden" name="route" value={route} />
        <input type="hidden" name="step" value="who" />

        <label className="claimLabel" htmlFor="name">
          {contributeCopy.who.nameLabel}
        </label>
        <input
          className="claimInput"
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder={contributeCopy.who.namePlaceholder}
          defaultValue={carried.name ?? ''}
          required
        />

        <label className="claimLabel" htmlFor="phone">
          {contributeCopy.who.phoneLabel}
        </label>
        <input
          className="claimInput"
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          data-numeric=""
          defaultValue={carried.phone ?? ''}
        />
        <p className="claimHelp">{contributeCopy.who.phoneHelp}</p>

        <label className="claimLabel" htmlFor="message">
          {contributeCopy.who.messageLabel}
        </label>
        <input
          className="claimInput"
          id="message"
          name="message"
          type="text"
          defaultValue={carried.message ?? ''}
        />

        {/*
          The photo, where `design/contribute.html` puts it — but only on the
          routes that create a contribution row.

          "Bring something" has no pay step, and the pay step is what creates
          the row (M2-05); that route reserves through the claim path M2-04
          already built. A file field there would take somebody's photo, store
          it, and attach it to nothing — so it is not offered rather than
          quietly discarded.

          `accept` is a hint to the file picker and nothing more. What is
          actually allowed is decided by the magic bytes on the server, because
          a browser's idea of the type is whatever the client wrote there.
        */}
        {!requiresPayment(route) ? null : (
          <>
            <label className="claimLabel" htmlFor="photo">
              {contributeCopy.who.photoLabel}
            </label>
            <input
              className="claimInput"
              id="photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
            />
            <p className="claimHelp">{contributeCopy.who.photoHelp}</p>
            <p className="claimHelp">{contributeCopy.who.photoSafety}</p>

            {photoDigest === undefined ? null : (
              <>
                <Photo
                  slug={slug}
                  digest={photoDigest}
                  size="thumb"
                  className="photoThumb"
                />
                <p className="claimHelp">{contributeCopy.who.photoAttached}</p>
                <button
                  type="submit"
                  name="removePhoto"
                  value="1"
                  className="buttonQuiet"
                >
                  {contributeCopy.who.photoRemove}
                </button>
              </>
            )}
          </>
        )}

        <fieldset className="claimQuantity">
          <legend className="claimLabel">{contributeCopy.who.visibilityLabel}</legend>
          {options.map((option) => (
            <label key={option.value} className="claimHelp" htmlFor={`v-${option.value}`}>
              <input
                id={`v-${option.value}`}
                type="radio"
                name="visibility"
                value={option.value}
                defaultChecked={option.value === defaultVisibility}
              />{' '}
              {option.label}
            </label>
          ))}
        </fieldset>
        <p className="claimHelp">{contributeCopy.who.visibilityFoot}</p>
        {photoDigest === undefined ? null : (
          <p className="claimHelp">{contributeCopy.who.photoAnonymousNote}</p>
        )}

        <button type="submit" className="buttonPrimary">
          {contributeCopy.who.submit}
        </button>
      </form>
    </>
  )
}

function PayStep(props: ContributePageProps & { action: string }) {
  const { action, carried, payDetails, reference, amount, mode, beneficiary } = props

  // One decision point, in the domain, for both modes — so a screen cannot be
  // reachable for a reason the rules do not agree with.
  if (
    !canReachPayStep(mode, {
      payDetails: payDetails ?? null,
      beneficiary: beneficiary ?? null,
    })
  ) {
    return mode === 'hosted' ? (
      <>
        <h1 className="title">{contributeCopy.pay.noBeneficiaryTitle}</h1>
        <p className="intro">{contributeCopy.pay.noBeneficiaryBody}</p>
      </>
    ) : (
      <>
        <h1 className="title">{contributeCopy.pay.noNumberTitle}</h1>
        <p className="intro">{contributeCopy.pay.noNumberBody}</p>
      </>
    )
  }

  if (mode === 'hosted') return <HostedPayStep {...props} />

  if (payDetails === null || payDetails === undefined) return null

  return (
    <>
      <h1 className="title">{contributeCopy.pay.title}</h1>
      <p className="intro">{contributeCopy.pay.intro}</p>

      <div className="notice">
        <p className="noticeTitle">{contributeCopy.pay.numberStep}</p>
        <p className="payValue" data-numeric="" data-copy-value={payDetails.phone}>
          {payDetails.phone}
        </p>
        <p className="claimHelp">{payDetails.name}</p>
        <button type="button" className="buttonQuiet" data-copy-button={payDetails.phone}>
          {contributeCopy.pay.copyNumber}
        </button>
      </div>

      <div className="notice">
        <p className="noticeTitle">{contributeCopy.pay.referenceStep}</p>
        <p className="payValue" data-numeric="" data-copy-value={reference ?? ''}>
          {reference}
        </p>
        <p className="claimHelp">{contributeCopy.pay.referenceHelp}</p>
        <button type="button" className="buttonQuiet" data-copy-button={reference ?? ''}>
          {contributeCopy.pay.copyReference}
        </button>
      </div>

      <div className="notice">
        <p className="noticeTitle">{contributeCopy.pay.amountStep}</p>
        <p className="payValue" data-numeric="">
          {amount === undefined ? '' : formatMoney(amount)}
        </p>
      </div>

      <form method="post" action={action} className="claimForm">
        <Carried values={carried} />
        <input type="hidden" name="step" value="pay" />
        <button type="submit" className="buttonPrimary">
          {contributeCopy.pay.submit}
        </button>
      </form>

      <p className="claimHelp">{contributeCopy.pay.foot}</p>
    </>
  )
}

/**
 * The hosted pay step: what is about to be sent, and one button that sends it.
 *
 * **No reference is shown**, unlike the ledger-only step. There it is the whole
 * mechanism — the contributor types it into a banking app and it is what the
 * organiser reconciles against. Here nobody types anything, and a code on
 * screen with no use invites somebody to think they have to do something with
 * it. See docs/decisions.md M5-02 §5.
 *
 * The form posts to the same handler as the ledger-only step, with the same
 * `step=pay`. What differs is on the server: there it is *"I've paid"*, here it
 * starts a checkout and redirects. `<form method="post">`, so the whole thing
 * works with JavaScript off.
 */
function HostedPayStep({
  action,
  carried,
  amount,
}: ContributePageProps & { action: string }) {
  return (
    <>
      <h1 className="title">{contributeCopy.pay.hostedTitle}</h1>
      <p className="intro">{contributeCopy.pay.hostedIntro}</p>

      <div className="notice">
        <p className="noticeTitle">{contributeCopy.pay.hostedAmountStep}</p>
        <p className="payValue" data-numeric="">
          {amount === undefined ? '' : formatMoney(amount)}
        </p>
      </div>

      <form method="post" action={action} className="claimForm">
        <Carried values={carried} />
        <input type="hidden" name="step" value="pay" />
        <button type="submit" className="buttonPrimary">
          {contributeCopy.pay.hostedSubmit}
        </button>
      </form>

      <p className="claimHelp">{contributeCopy.pay.hostedFoot}</p>
    </>
  )
}

function DoneStep({
  slug,
  photoDigest,
  visibility,
  mode,
  paymentConfirmed,
}: ContributePageProps) {
  const hosted = mode === 'hosted'

  return (
    <>
      <h1 className="title">{contributeCopy.done.title}</h1>
      <p className="intro">
        {hosted ? contributeCopy.done.hostedBody : contributeCopy.done.body}
      </p>

      {photoDigest === undefined ? null : (
        <>
          <Photo slug={slug} digest={photoDigest} size="thumb" className="photoThumb" />
          <p className="claimHelp">{contributeCopy.done.photoCaption}</p>
          {/*
            Said here rather than nowhere, because the photo and the visibility
            are chosen in the same submit — there is no moment before this one at
            which the two could be seen to disagree. It states the fact and
            leaves the choice alone: it is her photo.
          */}
          {visibility === 'anonymous' ? (
            <p className="claimHelp">{contributeCopy.done.photoAnonymous}</p>
          ) : null}
        </>
      )}

      {/*
        Read from the row rather than assumed. The contributor comes back
        through a redirect and the notification arrives on its own path — it has
        usually landed first, and sometimes it has not.
      */}
      <p className="claimHelp">
        {hosted
          ? paymentConfirmed === true
            ? contributeCopy.done.hostedConfirmed
            : contributeCopy.done.hostedClearing
          : contributeCopy.done.pending}
      </p>
      {hosted ? null : <p className="claimHelp">{contributeCopy.done.foot}</p>}
    </>
  )
}
