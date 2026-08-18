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
  Visibility,
} from '@/domain/contribution'
import { stepNumber, stepsFor } from '@/domain/contribution'
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
  readonly defaultVisibility: Visibility
  readonly error?: keyof typeof contributeCopy.errors | undefined
  /** The organiser's verification date, so the badge follows them (M3-04). */
  readonly verifiedOn?: string | undefined
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

function Carried({ values }: { values: Readonly<Record<string, string>> }) {
  return (
    <>
      {Object.entries(values).map(([name, value]) => (
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
      {step === 'done' ? <DoneStep /> : null}
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

function WhoStep({
  action,
  route,
  carried,
  amountsPublic,
  defaultVisibility,
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

      <form method="post" action={action} className="claimForm">
        <Carried values={carried} />
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
        />
        <p className="claimHelp">{contributeCopy.who.phoneHelp}</p>

        <label className="claimLabel" htmlFor="message">
          {contributeCopy.who.messageLabel}
        </label>
        <input className="claimInput" id="message" name="message" type="text" />

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

        <button type="submit" className="buttonPrimary">
          {contributeCopy.who.submit}
        </button>
      </form>
    </>
  )
}

function PayStep({
  action,
  carried,
  payDetails,
  reference,
  amount,
}: ContributePageProps & { action: string }) {
  if (payDetails === null || payDetails === undefined) {
    return (
      <>
        <h1 className="title">{contributeCopy.pay.noNumberTitle}</h1>
        <p className="intro">{contributeCopy.pay.noNumberBody}</p>
      </>
    )
  }

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

function DoneStep() {
  return (
    <>
      <h1 className="title">{contributeCopy.done.title}</h1>
      <p className="intro">{contributeCopy.done.body}</p>
      <p className="claimHelp">{contributeCopy.done.pending}</p>
      <p className="claimHelp">{contributeCopy.done.foot}</p>
    </>
  )
}
