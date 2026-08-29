/**
 * Where signing in sends somebody afterwards (M1-09).
 *
 * The home page's two calls to action land on `(organiser)` routes that redirect
 * here, and before this the destination was hardcoded to `/account`. So somebody
 * who tapped *"Set up your umcimbi"* was dropped at a phone-number field with no
 * explanation of what they had been doing, and arrived after the code at an
 * account screen rather than at the thing they came for.
 *
 * **An allowlist, not validation.** The obvious shape is a check that the value
 * starts with `/` and contains no `//` — and every open redirect ever shipped
 * passed a check like that. There are four places a sign-in can usefully end,
 * they are all known at build time, and anything else is the default. That
 * leaves nothing to get subtly wrong, and no value a person can supply that
 * reaches a `Location` header unrecognised.
 *
 * Making the first creation step public was the alternative, and it is bigger:
 * the archetype choice is inside the authenticated flow and this keeps it there
 * (docs/remaining-work.md Part D).
 */

/** Where somebody lands when they signed in without going anywhere in particular. */
export const DEFAULT_DESTINATION = '/account'

const DESTINATIONS = new Set([
  DEFAULT_DESTINATION,
  '/create',
  '/collections/new',
  '/verify',
])

/**
 * The destination for a submitted `next`, or the default.
 *
 * Never throws and never reflects the input: an unrecognised value is not an
 * error somebody needs to see, it is a value that does not exist.
 */
export function signInDestination(value: unknown): string {
  return typeof value === 'string' && DESTINATIONS.has(value)
    ? value
    : DEFAULT_DESTINATION
}

/** The query fragment that carries a destination through the two steps. */
export function destinationParam(value: unknown): string {
  const destination = signInDestination(value)

  return destination === DEFAULT_DESTINATION
    ? ''
    : `&next=${encodeURIComponent(destination)}`
}
