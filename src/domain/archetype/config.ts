/**
 * The archetype config — implementation plan Part C.1.
 *
 * One object drives the accent, the verb, whether a target exists, whether
 * anything moves, and what the organiser is told at the point of choosing.
 * **Bereavement is the fallback, not a special case.** Nothing in this module
 * or anything consuming it branches on `group === 'bereavement'`.
 *
 * Three layers enforce the bereavement constraints (architecture §6):
 *
 *   1. **Database** — the CHECK constraints, generated from this file by
 *      `scripts/archetype-constraint.ts`
 *   2. **Type system** — this module: {@link TargetedArchetype} and
 *      {@link AnimatedArchetype}
 *   3. **Runtime** — the render guard in `./guard`
 *
 * The type layer is the one that acts before the code exists. A component
 * declaring `archetype: TargetedArchetype` cannot be handed the bereavement
 * config, so a progress bar on a funeral page is a build failure rather than
 * something a reviewer has to notice.
 */

export type ArchetypeKey =
  'umshado' | 'umembeso' | 'umngcwabo' | 'umbuyiso' | 'imbeleko' | 'graduation' | 'itiye'

export type ArchetypeGroup =
  'union' | 'bereavement' | 'remembrance' | 'arrival' | 'achievement' | 'gathering'

/**
 * Identifies a versioned need template. The templates themselves are seed data
 * (`prisma/seed/need-templates.ts`, M2) — a list of tents and chairs and 20kg
 * of meat is not business logic and has no place in the domain layer.
 */
export type NeedTemplateId = `${ArchetypeKey}@v${number}`

/**
 * One line of what changes if you pick this archetype, shown at the kind step
 * of setup (`design/setup.html`). The organiser is told the consequences
 * *before* choosing, not left to discover them on a published page.
 */
export interface Consequence {
  readonly label: string
  readonly detail: string
}

export interface ArchetypeConfig {
  readonly key: ArchetypeKey
  readonly group: ArchetypeGroup

  /**
   * **Omitted entirely for bereavement — never set to `undefined`.**
   *
   * Every accent usage in CSS is `var(--accent, #16233D)`, so an archetype
   * declaring no accent renders indigo with no extra code and no conditional
   * anywhere (CLAUDE.md rule 2).
   *
   * `exactOptionalPropertyTypes` is on, so `accent: undefined` will not
   * compile. The key is absent or it holds a colour; there is no third state
   * for somebody to misread.
   */
  readonly accent?: string

  /** "Umngcwabo", "Umshado" — the word for this kind of umcimbi. */
  readonly kicker: string

  /** "Stand with them" · "Contribute". An action keeps its name through the flow. */
  readonly verb: string

  /** Whether each person's amount appears on the strand, or only their name. */
  readonly amountsPublic: boolean

  /**
   * **Explicitly `false` on bereavement, never merely absent** (Part C.1).
   * A missing flag is a decision nobody made; `false` is a decision somebody
   * made, and a test asserts it is present and `false` rather than `undefined`.
   */
  readonly animate: boolean

  readonly allowsTarget: boolean
  readonly allowsProgressBar: boolean
  readonly allowsCountdown: boolean

  readonly needsTemplate: NeedTemplateId

  readonly consequences: readonly Consequence[]

  /*
   * `copy: ArchetypeCopy` (Part D) is deliberately not here yet. Part D says to
   * extract the strings from `design/*.html` verbatim and not to paraphrase,
   * and the reference screens carry full copy for two archetypes only. Writing
   * the other five here would produce exactly the paraphrase Part D forbids, in
   * the file everyone would later assume had been reviewed. It lands with
   * `src/copy/`.
   */
}

/**
 * An archetype that can carry a target and show progress toward it.
 *
 * This is the type a progress bar, a target field or a "how far along" readout
 * must ask for. Bereavement declares `allowsTarget: false` as a literal, so it
 * is not assignable — the compiler refuses before anything renders.
 */
export type TargetedArchetype = ArchetypeConfig & {
  readonly allowsTarget: true
  readonly allowsProgressBar: true
}

/**
 * An archetype where a bead may settle onto the strand rather than simply
 * appearing.
 *
 * Separate from {@link TargetedArchetype} because the two are independent axes
 * and collapsing them would be wrong in both directions: `umbuyiso` carries a
 * target and permits no motion, and `imbeleko` animates with no target at all.
 */
export type AnimatedArchetype = ArchetypeConfig & { readonly animate: true }

/** Narrows a runtime-chosen archetype for a component that needs a target. */
export function isTargeted(config: ArchetypeConfig): config is TargetedArchetype {
  return config.allowsTarget && config.allowsProgressBar
}

/** Narrows a runtime-chosen archetype for anything that moves. */
export function isAnimated(config: ArchetypeConfig): config is AnimatedArchetype {
  return config.animate
}
