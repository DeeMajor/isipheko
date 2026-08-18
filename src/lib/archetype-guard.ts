/**
 * The render guard components call.
 *
 * `src/domain/archetype/guard.ts` decides what a violation *is*; this decides
 * what happens about one, which needs the environment and a way to report —
 * neither of which belongs in the domain layer.
 *
 *   if (!mayRender(archetype, 'progressBar')) return null
 *
 * In development it throws, so whoever wrote the mistake meets it immediately.
 * In production it returns `false` and reports: the element does not render,
 * and the page still serves. A family who have just sent the link to fifty
 * people get a page with something missing, rather than an error.
 */

import {
  type ArchetypeConfig,
  type ArchetypeFeature,
  type ArchetypeViolation,
  guardArchetypeFeature,
} from '@/domain/archetype'

/**
 * Carries the archetype and the feature and nothing else — no event, no slug,
 * no person (CLAUDE.md rule 8).
 */
function reportViolation(violation: ArchetypeViolation): void {
  console.error('[archetype-guard]', {
    archetype: violation.archetype,
    group: violation.group,
    feature: violation.feature,
  })
}

export function mayRender(config: ArchetypeConfig, feature: ArchetypeFeature): boolean {
  return guardArchetypeFeature(config, feature, {
    throwOnViolation: process.env.NODE_ENV !== 'production',
    onViolation: reportViolation,
  })
}
