'use server'

import { redirect } from 'next/navigation'

import { requestFingerprint } from '@/lib/audit'
import { startIdentityCheck } from '@/lib/identity'
import { currentSession } from '@/lib/session'

import { safeReturnTo } from './return-to'

/**
 * Starting a check, as a plain form post.
 *
 * Errors travel back as **codes in the query string** and are turned into copy
 * by the page (M1-06 §10). That is what makes the whole flow work with
 * JavaScript disabled, and it is also the reason the ID number can never appear
 * in a URL: nothing here has a branch that could put it there, because what goes
 * back is a code from a fixed set.
 */

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : ''
}

export async function submitVerification(formData: FormData): Promise<void> {
  const session = await currentSession()
  if (session === null) redirect('/sign-in')

  const returnTo = safeReturnTo(text(formData.get('returnTo')))

  // Where the answer is rendered. Step five of the setup flow posts from inside
  // its own shell and passes its own path, so the pending page and the result
  // appear where she is rather than throwing her onto the standalone route
  // mid-flow. Validated like any other path from a form.
  const on = safeReturnTo(text(formData.get('on'))) ?? '/verify'
  const here = returnTo === null ? on : `${on}?returnTo=${encodeURIComponent(returnTo)}`
  const separator = here.includes('?') ? '&' : '?'

  const result = await startIdentityCheck({
    organiserId: session.organiserId,
    idNumberInput: text(formData.get('idNumber')),
    claimedNameInput: text(formData.get('claimedName')),
    consented: text(formData.get('consent')) === 'yes',
    fingerprint: await requestFingerprint(),
  })

  if (result.ok) redirect(here)

  if ('idError' in result) redirect(`${here}${separator}id=${result.idError}`)
  if ('nameRequired' in result) redirect(`${here}${separator}name=required`)

  redirect(`${here}${separator}blocked=${result.blocked}`)
}
