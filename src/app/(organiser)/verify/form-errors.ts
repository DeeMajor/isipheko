import type { SaIdRejection, StartRejection } from '@/domain/identity'
import type { VerifyView } from '@/lib/identity'

/**
 * Overlays what the last submission said onto the state the database holds.
 *
 * The codes come back in the query string (M1-06 §10) so the flow works with
 * JavaScript disabled. They are matched against fixed sets rather than trusted:
 * these values index into copy, and a query parameter is whatever somebody
 * typed.
 */

const ID_REASONS: readonly SaIdRejection[] = [
  'empty',
  'wrong-length',
  'not-digits',
  'impossible-date',
  'unknown-citizenship',
  'check-digit',
]

const BLOCKERS: readonly StartRejection[] = [
  'already-verified',
  'already-pending',
  'rate-limited',
  'no-consent',
]

export function withFormErrors(
  view: VerifyView,
  {
    id,
    blocked,
    name,
  }: { id?: string | undefined; blocked?: string | undefined; name?: string | undefined },
): VerifyView {
  if (view.kind !== 'idle') return view

  return {
    ...view,
    idError: ID_REASONS.find((reason) => reason === id) ?? null,
    blocked: BLOCKERS.find((reason) => reason === blocked) ?? null,
    needsName: name === 'required' ? true : view.needsName,
  }
}
