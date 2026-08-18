import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ARCHETYPES } from '@/domain/archetype'

import {
  MIGRATION_PATH,
  buildArchetypeConstraintSql,
} from '../../scripts/archetype-constraint'

/**
 * The drift gate on generated output.
 *
 * docs/decisions.md M1-02 §12 asked for the SQL mapping to be generated from
 * the archetype config rather than written twice and tested for agreement.
 * This is not that second copy: the migration is generator output, and this
 * only proves the committed file is what the generator currently emits.
 *
 * Byte-identical, deliberately. A looser comparison — parsing the SQL, sorting
 * the arms, normalising whitespace — would let a hand-edit survive as long as
 * it happened to mean the same thing, which is exactly the habit the workflow
 * is trying to prevent.
 */
describe('the generated archetype constraint', () => {
  const committed = readFileSync(MIGRATION_PATH, 'utf8')

  it('matches the config it was generated from', () => {
    expect(committed).toBe(buildArchetypeConstraintSql())
    // If this failed: edit src/domain/archetype/archetypes.ts, run
    // `pnpm archetype:sql`, commit the migration. Do not edit the SQL.
  })

  it('maps every archetype, so no key can fall through the CASE', () => {
    // A CASE with a missing arm returns NULL, and `group = NULL` is NULL rather
    // than false — a CHECK constraint treats that as passing. A key left out
    // here would not fail loudly; it would quietly stop being constrained.
    for (const config of Object.values(ARCHETYPES)) {
      expect(committed).toContain(`WHEN '${config.key}'`)
      expect(committed).toMatch(
        new RegExp(`WHEN '${config.key}'\\s+THEN '${config.group}'`),
      )
    }
  })

  it('constrains both tables that carry an archetype', () => {
    expect(committed).toContain('ALTER TABLE "events"')
    expect(committed).toContain('ALTER TABLE "collections"')
    expect(committed).toContain('"events_archetype_matches_group"')
    expect(committed).toContain('"collections_archetype_matches_group"')
  })

  it('replaces the M1-02 constraints by name rather than adding a second one', () => {
    // Same names, dropped first. Two constraints with different names would
    // both be enforced, and a future correction would silently apply to one.
    expect(committed).toContain(
      'DROP CONSTRAINT IF EXISTS "events_archetype_matches_group"',
    )
    expect(committed).toContain(
      'DROP CONSTRAINT IF EXISTS "collections_archetype_matches_group"',
    )
  })

  it('says it is generated, at the top, where somebody about to edit it looks', () => {
    expect(committed.startsWith('-- GENERATED FILE — DO NOT EDIT.')).toBe(true)
  })
})
