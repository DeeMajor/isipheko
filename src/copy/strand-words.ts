import type { BeadForm } from '../domain/strand/index.ts'

import { eventCopy } from './event.ts'

/**
 * What a bead is called, in words.
 *
 * Three surfaces need the same phrasing for the same act: the strand on the
 * event page, M4-02's album, and M4-03's printed one. Two sets of words for one
 * event is how a cover and its entries start disagreeing about what somebody
 * did, so there is one set and it lives here — beside the strings it is made
 * of, rather than inside a React component.
 *
 * **They were in `src/ui/strand.tsx` until the printed album needed them.** A
 * `.tsx` file cannot be loaded by `node --experimental-strip-types`, which is
 * how the scheduled jobs run (`pnpm render`), so a job that wanted these words
 * would have had to pull a rendering component through a JSX transform to get
 * at three string functions.
 *
 * Relative imports for the same reason — see docs/decisions.md M2-01 §8.
 */

/**
 * The least a thing has to be for the strand to describe it.
 *
 * `StrandBead` satisfies it, and so does `AlbumEntry` — which carries no amount
 * at all.
 */
export interface BeadSubject {
  readonly form: BeadForm
  readonly name: string | null
  readonly description: string | null
  readonly members?: readonly string[]
  readonly memberCount?: number
}

/**
 * How many people are inside a group bead.
 *
 * `memberCount` rather than `members.length`: somebody who gave quietly is in
 * the group and not in the list of names (M2-09), and a bead that said "5
 * together" while naming six would be wrong in the direction that matters.
 */
export function groupSize(bead: BeadSubject): number {
  return bead.memberCount ?? bead.members?.length ?? 0
}

/** What this bead is: the label a screen reader hears and the printed page shows. */
export function whatOf(bead: BeadSubject): string {
  if (bead.form === 'group') return eventCopy.strand.together(groupSize(bead))
  if (bead.form === 'in_kind') {
    return eventCopy.strand.bringing(bead.description ?? '')
  }

  return eventCopy.strand.money
}

/** Their name, or the word for somebody who chose to stand at the back. */
export function nameOf(bead: BeadSubject): string {
  return bead.name ?? eventCopy.strand.quietly
}
