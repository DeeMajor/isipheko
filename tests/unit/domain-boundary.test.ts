import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ESLint } from 'eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * CLAUDE.md rule 6 says `src/domain/` is pure and that ESLint enforces it. This
 * file is what makes that sentence true rather than aspirational — it runs the
 * real ESLint config against real files and asserts the rule fires.
 *
 * The probes are written to disk rather than linted as virtual text because
 * type-aware linting resolves each file through the TypeScript project service,
 * which only knows about files that exist. They are created and removed per
 * assertion, so neither `pnpm lint` nor `pnpm typecheck` ever sees them.
 */

let eslint: ESLint
let probeIndex = 0
const created = new Set<string>()

/**
 * Warmed here rather than paid for by whichever assertion runs first.
 *
 * The first `lintText` loads the whole config — Next's, typescript-eslint's,
 * and the TypeScript project service behind type-aware linting — which is
 * several seconds on a cold cache and more when the rest of the suite is
 * competing for the CPU. Landing that on test one made it fail on timeout while
 * the same file passed when run alone, which is the worst kind of red: it
 * teaches people to re-run rather than to look.
 */
beforeAll(async () => {
  eslint = new ESLint({ cwd: process.cwd() })
  await boundaryErrorsIn('src/domain', 'export {}')
}, 60_000)

afterAll(async () => {
  await Promise.all([...created].map((file) => rm(file, { force: true })))
})

async function boundaryErrorsIn(directory: string, source: string): Promise<string[]> {
  probeIndex += 1
  const file = path.join(process.cwd(), directory, `__boundary_probe_${probeIndex}__.ts`)
  created.add(file)

  await writeFile(file, source, 'utf8')
  try {
    const [result] = await eslint.lintText(source, { filePath: file, warnIgnored: false })
    return (result?.messages ?? [])
      .filter((message) => message.ruleId === 'no-restricted-imports')
      .map((message) => message.message)
  } finally {
    await rm(file, { force: true })
    created.delete(file)
  }
}

const fromDomain = (source: string) => boundaryErrorsIn('src/domain', source)
const fromLib = (source: string) => boundaryErrorsIn('src/lib', source)

describe('src/domain may not import the outer layers', () => {
  const aliased = [
    '@/app/page',
    '@/adapters/payments/stitch',
    '@/db/client',
    '@/db/repositories/ledger',
  ]

  it.each(aliased)('rejects the aliased import %s', async (specifier) => {
    expect(await fromDomain(`import '${specifier}'`)).not.toHaveLength(0)
  })

  // The loophole that gets used by accident. An editor auto-import writes this
  // form without being asked, and it reads as innocuous in review.
  const relative = [
    '../app/page',
    '../../app/(public)/page',
    '../../../app/api/claim/route',
    '../adapters/payments/stitch',
    '../../adapters/identity/verifynow',
    '../db/client',
    '../../db/repositories/ledger',
    '../../../db/client',
  ]

  it.each(relative)('rejects the relative escape %s', async (specifier) => {
    expect(await fromDomain(`import '${specifier}'`)).not.toHaveLength(0)
  })

  it('explains why, and points at the rule', async () => {
    const [message] = await fromDomain("import '../db/client'")

    expect(message).toContain('CLAUDE.md rule 6')
    expect(message).toContain('swappable')
  })
})

describe('src/domain may not import a framework or an ORM', () => {
  const forbidden = ['next', 'next/server', 'react', 'react-dom', '@prisma/client']

  it.each(forbidden)('rejects %s', async (specifier) => {
    expect(await fromDomain(`import '${specifier}'`)).not.toHaveLength(0)
  })

  // Rule 6 says "no Prisma types", not "no Prisma values". A type-only import
  // still couples the business rules to the database schema.
  it('rejects a type-only Prisma import', async () => {
    const errors = await fromDomain(
      "import type { Event } from '@prisma/client'\nexport type E = Event",
    )

    expect(errors).not.toHaveLength(0)
  })
})

describe('src/domain performs no I/O', () => {
  it.each(['fs', 'node:fs', 'node:fs/promises', 'node:child_process', 'node:net'])(
    'rejects %s',
    async (specifier) => {
      expect(await fromDomain(`import '${specifier}'`)).not.toHaveLength(0)
    },
  )

  // The ledger hash chain (docs/architecture.md §4.3) is domain logic and needs
  // SHA-256. Blocking it would push the chain out of the layer that owns it.
  it('allows node:crypto', async () => {
    expect(await fromDomain("import 'node:crypto'")).toHaveLength(0)
  })
})

describe('the rule is scoped, not global', () => {
  it('allows pure dependencies and intra-domain imports', async () => {
    const errors = await fromDomain(
      ["import 'zod'", "import './money'", "import '@/domain/money'"].join('\n'),
    )

    expect(errors).toHaveLength(0)
  })

  // Positive control. Without this, a rule that accidentally matched every file
  // would still pass every assertion above.
  it.each(['@/db/client', '../db/client', 'next/server', '@prisma/client'])(
    'permits %s outside src/domain',
    async (specifier) => {
      expect(await fromLib(`import '${specifier}'`)).toHaveLength(0)
    },
  )
})
