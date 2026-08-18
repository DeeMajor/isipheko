import { describe, expect, it } from 'vitest'

import {
  ARCHETYPES,
  type AnimatedArchetype,
  type ArchetypeConfig,
  type TargetedArchetype,
  archetypeFor,
  isTargeted,
} from '@/domain/archetype'

/**
 * The type layer of architecture §6, asserted by the compiler.
 *
 * **Every `@ts-expect-error` below is the test.** `tsc --noEmit` covers this
 * file, and an unused `@ts-expect-error` is itself an error — so if any of
 * these ever starts compiling, `pnpm typecheck` fails. That is the mechanism:
 * these assertions cannot rot into passing silently.
 *
 * The assertions live inside `typeAssertions`, which is checked and never
 * called. The stand-in components are `declare`d and so have no runtime
 * binding; calling one for real would be a ReferenceError, and none of this
 * needs to execute to do its job. The `it` blocks at the bottom give Vitest
 * something to run.
 */

/** Stands in for any component that puts a target on the page. */
declare function ProgressBar(props: { archetype: TargetedArchetype }): null

/** Stands in for a bead that settles rather than simply appearing. */
declare function SettlingBead(props: { archetype: AnimatedArchetype }): null

export function typeAssertions(): void {
  // -------------------------------------------------------------------------
  // A progress bar cannot be built against bereavement.
  // -------------------------------------------------------------------------

  // @ts-expect-error umngcwabo declares allowsTarget: false, so it is not a
  // TargetedArchetype. This is the assertion the task is done by.
  ProgressBar({ archetype: ARCHETYPES.umngcwabo })

  // @ts-expect-error imbeleko animates but carries no target, which is why
  // targeting and motion are separate types rather than one "celebratory" flag.
  ProgressBar({ archetype: ARCHETYPES.imbeleko })

  // A wedding is fine.
  ProgressBar({ archetype: ARCHETYPES.umshado })

  // So is an unveiling: a target with no motion at all.
  ProgressBar({ archetype: ARCHETYPES.umbuyiso })

  // -------------------------------------------------------------------------
  // Nothing may move on a funeral page.
  // -------------------------------------------------------------------------

  // @ts-expect-error umngcwabo declares animate: false.
  SettlingBead({ archetype: ARCHETYPES.umngcwabo })

  // @ts-expect-error umbuyiso carries a target and still permits no motion.
  SettlingBead({ archetype: ARCHETYPES.umbuyiso })

  SettlingBead({ archetype: ARCHETYPES.imbeleko })

  // -------------------------------------------------------------------------
  // A runtime-chosen archetype has to be narrowed first.
  // -------------------------------------------------------------------------

  const chosen: ArchetypeConfig = archetypeFor('umshado')

  // @ts-expect-error the lookup returns ArchetypeConfig — which could be the
  // funeral — so it takes a guard, not a cast, to reach a progress bar.
  ProgressBar({ archetype: chosen })

  if (isTargeted(chosen)) {
    ProgressBar({ archetype: chosen })
  }
}

// ---------------------------------------------------------------------------
// The accent is absent, never undefined.
// ---------------------------------------------------------------------------

// @ts-expect-error exactOptionalPropertyTypes: `accent: undefined` will not
// compile, so "no accent" has exactly one spelling — the key is not there.
const explicitlyUndefined: ArchetypeConfig = {
  ...ARCHETYPES.umshado,
  accent: undefined,
}

describe('the type-level guarantees', () => {
  it('is enforced by tsc, not by anything in this block', () => {
    // If the @ts-expect-error comments above stopped being errors, `pnpm
    // typecheck` would fail before this file ever ran.
    expect(typeof typeAssertions).toBe('function')
    expect(isTargeted(ARCHETYPES.umngcwabo)).toBe(false)
    expect(isTargeted(ARCHETYPES.umshado)).toBe(true)
  })

  it('agrees with the runtime shape', () => {
    expect(explicitlyUndefined.accent).toBeUndefined()
    expect(archetypeFor('umshado').key).toBe('umshado')
  })
})
