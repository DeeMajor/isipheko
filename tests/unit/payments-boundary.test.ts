import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * CLAUDE.md rule 10, as a scan: **no domain, UI or database code names a
 * payment provider.**
 *
 * ESLint's `no-restricted-imports` already keeps `src/domain/` free of I/O and
 * of the other layers (M1-01 §4, `domain-boundary.test.ts`). What it cannot see
 * is a vendor's vocabulary spreading through code that is otherwise in the
 * right layer — a `pf_payment_id` in a repository, a `subaccount` on a copy
 * key, an `ACCT_` prefix in a UI component. Each of those would be a small,
 * reasonable-looking change that quietly makes the provider unswappable, which
 * is the thing rule 10 exists to prevent and the reason the regulatory position
 * being unresolved is survivable.
 *
 * **Comments are stripped before the scan**, the same as M3-08 §2's countdown
 * check: the reasoning about why PayFast is checkout-only lives in comments in
 * the domain and must go on doing so, and an explanation of an absence must not
 * satisfy a test looking for the absence.
 */

const VENDORS = /payfast|paystack|stitch|payshap|ozow|snapscan/i

/** Vendor names may appear in code only here. */
const ALLOWED = ['src/adapters/payments']

/**
 * One exception, and it is not a provider.
 *
 * `src/copy/contribute.ts` names **PayShap** — the rail a contributor uses from
 * her own banking app under Mode A. Nothing calls it, nothing integrates with
 * it, and it is on the page because it is what the organiser's number is for.
 * It is on this list rather than out of the pattern so that adding *PayFast* to
 * a copy file still fails.
 */
const COPY_EXCEPTIONS = ['src/copy/contribute.ts']

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(process.cwd(), directory), {
    withFileTypes: true,
  })

  const files: string[] = []

  for (const entry of entries) {
    const relative = path.posix.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(relative)))
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(relative)
    }
  }

  return files
}

/**
 * Block comments, line comments and JSDoc. Not a parser — it does not need to
 * be, because a false positive here is a string literal containing `//`, and
 * this scan is looking for identifiers.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('rule 10 — payment code lives behind the interface', () => {
  it('keeps every vendor name out of domain, db, ui and copy', async () => {
    const directories = ['src/domain', 'src/db', 'src/ui', 'src/copy']
    const offenders: string[] = []

    for (const directory of directories) {
      for (const file of await sourceFiles(directory)) {
        if (COPY_EXCEPTIONS.includes(file)) continue
        if (file.includes('/generated/')) continue

        const code = withoutComments(await readFile(file, 'utf8'))
        if (VENDORS.test(code)) offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps the adapter implementations out of everything but their own barrel', async () => {
    // `@/adapters/payments` is the door. Importing `payfast-provider.ts`
    // directly from a route would be the first step in a flow that knows which
    // provider it is talking to.
    const offenders: string[] = []

    for (const directory of ['src/app', 'src/lib', 'src/domain', 'src/db', 'src/ui']) {
      for (const file of await sourceFiles(directory)) {
        if (ALLOWED.some((allowed) => file.startsWith(allowed))) continue

        const code = await readFile(file, 'utf8')
        if (/from '.*(payfast|simulated)-(provider|signature)/.test(code)) {
          offenders.push(file)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('scans code and not the explanations of why the code is as it is', async () => {
    // The mechanism, proved rather than assumed. `src/domain/payments` quotes
    // PayFast's General Terms at length; if this scan read comments it would
    // fail on the very file that documents the constraint.
    const provider = await readFile(
      path.join(process.cwd(), 'src/domain/payments/provider.ts'),
      'utf8',
    )

    expect(VENDORS.test(provider)).toBe(true)
    expect(VENDORS.test(withoutComments(provider))).toBe(false)
  })
})
