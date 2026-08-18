/**
 * Where the organiser goes once verified.
 *
 * Validated rather than trusted: `?returnTo=https://…` on a page somebody
 * reaches while signed in is an open redirect, and a link that carries a person
 * from our domain to somebody else's is exactly the shape of the scam this
 * product exists to be distinguishable from (§10).
 *
 * Same-origin absolute paths only. `//host` is refused because a browser reads
 * it as a host rather than as a path, and a backslash is refused because some
 * browsers have historically read that as a slash.
 *
 * Its own module rather than living beside the action: a `'use server'` file may
 * export nothing but async functions.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (!/^\/[A-Za-z0-9\-._~/]*$/.test(value)) return null

  return value
}
