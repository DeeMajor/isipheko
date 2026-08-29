import type { Metadata } from 'next'

import { authCopy } from '@/copy/auth'
import { pendingPhone } from '@/lib/session'
import { Button, Card, Field } from '@/ui/primitives'

import { requestCode, startOver, verifyCode } from './actions'
import { signInDestination } from './destination'

import styles from './page.module.css'

/**
 * Sign in, in two steps: a number, then the code that was sent to it.
 *
 * Plain `<form>` elements posting to server actions, so the whole flow works
 * with JavaScript disabled. Errors come back as a code in the query string and
 * are turned into copy here — a returned value would be dropped on a page with
 * no script, and the person would see the form again with no explanation.
 *
 * Nothing on this page reveals whether a number is registered. Step two says
 * the same sentence whether a code was sent, the number is unknown, or the
 * hourly limit was reached.
 */

export const metadata: Metadata = {
  title: 'Sign in · Isipheko',
  robots: { index: false, follow: false },
}

type PhoneError = keyof typeof authCopy.errors.phone
type CodeError = keyof typeof authCopy.errors.code

function phoneError(value: string | undefined): string | undefined {
  return value !== undefined && value in authCopy.errors.phone
    ? authCopy.errors.phone[value as PhoneError]
    : undefined
}

function codeError(value: string | undefined): string | undefined {
  return value !== undefined && value in authCopy.errors.code
    ? authCopy.errors.code[value as CodeError]
    : undefined
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string; next?: string }>
}) {
  const { step, error, next } = await searchParams
  const pending = await pendingPhone()

  /*
   * Where this sign-in is on the way to (M1-09). The home page's two calls to
   * action carry it, so somebody who tapped "Set up your umcimbi" arrives at the
   * setup flow rather than at their account screen.
   *
   * Allowlisted in `destination.ts`, so an unrecognised value is the default
   * rather than an error and nothing a person supplies reaches a redirect
   * unrecognised. Rendered as a hidden field rather than kept in the URL alone,
   * because the forms post to server actions and the query string is not part of
   * what they receive.
   */
  const destination = signInDestination(next)

  // The cookie is what decides, not the query string: an expired pending cookie
  // with `?step=code` still in the URL must send somebody back to the start
  // rather than to a form that cannot succeed.
  const onCodeStep = step === 'code' && pending !== null

  return (
    <main className={styles.page}>
      <Card
        title={onCodeStep ? authCopy.code.title : authCopy.signIn.title}
        titleAs="h1"
        className={styles.card}
      >
        <p className={styles.intro}>
          {onCodeStep ? authCopy.code.intro : authCopy.signIn.intro}
        </p>

        {onCodeStep ? (
          <>
            <form action={verifyCode} className={styles.form}>
              <input type="hidden" name="next" value={destination} />
              <Field
                id="code"
                name="code"
                label={authCopy.code.codeLabel}
                help={authCopy.code.codeHelp}
                error={codeError(error)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                data-numeric=""
              />
              <Button type="submit">{authCopy.code.submit}</Button>
            </form>

            <form action={startOver} className={styles.secondary}>
              <Button type="submit" variant="quiet">
                {authCopy.code.resend}
              </Button>
            </form>
          </>
        ) : (
          <form action={requestCode} className={styles.form}>
            <input type="hidden" name="next" value={destination} />
            <Field
              id="phone"
              name="phone"
              label={authCopy.signIn.phoneLabel}
              help={authCopy.signIn.phoneHelp}
              placeholder={authCopy.signIn.phonePlaceholder}
              error={phoneError(error)}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
            />
            <Button type="submit">{authCopy.signIn.submit}</Button>
          </form>
        )}
      </Card>
    </main>
  )
}
