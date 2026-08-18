import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import { ARCHETYPES } from '@/domain/archetype'
import type { PrismaClient } from '@/db/generated/client'

import { clientFor } from '../setup/prisma'

/**
 * Closes the loop from the archetype config to the live database.
 *
 * `tests/unit/archetype-constraint.test.ts` proves the committed migration is
 * what the generator emits. This proves the migration actually ran and that
 * what Postgres is enforcing is the mapping in `ARCHETYPES` — read back out of
 * `pg_get_constraintdef`, not out of the file that claims to have created it.
 *
 * Without this, a generated migration that was never applied — or applied and
 * then dropped by something later — would look identical from the unit tests.
 */

let prisma: PrismaClient

beforeAll(() => {
  prisma = clientFor(inject('appDatabaseUrl'))
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function definitionOf(name: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ definition: string }[]>`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname = ${name}
  `

  expect(rows).toHaveLength(1)
  return rows[0]?.definition ?? ''
}

describe.each([
  ['events_archetype_matches_group', 'archetype'],
  ['collections_archetype_matches_group', 'occasion_archetype'],
])('%s is enforcing the archetype config', (name, keyColumn) => {
  it('exists exactly once, on the expected column', async () => {
    // Twice would mean the generated migration added a second constraint beside
    // the M1-02 one rather than replacing it, and a future correction would
    // then apply to only one of them.
    const definition = await definitionOf(name)
    expect(definition).toContain(keyColumn)
  })

  it.each(Object.values(ARCHETYPES))('maps $key to $group', async (config) => {
    const definition = await definitionOf(name)
    expect(definition).toMatch(
      new RegExp(`WHEN '${config.key}'.*THEN '${config.group}'`, 'is'),
    )
  })

  it('treats exactly one archetype as bereavement', async () => {
    const definition = await definitionOf(name)
    const bereavementArms = definition.match(/THEN 'bereavement'/g) ?? []

    expect(bereavementArms).toHaveLength(1)
    expect(definition).toMatch(/WHEN 'umngcwabo'.*THEN 'bereavement'/is)
  })
})
