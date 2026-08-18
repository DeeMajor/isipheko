/**
 * `import { ARCHETYPES, isTargeted } from '@/domain/archetype'`.
 *
 * Components call `mayRender` from `@/lib/archetype-guard` rather than the pure
 * guard here — that is the one wired to the environment.
 */

export {
  type ArchetypeConfig,
  type ArchetypeGroup,
  type ArchetypeKey,
  type AnimatedArchetype,
  type Consequence,
  type NeedTemplateId,
  type TargetedArchetype,
  isAnimated,
  isTargeted,
} from './config'

export { ARCHETYPES, ARCHETYPE_KEYS, archetypeFor, isArchetypeKey } from './archetypes'

export {
  type ArchetypeFeature,
  type ArchetypeGuardOptions,
  type ArchetypeViolation,
  ArchetypeGuardError,
  archetypeViolation,
  guardArchetypeFeature,
} from './guard'
