/**
 * The shape of setting up an umcimbi: which step follows which, what each one
 * needs before it can be left, and when the whole thing may be published.
 *
 * Pure. It takes counts and flags, not rows — the repository reads the
 * database, this decides what the answer means.
 */

export const SETUP_STEPS = [
  'kind',
  'details',
  'needs',
  'witnesses',
  'verify',
  'share',
] as const

export type SetupStep = (typeof SETUP_STEPS)[number]

export function stepNumber(step: SetupStep): number {
  return SETUP_STEPS.indexOf(step) + 1
}

export function previousStep(step: SetupStep): SetupStep | null {
  const index = SETUP_STEPS.indexOf(step)
  return index <= 0 ? null : (SETUP_STEPS[index - 1] ?? null)
}

export function nextStep(step: SetupStep): SetupStep | null {
  const index = SETUP_STEPS.indexOf(step)
  return index === -1 || index === SETUP_STEPS.length - 1
    ? null
    : (SETUP_STEPS[index + 1] ?? null)
}

/** What the repository has counted, and nothing more. */
export interface DraftState {
  readonly title: string
  readonly needCount: number
  readonly witnessCount: number
  readonly isPublished: boolean
  /** Whether the organiser's identity has been checked (M3-01). */
  readonly organiserVerified: boolean
}

export type PublishBlocker =
  'already-published' | 'no-title' | 'no-needs' | 'no-witnesses' | 'not-verified'

export type PublishDecision =
  { readonly ok: true } | { readonly ok: false; readonly blocker: PublishBlocker }

/**
 * Whether this draft may go public.
 *
 * The first three are the design's own rules: the setup screen will not let you
 * leave the needs step with an empty list or the witnesses step with nobody
 * named, and an event with no title has nothing to put on a page.
 *
 * **`not-verified` is M3-02, and it is last on purpose.** M1-07 §5 left this
 * clause out because nothing set the status and a gate against a status nobody
 * writes always passes; M3-01 writes it, so the gate is real. It is checked
 * after the content rules because those are each one field away on a screen the
 * organiser is already on, and this one sends her somewhere else — asking
 * somebody to go and be verified and then telling them they also have no title
 * would be the wrong order to discover two problems in.
 *
 * The refusal is repeated in `publishDraft` as a condition on the UPDATE
 * itself. That is not the "one guard with a spare" M2-05 §7 warns about: the
 * second layer is Postgres, it refuses atomically, and an integration test
 * watches it refuse a caller that never asked this function.
 */
export function canPublish(draft: DraftState): PublishDecision {
  if (draft.isPublished) return { ok: false, blocker: 'already-published' }
  if (draft.title.trim() === '') return { ok: false, blocker: 'no-title' }
  if (draft.needCount === 0) return { ok: false, blocker: 'no-needs' }
  if (draft.witnessCount === 0) return { ok: false, blocker: 'no-witnesses' }
  if (!draft.organiserVerified) return { ok: false, blocker: 'not-verified' }

  return { ok: true }
}

/** The design allows up to three abakhaphi, and asks for at least one. */
export const MAX_WITNESSES = 3
