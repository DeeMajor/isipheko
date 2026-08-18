import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

/**
 * The one-time code must not reach a log. Anywhere. In any environment.
 *
 * This is a source scan rather than a behavioural test on purpose: the failure
 * it guards against is somebody adding a `console.log` while debugging a
 * delivery problem, which is exactly when it feels reasonable and exactly when
 * the code is most likely to end up in an aggregator, a screen share, or an
 * issue. A runtime test would pass on the day it was written and say nothing
 * about the day after.
 *
 * The same applies to the phone number, which is personal information
 * (CLAUDE.md rule 8).
 */

const AUTH_PATHS = [
  'src/domain/auth',
  'src/domain/messaging',
  'src/adapters/messaging',
  'src/db/repositories/auth.ts',
  'src/lib/session.ts',
  'src/lib/audit.ts',
  'src/app/(auth)',
  'src/copy/auth.ts',
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

const SOURCES = AUTH_PATHS.flatMap(filesUnder)

/**
 * The files a one-time code actually passes through.
 *
 * `domain/messaging` and `adapters/messaging` hold the notification senders
 * since M2-08, and those legitimately say "WhatsApp" — so the WhatsApp
 * assertion below reads this narrower list, which is the OTP path itself plus
 * the SMS sender it uses.
 */
const OTP_SOURCES = SOURCES.filter(
  ({ path }) =>
    !/messaging\/(?!sms|in-memory-sms)/.test(path) ||
    path.endsWith('sms.ts') ||
    path.endsWith('in-memory-sms.ts'),
)

/** Comments explain what must not be logged; they are not the thing itself. */
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the auth path', () => {
  it('covers the files it claims to', () => {
    // If a rename silently emptied this list, every assertion below would pass
    // while checking nothing.
    expect(SOURCES.length).toBeGreaterThanOrEqual(10)
  })

  it('calls no logging function at all', () => {
    // Not "does not log the code" — does not log. A `console.error(error)` in a
    // catch around the verify step prints whatever the error carried, and the
    // point of failure is the one place somebody is tempted to include the
    // input that caused it.
    for (const { path, text } of SOURCES) {
      const source = withoutComments(text)

      expect(source, path).not.toMatch(/\bconsole\s*\./)
      expect(source, path).not.toMatch(/\blogger\s*\./)
      expect(source, path).not.toMatch(/process\.stdout|process\.stderr/)
    }
  })

  it('never puts the code anywhere but the SMS body', () => {
    const codeUsers = SOURCES.filter(({ text }) => /\bcode\b/.test(withoutComments(text)))
    expect(codeUsers.length).toBeGreaterThan(0)

    for (const { path, text } of SOURCES) {
      const source = withoutComments(text)

      // Not into a redirect, a URL or a response body. The pattern looks for
      // the *value* — an interpolation or a concatenation — so that the literal
      // `?step=code` in the sign-in URL, which names a step rather than
      // carrying one, is not mistaken for a leak.
      expect(source, path).not.toMatch(/redirect\([^)]*\$\{[^}]*\bcode\b/)
      expect(source, path).not.toMatch(/redirect\([^)]*\+\s*code\b/)
      expect(source, path).not.toMatch(/searchParams\.set\(\s*['"]code['"]/)
      expect(source, path).not.toMatch(/throw new Error\([^)]*\$\{\s*code\s*\}/)
    }
  })

  it('never writes the code to the database in the clear', () => {
    const repository = SOURCES.find(({ path }) =>
      path.endsWith('db/repositories/auth.ts'),
    )
    expect(repository).toBeDefined()

    const source = withoutComments(repository?.text ?? '')

    // The only thing that reaches a `data:` block is the HMAC.
    expect(source).toContain('codeHash: hashOtpCode(code, pepper)')
    expect(source).not.toMatch(/code(?!Hash)\s*[,:]\s*code\b/)
  })

  it('never sends a one-time code over WhatsApp', () => {
    /*
     * Architecture §8.1: South Africa is on Meta's authentication-international
     * tier and the rate is significantly higher. SMS is the design decision,
     * not a placeholder waiting to be upgraded.
     *
     * **Narrowed in M2-08.** This used to scan every file under
     * `domain/messaging` and `adapters/messaging` for the word, which worked
     * while messaging meant SMS and stopped meaning anything the moment
     * notifications arrived in the same directories. What has to be true is
     * about the OTP path, not about a folder: the files that carry a code
     * never mention WhatsApp, and never reach for its sender.
     */
    expect(OTP_SOURCES.length).toBeGreaterThanOrEqual(6)

    for (const { path, text } of OTP_SOURCES) {
      expect(withoutComments(text).toLowerCase(), path).not.toContain('whatsapp')
    }
  })

  it('reaches for the SMS sender and no other', () => {
    const signIn = SOURCES.find(({ path }) => path.endsWith('sign-in/actions.ts'))
    expect(signIn).toBeDefined()

    const source = withoutComments(signIn?.text ?? '')

    expect(source).toContain('smsSender(')
    expect(source).not.toContain('whatsAppSender')
    expect(source).not.toContain('emailSender')
  })
})

describe('the phone number', () => {
  it('reaches the audit log only as a hash', () => {
    const audit = SOURCES.find(({ path }) => path.endsWith('lib/audit.ts'))
    expect(audit).toBeDefined()

    const source = withoutComments(audit?.text ?? '')

    expect(source).toContain('phoneHash: hashPhone(phoneE164, env.OTP_PEPPER)')
    // No path that writes the raw number into a row.
    expect(source).not.toMatch(/phoneE164\s*[,:]\s*phoneE164/)
    expect(source).not.toMatch(/metadata:\s*\{[^}]*\bphoneE164\b/)
  })

  it('is never put in a URL', () => {
    // A number in a query string is in the access log, in the Referer header of
    // anything the page loads, and in the history of a borrowed phone. It
    // travels in an httpOnly cookie instead.
    for (const { path, text } of SOURCES) {
      const source = withoutComments(text)

      expect(source, path).not.toMatch(/redirect\([^)]*phoneE164/)
      expect(source, path).not.toMatch(/[?&]phone=\$\{/)
    }
  })
})
