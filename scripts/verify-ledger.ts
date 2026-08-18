/**
 * Re-verifies every hash chain in the system.
 *
 * Architecture §13 runs this nightly with a hard alert on any mismatch, and
 * §4.3 is what it is checking: altering any historic entry breaks every hash
 * after it, so this is the thing that turns *"nobody, including us, can quietly
 * change this record"* from a claim into an observation.
 *
 * It connects as **isipheko_app**, the role the application uses, which holds
 * SELECT and INSERT and neither UPDATE nor DELETE. A verifier that needed
 * elevated privileges to read the ledger would be a second way in.
 *
 * **It prints no amounts, no names and no descriptions.** Its output goes to
 * build logs and alerts — widely readable, long-lived — and a bereavement event
 * hides amounts so a grieving family is not ranked by them. A chain id, a
 * sequence number and which hash disagreed is enough to investigate.
 *
 * Exit codes: 0 every chain verified, 1 at least one chain has a problem.
 *
 * Run: `pnpm verify:ledger`
 */

import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../src/db/generated/client.ts'
// The same repository the application appends through, so the verifier reads
// the chain by exactly the code that wrote it.
import {
  chainId,
  chainsWithEntries,
  entriesForChain,
} from '../src/db/repositories/ledger.ts'
import { describeProblem, verifyChain } from '../src/domain/ledger/index.ts'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://isipheko_app:isipheko_local_dev@localhost:5433/isipheko'

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  })

  try {
    const chains = await chainsWithEntries(prisma)

    let entries = 0
    let broken = 0

    for (const chain of chains) {
      const id = chainId(chain)
      const report = verifyChain(id, await entriesForChain(prisma, chain))
      entries += report.entryCount

      if (report.problems.length === 0) continue

      broken += 1
      process.stdout.write(
        `\nchain ${id} — ${String(report.problems.length)} problem(s)\n`,
      )
      for (const problem of report.problems) {
        process.stdout.write(`  ${describeProblem(problem)}\n`)
      }
    }

    process.stdout.write(
      `\n${String(chains.length)} chain(s), ${String(entries)} entries, ` +
        `${String(broken)} with problems.\n`,
    )

    if (broken > 0) {
      process.stderr.write(
        '\nThe ledger has been altered outside the application.\n\n' +
          'The application role cannot UPDATE or DELETE a ledger entry, so this did not\n' +
          'come from the running system. Do not "fix" the hashes — they are the evidence.\n' +
          'Corrections are reversal entries (CLAUDE.md rule 3).\n',
      )
      process.exitCode = 1
      return
    }

    process.stdout.write('Every chain verifies.\n')
  } finally {
    await prisma.$disconnect()
  }
}

await main()
