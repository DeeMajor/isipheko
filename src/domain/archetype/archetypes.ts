/**
 * The seven archetypes, one per `ArchetypeKey` in the schema, across all six
 * groups.
 *
 * Declared `as const satisfies` so every flag keeps its literal type. That is
 * what makes `ARCHETYPES.umngcwabo` un-assignable to `TargetedArchetype` — the
 * type layer of the three in architecture §6 — and it is why the mapping from
 * key to group can be read back out of this file to generate SQL.
 *
 * **Accents come from CLAUDE.md and implementation plan Part C.2**, not from
 * `design/setup.html`. The prototype disagrees on four of six, and writes
 * bereavement's accent as the literal `#16233D` — which is the fallback colour
 * spelled out, the exact thing rule 2 exists to prevent. It rendered correctly
 * anyway, because it only ever reached the page through `var(--accent, …)`, so
 * nothing in the prototype could have caught a wrong value. Two documents agree
 * against one that had no way to fail.
 *
 * Everything else — the flags, the sample copy, the consequence strings — is
 * the prototype's, and is authoritative.
 */

// Relative with an explicit extension: `scripts/render.ts` and
// `scripts/verify-ledger.ts` reach this file under plain Node with
// `--experimental-strip-types`, where the `@/` alias does not resolve
// (docs/decisions.md M2-01 §8, M5-01 §16). A **type-only** `@/` import is fine
// because it strips — this one is a value and would not.
import { archetypeWords, consequenceWords } from '../../copy/archetype.ts'

import type { ArchetypeConfig, ArchetypeKey, Consequence } from './config'

/**
 * The consequence lines shown at the kind step.
 *
 * **Composed from the flags, and the sentences live in `src/copy/archetype.ts`**
 * (M1-10). The prototype composes them the same way, and keying off the flags is
 * not the conditional rule 2 forbids — nothing here asks which archetype it is;
 * it asks what the archetype permits. Writing the same four sentences seven
 * times would add 28 chances to fix a typo in one place and not the other six.
 *
 * The words moved out at M1-10, which is what M1-04 §7 said should happen when
 * `src/copy/` landed: the flags stay, the sentences go.
 */
function consequencesFor(flags: {
  amountsPublic: boolean
  allowsTarget: boolean
  animate: boolean
}): readonly Consequence[] {
  return [
    flags.amountsPublic
      ? consequenceWords.amounts.shown
      : consequenceWords.amounts.hidden,
    flags.allowsTarget ? consequenceWords.target.shown : consequenceWords.target.hidden,
    flags.animate ? consequenceWords.motion.shown : consequenceWords.motion.hidden,
    {
      label: consequenceWords.words.label,
      detail: flags.amountsPublic
        ? consequenceWords.words.public
        : consequenceWords.words.private,
    },
  ]
}

export const ARCHETYPES = {
  umshado: {
    key: 'umshado',
    group: 'union',
    accent: '#8C2F22',
    kicker: archetypeWords.umshado.kicker,
    verb: archetypeWords.umshado.verb,
    amountsPublic: true,
    animate: true,
    allowsTarget: true,
    allowsProgressBar: true,
    allowsCountdown: true,
    needsTemplate: 'umshado@v1',
    consequences: consequencesFor({
      amountsPublic: true,
      allowsTarget: true,
      animate: true,
    }),
  },

  /**
   * The gift-giving ceremony after lobola. The prototype has no entry for it,
   * so it takes the union flags — it is the same group as `umshado` and the
   * same register.
   */
  umembeso: {
    key: 'umembeso',
    group: 'union',
    accent: '#8C2F22',
    kicker: archetypeWords.umembeso.kicker,
    verb: archetypeWords.umembeso.verb,
    amountsPublic: true,
    animate: true,
    allowsTarget: true,
    allowsProgressBar: true,
    allowsCountdown: true,
    needsTemplate: 'umembeso@v1',
    consequences: consequencesFor({
      amountsPublic: true,
      allowsTarget: true,
      animate: true,
    }),
  },

  /**
   * **No `accent` key.** Not `accent: undefined` — absent. Indigo arrives
   * through `var(--accent, #16233D)` with no conditional anywhere (rule 2).
   *
   * Every permission is `false`, written out. `animate: false` in particular is
   * explicit rather than merely missing, because a missing flag is a decision
   * nobody made and this is the one page where that is not recoverable.
   */
  umngcwabo: {
    key: 'umngcwabo',
    group: 'bereavement',
    kicker: archetypeWords.umngcwabo.kicker,
    verb: archetypeWords.umngcwabo.verb,
    amountsPublic: false,
    animate: false,
    allowsTarget: false,
    allowsProgressBar: false,
    allowsCountdown: false,
    needsTemplate: 'umngcwabo@v1',
    consequences: consequencesFor({
      amountsPublic: false,
      allowsTarget: false,
      animate: false,
    }),
  },

  /**
   * A tombstone unveiling. Not bereavement — the stone is usually a year or
   * more later and is often exactly what the family is raising toward — so it
   * carries a target. It keeps the bereavement register otherwise: amounts
   * hidden, nothing moves, nothing counts down.
   */
  umbuyiso: {
    key: 'umbuyiso',
    group: 'remembrance',
    accent: '#2C4A7C',
    kicker: archetypeWords.umbuyiso.kicker,
    verb: archetypeWords.umbuyiso.verb,
    amountsPublic: false,
    animate: false,
    allowsTarget: true,
    allowsProgressBar: true,
    allowsCountdown: false,
    needsTemplate: 'umbuyiso@v1',
    consequences: consequencesFor({
      amountsPublic: false,
      allowsTarget: true,
      animate: false,
    }),
  },

  /** Welcoming a child. Animates, and carries no target. */
  imbeleko: {
    key: 'imbeleko',
    group: 'arrival',
    accent: '#4A7C59',
    kicker: archetypeWords.imbeleko.kicker,
    verb: archetypeWords.imbeleko.verb,
    amountsPublic: true,
    animate: true,
    allowsTarget: false,
    allowsProgressBar: false,
    allowsCountdown: true,
    needsTemplate: 'imbeleko@v1',
    consequences: consequencesFor({
      amountsPublic: true,
      allowsTarget: false,
      animate: true,
    }),
  },

  graduation: {
    key: 'graduation',
    group: 'achievement',
    accent: '#C89211',
    kicker: archetypeWords.graduation.kicker,
    verb: archetypeWords.graduation.verb,
    amountsPublic: true,
    animate: true,
    allowsTarget: true,
    allowsProgressBar: true,
    allowsCountdown: true,
    needsTemplate: 'graduation@v1',
    consequences: consequencesFor({
      amountsPublic: true,
      allowsTarget: true,
      animate: true,
    }),
  },

  /** A hosted tea. Carries a target; nothing moves. */
  itiye: {
    key: 'itiye',
    group: 'gathering',
    accent: '#A6742B',
    kicker: archetypeWords.itiye.kicker,
    verb: archetypeWords.itiye.verb,
    amountsPublic: true,
    animate: false,
    allowsTarget: true,
    allowsProgressBar: true,
    allowsCountdown: true,
    needsTemplate: 'itiye@v1',
    consequences: consequencesFor({
      amountsPublic: true,
      allowsTarget: true,
      animate: false,
    }),
  },
} as const satisfies Record<ArchetypeKey, ArchetypeConfig>

/** Every key, in the order the setup screen offers them. */
export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES) as readonly ArchetypeKey[]

/** For untrusted input — a form field, a query string, a URL segment. */
export function isArchetypeKey(value: string): value is ArchetypeKey {
  return value in ARCHETYPES
}

/**
 * The lookup a runtime value goes through. The result is the union of all seven
 * configs, so it is not assignable to {@link TargetedArchetype} without
 * narrowing — which is the point. Narrow with `isTargeted` or guard it.
 */
export function archetypeFor(key: ArchetypeKey): ArchetypeConfig {
  return ARCHETYPES[key]
}
