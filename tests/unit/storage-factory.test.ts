import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LocalObjectStore, objectStore } from '@/adapters/storage'

/**
 * OPS-09 — the store refuses in production, like its five siblings.
 *
 * It did not. `objectStore()` was the one provider factory that logged a
 * warning and carried on with the local store, and the reason was written down:
 * *"a missing OG cache costs a redraw, not a person waiting for a code that
 * never comes."*
 *
 * **That was true of an OG card and stopped being true at M4-01.** A
 * contributor's photograph goes into the same store, and M4-01 §5 keeps no
 * original — only the four re-encodes exist, because keeping the source would
 * keep its GPS with it. M4-03 then added album PDFs.
 *
 * So the fallback no longer costs a redraw. It costs a photograph somebody
 * attached to a funeral: written to one container's disk, unreadable from every
 * other instance, and gone on the next deploy — weeks after the single warning
 * line that was supposed to prevent it.
 */

describe('objectStore', () => {
  it('is the local store in development and test', () => {
    expect(objectStore('development')).toBeInstanceOf(LocalObjectStore)
    expect(objectStore('test')).toBeInstanceOf(LocalObjectStore)
  })

  it('throws in production rather than falling back to local disk', () => {
    expect(() => objectStore('production')).toThrow(/object storage is configured/i)
  })

  it('says what the fallback would cost, not only that it refused', () => {
    // The security-copy rule applied to an error message: an operator who reads
    // "not configured" reaches for the quickest way to make it start again, and
    // on this one the quickest way loses somebody's photograph.
    expect(() => objectStore('production')).toThrow(/photograph/i)
    expect(() => objectStore('production')).toThrow(/af-south-1/)
  })

  it('warns nobody, because a warning was the bug', () => {
    /*
     * The mutation check for this task's guard, and it is a source assertion
     * rather than a behavioural one on purpose: a `console.warn` restored
     * beside the throw would pass every test above while re-teaching the next
     * reader that carrying on is an option.
     */
    const source = readFileSync(
      fileURLToPath(new URL('../../src/adapters/storage/index.ts', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')

    expect(source).not.toContain('console.warn')
    expect(source).toContain('throw new Error')
  })
})

describe('the variable it reads is declared', () => {
  it('OBJECT_STORE_DIR is in the environment schema', () => {
    /*
     * It was read from `process.env` and declared nowhere, which exempted it
     * from M1-01's guarantee that a missing or malformed value is a refusal to
     * start rather than a surprise later. Optional is fine — undeclared is not.
     */
    const env = readFileSync(
      fileURLToPath(new URL('../../src/lib/env.ts', import.meta.url)),
      'utf8',
    )

    expect(env).toContain('OBJECT_STORE_DIR')
  })

  it('reads no other variable the schema has never heard of', () => {
    /*
     * The general form of the bug, which is what makes this worth a test rather
     * than a one-line fix. Anything the application reads from `process.env`
     * outside `env.ts` has to be a name the schema knows, or M1-01's boot guard
     * is covering less than it says it does.
     *
     * `NODE_ENV` is exempt: every factory takes it as an argument and the
     * schema declares it anyway.
     */
    const read = new Set<string>()
    const files = import.meta.glob('../../src/**/*.{ts,tsx}', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>

    for (const [path, text] of Object.entries(files)) {
      if (path.includes('/lib/env.ts')) continue
      for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        if (match[1] !== undefined && match[1] !== 'NODE_ENV') read.add(match[1])
      }
    }

    const schema = readFileSync(
      fileURLToPath(new URL('../../src/lib/env.ts', import.meta.url)),
      'utf8',
    )

    expect(read.size).toBeGreaterThan(0)
    for (const name of read) {
      expect(schema, `${name} is read but not declared`).toContain(`${name}:`)
    }
  })
})
