import { verifyCopy } from '@/copy/verify'
import { setupCopy } from '@/copy/setup'
import type { VerifyView } from '@/lib/identity'
import { Button, Card, Field, Toast } from '@/ui/primitives'

import { submitVerification } from './actions'

import styles from './verify.module.css'

/**
 * The identity check, as one component, so the standalone `/verify` route and
 * step five of the setup flow are the same screen rather than two that have to
 * be kept in step.
 *
 * **The pending state reloads the page and ships no script to do it.** A
 * `<meta http-equiv="refresh">` with a widening interval is the whole mechanism:
 * it works with JavaScript off, on a browser that has never run a framework, and
 * on the borrowed phone this product keeps meeting. A JSON endpoint and a small
 * enhancement would be a nicer experience and a new pattern, for a page somebody
 * sees once.
 */
export function VerifyPanel({
  view,
  returnTo,
  on,
  title = verifyCopy.title,
  lead = verifyCopy.lead,
  intro,
}: {
  view: VerifyView
  returnTo: string | null
  /**
   * Where the answer should be rendered. Step five of the setup flow passes its
   * own path so the check happens inside the shell she is already in; `/verify`
   * leaves it null and answers on itself.
   */
  on?: string | undefined
  /**
   * Step five of the setup flow keeps the wording from `design/setup.html`,
   * which explains why the check exists before asking for anything. `/verify` is
   * reached by somebody who already knows why they are there — usually from a
   * collection that cannot be shared — so it opens with the ask.
   *
   * Only the idle and failed states take these. Pending and verified say the
   * same thing wherever they are read.
   */
  title?: string
  lead?: string
  intro?: string | undefined
}) {
  if (view.kind === 'verified') {
    const on =
      view.verifiedAt === null
        ? 'today'
        : new Intl.DateTimeFormat('en-ZA', {
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          }).format(view.verifiedAt)

    return (
      <>
        <h1 className={styles.title}>{verifyCopy.verified.title}</h1>
        <p className={styles.lead}>{verifyCopy.verified.body(on)}</p>
        <p className={styles.note}>{verifyCopy.verified.note}</p>

        {returnTo === null ? null : (
          <form method="get" action={returnTo} className={styles.form}>
            <Button type="submit">{verifyCopy.verified.continue}</Button>
          </form>
        )}
      </>
    )
  }

  if (view.kind === 'pending') {
    return (
      <>
        {/*
          React hoists this into the head. The interval widens with how long the
          check has been running, so a hundred-and-twenty-second answer (§5.6)
          costs about a dozen reloads rather than sixty.
        */}
        <meta httpEquiv="refresh" content={String(view.refreshSeconds)} />

        <h1 className={styles.title}>{verifyCopy.pending.title}</h1>
        <p className={styles.lead}>{verifyCopy.pending.body}</p>
        <p className={styles.note}>{verifyCopy.pending.stillWaiting}</p>
      </>
    )
  }

  const failure = view.kind === 'failed' ? view : null

  return (
    <>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lead}>{lead}</p>
      {intro === undefined ? null : <p className={styles.note}>{intro}</p>}

      {failure === null ? null : (
        <Toast tone="problem" title={verifyCopy.failed.title}>
          {verifyCopy.failed.reasons[failure.reason]}
          {failure.retryable ? null : ` ${verifyCopy.failed.noChannelYet}`}
        </Toast>
      )}

      {view.kind === 'idle' && view.blocked !== null ? (
        <Toast tone="problem">{verifyCopy.blocked[view.blocked]}</Toast>
      ) : null}

      <Card title={setupCopy.verify.checkTitle} titleAs="h2" className={styles.card}>
        <ul className={styles.list}>
          {setupCopy.verify.checks.map((check) => (
            <li key={check} className={styles.item}>
              {check}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={verifyCopy.consent.heading} titleAs="h2" className={styles.card}>
        {/*
          The statement is one string, rendered as one paragraph, and its exact
          bytes are hashed into the consent record. What is stored and what was
          read are therefore the same thing — which is the only way a consent
          record answers "to what?" as well as "when?" (POPIA s11, §7.3).
        */}
        <p className={styles.consent}>{verifyCopy.consent.statement}</p>
      </Card>

      <form action={submitVerification} className={styles.form}>
        {returnTo === null ? null : (
          <input type="hidden" name="returnTo" value={returnTo} />
        )}
        {on === undefined ? null : <input type="hidden" name="on" value={on} />}

        {(view.kind === 'idle' && view.needsName) ||
        (failure !== null && failure.needsName) ? (
          <Field
            label={verifyCopy.field.nameLabel}
            id="claimedName"
            name="claimedName"
            autoComplete="name"
            required
          />
        ) : null}

        <Field
          label={verifyCopy.field.label}
          id="idNumber"
          name="idNumber"
          help={verifyCopy.field.help}
          inputMode="numeric"
          autoComplete="off"
          required
          {...(view.kind === 'idle' && view.idError !== null
            ? { error: verifyCopy.idErrors[view.idError] }
            : {})}
        />

        <label className={styles.check} htmlFor="consent">
          <input type="checkbox" id="consent" name="consent" value="yes" required />
          <span>{verifyCopy.consent.accept}</span>
        </label>

        <Button type="submit">
          {failure === null ? verifyCopy.submit : verifyCopy.failed.retry}
        </Button>
      </form>
    </>
  )
}
