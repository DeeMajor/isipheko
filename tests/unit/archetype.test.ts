import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ARCHETYPES,
  ARCHETYPE_KEYS,
  ArchetypeGuardError,
  type ArchetypeConfig,
  type ArchetypeGroup,
  archetypeFor,
  archetypeViolation,
  guardArchetypeFeature,
  isAnimated,
  isTargeted,
} from '@/domain/archetype'
import { mayRender } from '@/lib/archetype-guard'

const configs: readonly ArchetypeConfig[] = Object.values(ARCHETYPES)

const bereavement = configs.filter(
  (config) => config.group === 'bereavement',
) as readonly ArchetypeConfig[]

describe('the seven archetypes', () => {
  it('covers every key in the schema enum', () => {
    expect(ARCHETYPE_KEYS).toEqual([
      'umshado',
      'umembeso',
      'umngcwabo',
      'umbuyiso',
      'imbeleko',
      'graduation',
      'itiye',
    ])
  })

  it('covers all six groups', () => {
    const groups = new Set(configs.map((config) => config.group))
    expect([...groups].sort()).toEqual([
      'achievement',
      'arrival',
      'bereavement',
      'gathering',
      'remembrance',
      'union',
    ])
  })

  it('keys each config under its own key', () => {
    for (const key of ARCHETYPE_KEYS) {
      expect(archetypeFor(key).key).toBe(key)
    }
  })

  it('names a versioned need template per archetype', () => {
    for (const config of configs) {
      expect(config.needsTemplate).toBe(`${config.key}@v1`)
    }
  })
})

describe('bereavement', () => {
  it('exists — the whole suite below would pass vacuously otherwise', () => {
    expect(bereavement.map((config) => config.key)).toEqual(['umngcwabo'])
  })

  it.each(bereavement)(
    '$key declares animate as an explicit false, not undefined',
    (config) => {
      // The task, and Part C.1: "a missing flag is a decision nobody made".
      // `config.animate === false` alone would also pass for a config that
      // never declared it, because `undefined === false` is false and the
      // assertion would be written the other way round. So: the property is
      // present, it is a boolean, and it is false.
      expect(Object.hasOwn(config, 'animate')).toBe(true)
      expect(typeof config.animate).toBe('boolean')
      expect(config.animate).toBe(false)
      expect(config.animate).not.toBeUndefined()
    },
  )

  it.each(bereavement)('$key omits accent entirely', (config) => {
    // Not `accent: undefined` — absent. Indigo arrives through
    // `var(--accent, #16233D)` with no conditional (CLAUDE.md rule 2).
    expect(Object.hasOwn(config, 'accent')).toBe(false)
    expect('accent' in config).toBe(false)
    expect(config.accent).toBeUndefined()
  })

  it.each(bereavement)('$key permits nothing celebratory', (config) => {
    expect(config.allowsTarget).toBe(false)
    expect(config.allowsProgressBar).toBe(false)
    expect(config.allowsCountdown).toBe(false)
    expect(config.animate).toBe(false)
    expect(config.amountsPublic).toBe(false)
  })

  it.each(bereavement)('$key is not targeted and not animated', (config) => {
    expect(isTargeted(config)).toBe(false)
    expect(isAnimated(config)).toBe(false)
  })
})

describe('accents follow CLAUDE.md, not the prototype', () => {
  // design/setup.html disagrees on four of six and writes bereavement's accent
  // as the literal #16233D. It rendered correctly regardless, because it only
  // ever reached the page through var(--accent, …) — so nothing in the
  // prototype could have caught a wrong value.
  const ACCENTS: Record<ArchetypeGroup, string | undefined> = {
    union: '#8C2F22',
    bereavement: undefined,
    remembrance: '#2C4A7C',
    arrival: '#4A7C59',
    achievement: '#C89211',
    gathering: '#A6742B',
  }

  it.each(configs)('$key carries the $group accent', (config) => {
    expect(config.accent).toBe(ACCENTS[config.group])
  })

  it('declares an accent on every group except bereavement', () => {
    for (const config of configs) {
      expect(Object.hasOwn(config, 'accent')).toBe(config.group !== 'bereavement')
    }
  })
})

describe('flags', () => {
  it('never shows a progress bar without a target to progress toward', () => {
    for (const config of configs) {
      if (config.allowsProgressBar) expect(config.allowsTarget).toBe(true)
    }
  })

  it('keeps targeting and motion as independent axes', () => {
    // Collapsing them would be wrong in both directions, which is why
    // TargetedArchetype and AnimatedArchetype are separate types.
    expect(ARCHETYPES.umbuyiso.allowsTarget).toBe(true)
    expect(ARCHETYPES.umbuyiso.animate).toBe(false)
    expect(ARCHETYPES.imbeleko.animate).toBe(true)
    expect(ARCHETYPES.imbeleko.allowsTarget).toBe(false)
  })

  it('uses the verb the voice table fixes', () => {
    expect(ARCHETYPES.umngcwabo.verb).toBe('Stand with them')
    expect(ARCHETYPES.umbuyiso.verb).toBe('Stand with them')
    expect(ARCHETYPES.umshado.verb).toBe('Contribute')
    expect(ARCHETYPES.itiye.verb).toBe('Contribute')
  })

  it('never says "campaign", "donate", "fundraiser" or "goal"', () => {
    const forbidden = /campaign|donate|donation|fundraiser|fundraising|goal/i
    for (const config of configs) {
      const strings = [
        config.kicker,
        config.verb,
        ...config.consequences.flatMap((c) => [c.label, c.detail]),
      ]
      for (const text of strings) expect(text).not.toMatch(forbidden)
    }
  })
})

describe('consequences', () => {
  it.each(configs)('$key states four consequences', (config) => {
    expect(config.consequences).toHaveLength(4)
    for (const consequence of config.consequences) {
      expect(consequence.label.length).toBeGreaterThan(0)
      expect(consequence.detail.length).toBeGreaterThan(0)
    }
  })

  it('tells a bereaved organiser what will not happen', () => {
    const labels = ARCHETYPES.umngcwabo.consequences.map((c) => c.label)
    expect(labels).toEqual([
      'Amounts are hidden.',
      'No target is shown.',
      'No animation.',
      'The words change.',
    ])
  })

  it('matches the verb it promises', () => {
    const words = (config: ArchetypeConfig) =>
      config.consequences.find((c) => c.label === 'The words change.')?.detail

    expect(words(ARCHETYPES.umngcwabo)).toContain('Stand with them')
    expect(words(ARCHETYPES.umshado)).toContain('Contribute')
  })
})

describe('the runtime render guard', () => {
  it('reports a violation with no personal data in it', () => {
    const violation = archetypeViolation(ARCHETYPES.umngcwabo, 'progressBar')

    expect(violation).toEqual({
      archetype: 'umngcwabo',
      group: 'bereavement',
      feature: 'progressBar',
      message: 'umngcwabo (bereavement) does not permit progressBar',
    })
  })

  it('returns null when the archetype permits the feature', () => {
    expect(archetypeViolation(ARCHETYPES.umshado, 'progressBar')).toBeNull()
    expect(archetypeViolation(ARCHETYPES.umbuyiso, 'target')).toBeNull()
  })

  it('catches every forbidden feature on a funeral', () => {
    for (const feature of ['target', 'progressBar', 'countdown', 'motion'] as const) {
      expect(archetypeViolation(ARCHETYPES.umngcwabo, feature)).not.toBeNull()
    }
  })

  it('throws when told to, and names the layer it is defending', () => {
    expect(() =>
      guardArchetypeFeature(ARCHETYPES.umngcwabo, 'progressBar', {
        throwOnViolation: true,
      }),
    ).toThrow(ArchetypeGuardError)
  })

  it('fails closed when it does not throw', () => {
    const onViolation = vi.fn()

    const allowed = guardArchetypeFeature(ARCHETYPES.umngcwabo, 'motion', {
      throwOnViolation: false,
      onViolation,
    })

    expect(allowed).toBe(false)
    expect(onViolation).toHaveBeenCalledOnce()
  })

  it('reports before it throws, so the development case is logged too', () => {
    const onViolation = vi.fn()

    expect(() =>
      guardArchetypeFeature(ARCHETYPES.umngcwabo, 'target', {
        throwOnViolation: true,
        onViolation,
      }),
    ).toThrow(ArchetypeGuardError)
    expect(onViolation).toHaveBeenCalledOnce()
  })

  it('permits what the archetype permits, without reporting anything', () => {
    const onViolation = vi.fn()

    expect(
      guardArchetypeFeature(ARCHETYPES.umshado, 'motion', {
        throwOnViolation: true,
        onViolation,
      }),
    ).toBe(true)
    expect(onViolation).not.toHaveBeenCalled()
  })
})

describe('mayRender — the guard as components call it', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('throws outside production, where a violation is somebody making a mistake', () => {
    vi.stubEnv('NODE_ENV', 'development')

    expect(() => mayRender(ARCHETYPES.umngcwabo, 'progressBar')).toThrow(
      ArchetypeGuardError,
    )
  })

  it('does not throw in production — it returns false and reports', () => {
    // A progress bar that silently fails to render on a funeral is a bug we
    // can live with. A 500 on the funeral page, for a family who have just
    // sent the link to fifty people, is not.
    vi.stubEnv('NODE_ENV', 'production')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(mayRender(ARCHETYPES.umngcwabo, 'progressBar')).toBe(false)
    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls[0]?.[1]).toEqual({
      archetype: 'umngcwabo',
      group: 'bereavement',
      feature: 'progressBar',
    })
  })

  it('lets a wedding have its progress bar', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(mayRender(ARCHETYPES.umshado, 'progressBar')).toBe(true)
  })
})
