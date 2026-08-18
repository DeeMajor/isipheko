import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  InMemoryIdentityVerifier,
  clearIdentityStore,
  rawVendorResponses,
} from '@/adapters/identity'

/**
 * **M3-01's done criterion: no plaintext ID number and no image reaches storage
 * or logs.**
 *
 * It is tested in two halves, because either half alone would be worth little.
 *
 * The **behavioural** half drives a provider response that genuinely carries a
 * photograph and a plaintext ID number — the in-memory verifier builds one on
 * purpose — and asserts neither survives the adapter boundary. Without a
 * hostile payload the assertion would be vacuous: of course nothing leaked, if
 * nothing was there.
 *
 * The **source-scan** half is the M1-06 §7 posture. Not "does not log the
 * number" — *does not log*. The failure to guard against is somebody adding a
 * `console.error(error)` while debugging a provider problem, which is precisely
 * when it feels reasonable and precisely when the argument being logged is an
 * identity document. A behavioural test would pass on the day it was written
 * and say nothing about the day after.
 *
 * **What this criterion does and does not cover today, stated plainly:** no
 * image reaches storage or logs because **no image is ever captured**. No selfie
 * step exists, and whether one is needed depends on a vendor nobody has chosen
 * (Part J item 2) — VerifyNow and Datanamix return the Home Affairs photograph
 * for us to compare, Didit does the comparison inside its own hosted flow. If
 * the vendor chosen requires capture, this criterion has to be **earned again**
 * in the task that builds it. It does not inherit from here.
 */

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

const IDENTITY_PATHS = [
  'src/domain/identity',
  'src/adapters/identity',
  'src/db/repositories/identity.ts',
  'src/lib/identity.ts',
  'src/copy/verify.ts',
  'src/app/(organiser)/verify',
]

function filesUnder(path: string): readonly { path: string; text: string }[] {
  const absolute = root(path)

  if (absolute.endsWith('.ts') || absolute.endsWith('.tsx')) {
    return [{ path, text: readFileSync(absolute, 'utf8') }]
  }

  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => ({
      path: `${entry.parentPath}/${entry.name}`,
      text: readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8'),
    }))
}

const SOURCES = [
  ...IDENTITY_PATHS.flatMap(filesUnder),
  ...filesUnder('src/app/(organiser)/create/[id]/verify/page.tsx'),
]

/**
 * Comments are stripped before every scan. This file, the adapter and the
 * migration all quote the forbidden words while explaining them — the same
 * treatment `tokens.test.ts` gives the accent literals.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const CODE = SOURCES.map(({ path, text }) => ({ path, text: stripComments(text) }))

describe('the identity path writes nothing anywhere', () => {
  it('has files to scan, so a moved directory fails loudly', () => {
    expect(SOURCES.length).toBeGreaterThan(8)
  })

  it('never logs', () => {
    // Not "never logs the number" — never logs. See the note above.
    for (const { path, text } of CODE) {
      expect(`${path}: ${String(/\bconsole\s*\./.test(text))}`).toBe(`${path}: false`)
      expect(`${path}: ${String(/\blogger\s*\./.test(text))}`).toBe(`${path}: false`)
      expect(`${path}: ${String(/process\.(stdout|stderr)/.test(text))}`).toBe(
        `${path}: false`,
      )
    }
  })

  it('never reaches object storage', () => {
    // The only thing that would go there is an image, and there is no image.
    for (const { path, text } of CODE) {
      expect(
        `${path}: ${String(/objectStore|ObjectStore|domain\/storage/.test(text))}`,
      ).toBe(`${path}: false`)
    }
  })

  it('gives the outcome types nowhere to put an image', () => {
    // Structural, not a convention: an adapter that receives a Home Affairs
    // photograph has no field to assign it to, so it has to drop it rather than
    // remember to (§7.3).
    const verifier = CODE.find(({ path }) => path.endsWith('verifier.ts'))
    expect(verifier).toBeDefined()

    expect(verifier?.text).not.toMatch(/photo|image|selfie|Uint8Array|Buffer|base64/i)
  })

  it('never puts the number in a redirect', () => {
    // Errors travel back as codes from a fixed set (M1-06 §10), which is what
    // makes the flow work with JavaScript off and what makes it impossible for
    // an ID number to end up in a URL, browser history or a Referer header.
    const action = CODE.find(({ path }) => path.endsWith('verify/actions.ts'))
    expect(action).toBeDefined()

    for (const line of (action?.text ?? '').split('\n')) {
      if (!line.includes('redirect(')) continue
      expect(line).not.toMatch(/idNumber|claimedName/)
    }
  })

  it('asks for the number in a form post and never in a GET', () => {
    const panel = SOURCES.find(({ path }) => path.endsWith('verify-panel.tsx'))
    expect(panel?.text).toContain('name="idNumber"')
    // A `method="get"` form carrying this field would put thirteen digits in the
    // address bar of a borrowed phone.
    expect(panel?.text).not.toMatch(/method="get"[\s\S]{0,400}name="idNumber"/)
  })

  it('hashes before it stores, and the repository never sees plaintext', () => {
    const repository = CODE.find(({ path }) => path.endsWith('repositories/identity.ts'))

    expect(repository?.text).not.toMatch(/\bidNumber\b(?!Hash)/)
    expect(repository?.text).toContain('idNumberHash')
  })

  it('keeps the plaintext to one file', () => {
    // `src/lib/identity.ts` is where it exists, as a function argument, for the
    // length of one provider call.
    const holders = CODE.filter(({ text }) => /\bidNumberInput\b/.test(text)).map(
      ({ path }) => path,
    )

    expect(holders).toEqual([
      expect.stringContaining('lib/identity.ts'),
      expect.stringContaining('verify/actions.ts'),
    ])
  })
})

describe('the adapter boundary drops what a provider hands back', () => {
  const ID_NUMBER = '5306075800082'

  it('is given a payload that really does carry a photograph and the number', async () => {
    clearIdentityStore()
    const verifier = new InMemoryIdentityVerifier()

    const started = await verifier.start({
      idNumber: ID_NUMBER,
      claimedName: 'J Clegg',
      nonce: 'hostile',
    })
    if (started.kind !== 'inline') throw new Error('expected an inline start')

    await verifier.poll(started.outcome.reference)

    const raw = rawVendorResponses()
    expect(raw.length).toBeGreaterThan(0)
    expect(raw.some((response) => response.photoBase64 !== null)).toBe(true)
    expect(raw.some((response) => response.idNumber === ID_NUMBER)).toBe(true)
  })

  it('returns an outcome carrying neither', async () => {
    clearIdentityStore()
    const verifier = new InMemoryIdentityVerifier()

    const started = await verifier.start({
      idNumber: ID_NUMBER,
      claimedName: 'J Clegg',
      nonce: 'hostile-2',
    })
    if (started.kind !== 'inline') throw new Error('expected an inline start')

    const outcome = await verifier.poll(started.outcome.reference)
    const serialised = JSON.stringify(outcome)

    expect(serialised).not.toContain(ID_NUMBER)
    expect(serialised).not.toContain(Buffer.from('not-a-real-photo').toString('base64'))
    expect(serialised).not.toMatch(/photo|image|selfie/i)
  })

  it('carries only booleans and nulls in what does survive', async () => {
    // `checks` is the one field written to a JSONB column. A provider payload
    // smuggled in there would be the leak this whole test exists to prevent.
    clearIdentityStore()
    const verifier = new InMemoryIdentityVerifier()

    const started = await verifier.start({
      idNumber: '5306070000084',
      claimedName: 'J Clegg',
      nonce: 'checks',
    })
    if (started.kind !== 'inline' || started.outcome.status !== 'verified') {
      throw new Error('expected an inline verified start')
    }

    for (const value of Object.values(started.outcome.checks)) {
      expect(typeof value === 'boolean' || value === null).toBe(true)
    }
  })
})
