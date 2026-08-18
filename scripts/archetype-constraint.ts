/**
 * Generates the archetype→group CHECK constraints from `ARCHETYPES`.
 *
 * docs/decisions.md M1-02 §12: the mapping was written by hand in the M1-02
 * migration and would have been written by hand a second time in the archetype
 * config. A test asserting the two agree only helps once somebody has written
 * the test and only when it is run. Generating one from the other makes them
 * incapable of disagreeing.
 *
 * That matters more here than it usually would, because the fact that drifts is
 * *which archetypes count as bereavement*, and the consequence of getting it
 * wrong is a progress bar on a funeral.
 *
 * **Workflow — do not hand-edit the generated migration.**
 *
 *   1. edit `src/domain/archetype/archetypes.ts`
 *   2. `pnpm archetype:sql` — rewrites the migration below
 *   3. commit it
 *
 * `tests/unit/archetype-constraint.test.ts` fails if the committed file is not
 * byte-identical to what this emits, so step 2 cannot be skipped quietly.
 *
 * **Adding an archetype needs a new migration, not this one.** Prisma
 * checksums applied migrations; rewriting one that has run breaks every
 * database it has run on. Change MIGRATION_DIR to a new timestamped directory,
 * then generate.
 *
 * Run: `node --experimental-strip-types scripts/archetype-constraint.ts`
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ARCHETYPES } from '../src/domain/archetype/archetypes.ts'

const MIGRATION_DIR = '20260816090000_archetype_group_mapping_generated'

export const MIGRATION_PATH = fileURLToPath(
  new URL(`../prisma/migrations/${MIGRATION_DIR}/migration.sql`, import.meta.url),
)

/** `("archetype_key", "archetype_group")` pairs, in declaration order. */
function mapping(): readonly (readonly [string, string])[] {
  return Object.values(ARCHETYPES).map((config) => [config.key, config.group])
}

function caseExpression(keyColumn: string, indent: string): string {
  const pairs = mapping()
  const width = Math.max(...pairs.map(([key]) => key.length))

  const arms = pairs.map(
    ([key, group]) =>
      `${indent}  WHEN '${key}'${' '.repeat(width - key.length)} THEN '${group}'::"archetype_group"`,
  )

  return [`CASE "${keyColumn}"`, ...arms, `${indent}END`].join('\n')
}

function constraint(
  table: string,
  name: string,
  groupColumn: string,
  keyColumn: string,
): string {
  return [
    `ALTER TABLE "${table}"`,
    `  DROP CONSTRAINT IF EXISTS "${name}";`,
    '',
    `ALTER TABLE "${table}"`,
    `  ADD CONSTRAINT "${name}"`,
    `  CHECK ("${groupColumn}" = ${caseExpression(keyColumn, '  ')});`,
  ].join('\n')
}

export function buildArchetypeConstraintSql(): string {
  return `${[
    '-- GENERATED FILE — DO NOT EDIT.',
    '--',
    '-- Written by scripts/archetype-constraint.ts from the archetype config in',
    '-- src/domain/archetype/archetypes.ts. Edit the config, run `pnpm archetype:sql`,',
    '-- commit the result. A unit test fails if this file and the config disagree.',
    '--',
    '-- Why generated: `archetype_group` is denormalised because a CHECK constraint',
    '-- cannot perform a lookup, and CLAUDE.md rule 1 — no target on a bereavement',
    '-- event — has to be enforceable in pure SQL. A denormalised column allowed to',
    '-- disagree with its source is worse than no column: it would let an event claim',
    '-- to be a wedding while carrying the funeral group, or the reverse, which hands',
    '-- a bereaved family a progress bar.',
    '--',
    '-- M1-02 wrote this mapping by hand and M1-04 would have written it by hand a',
    '-- second time. Generation removes the second copy rather than testing that the',
    '-- two copies agree (docs/decisions.md M1-02 §12).',
    '--',
    '-- The constraints below replace the identically-named ones added by',
    '-- 20260807235900_constraints_and_grants. That migration has been applied and',
    '-- cannot be edited — Prisma checksums it — so the replacement is a new',
    '-- migration. It is a no-op today by construction: the generated mapping is the',
    '-- same mapping. From here it is generated, and that is the point.',
    '',
    constraint(
      'events',
      'events_archetype_matches_group',
      'archetype_group',
      'archetype',
    ),
    '',
    constraint(
      'collections',
      'collections_archetype_matches_group',
      'occasion_archetype_group',
      'occasion_archetype',
    ),
  ].join('\n')}\n`
}

const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isCli) {
  writeFileSync(MIGRATION_PATH, buildArchetypeConstraintSql(), 'utf8')
  process.stdout.write(`wrote ${MIGRATION_PATH}\n`)
}
