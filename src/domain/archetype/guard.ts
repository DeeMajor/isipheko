/**
 * The runtime render guard — layer three of architecture §6, and the backstop
 * for the two that come before it.
 *
 * The type layer stops a progress bar reaching a bereavement config at compile
 * time. It cannot help when the archetype is chosen at runtime and something
 * narrowed the union wrongly, or when a `as` assertion papered over the
 * mismatch. That is what this is for.
 *
 * **Pure.** No environment read, no logging, no framework. What to do about a
 * violation is decided by the caller — `src/lib/archetype-guard.ts` wires it to
 * the environment and is what components actually call.
 */

import type { ArchetypeConfig, ArchetypeGroup, ArchetypeKey } from './config'

export type ArchetypeFeature = 'target' | 'progressBar' | 'countdown' | 'motion'

export interface ArchetypeViolation {
  readonly archetype: ArchetypeKey
  readonly group: ArchetypeGroup
  readonly feature: ArchetypeFeature
  /** Safe for logs: archetype and feature only, no event and no person. */
  readonly message: string
}

const PERMITS: Record<ArchetypeFeature, (config: ArchetypeConfig) => boolean> = {
  target: (config) => config.allowsTarget,
  progressBar: (config) => config.allowsProgressBar,
  countdown: (config) => config.allowsCountdown,
  motion: (config) => config.animate,
}

/** Returns the violation, or `null` when the archetype permits the feature. */
export function archetypeViolation(
  config: ArchetypeConfig,
  feature: ArchetypeFeature,
): ArchetypeViolation | null {
  if (PERMITS[feature](config)) return null

  return {
    archetype: config.key,
    group: config.group,
    feature,
    message: `${config.key} (${config.group}) does not permit ${feature}`,
  }
}

export class ArchetypeGuardError extends Error {
  override readonly name = 'ArchetypeGuardError'
  readonly violation: ArchetypeViolation

  constructor(violation: ArchetypeViolation) {
    super(
      `Archetype guard: ${violation.message}. This is one of the three layers ` +
        'protecting a bereavement page (docs/architecture.md §6). Do not ' +
        'loosen it — take the feature off the page for this archetype.',
    )
    this.violation = violation
  }
}

export interface ArchetypeGuardOptions {
  /**
   * Development throws — a violation is a bug, and it should stop the person
   * who wrote it rather than reach a family.
   *
   * Production does not. A progress bar that quietly fails to render on a
   * funeral is a bug we can live with; a 500 on the funeral page, for a family
   * who have just shared the link, is not. `onViolation` is how it stays
   * discoverable.
   */
  readonly throwOnViolation: boolean
  readonly onViolation?: (violation: ArchetypeViolation) => void
}

/**
 * `true` when the feature may render. Fails closed: a violation returns `false`
 * whenever it does not throw, so the forbidden element never renders either
 * way.
 */
export function guardArchetypeFeature(
  config: ArchetypeConfig,
  feature: ArchetypeFeature,
  options: ArchetypeGuardOptions,
): boolean {
  const violation = archetypeViolation(config, feature)
  if (violation === null) return true

  options.onViolation?.(violation)
  if (options.throwOnViolation) throw new ArchetypeGuardError(violation)

  return false
}
