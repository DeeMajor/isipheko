import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { AUDIT_ACTIONS, RESERVED_PAYOUT_ACTIONS, isAuditAction } from '@/domain/audit'

/**
 * The audit taxonomy, and what the call sites are allowed to put in a row
 * (M3-07).
 *
 * **A source scan, like `auth-no-code-in-logs` and `identity-no-pii`.** The
 * failure this guards against is not a wrong return value — it is somebody
 * adding a field to a metadata object because it would be useful while
 * debugging, which is exactly when it feels reasonable and exactly when the
 * field is a phone number. A behavioural test would pass on the day it was
 * written and say nothing about the day after.
 */

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

const AUDIT_PATHS = [
  'src/domain/audit',
  'src/db/repositories/audit.ts',
  'src/lib/audit.ts',
  'src/lib/admin.ts',
  'src/app/(admin)',
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

const SOURCES = AUDIT_PATHS.flatMap(filesUnder)

/** Comments explain what must not be logged; they are not the thing itself. */
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every `metadata: { … }` literal written anywhere in the product. */
function metadataLiterals(): readonly { path: string; body: string }[] {
  const all = readdirSync(root('src'), { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(ts|tsx)$/.test(entry.name) &&
        !entry.parentPath.includes('generated'),
    )
    .map((entry) => ({
      path: `${entry.parentPath}/${entry.name}`,
      text: withoutComments(readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8')),
    }))

  return all.flatMap(({ path, text }) =>
    [...text.matchAll(/metadata:\s*\{([^}]*)\}/g)].map((match) => ({
      path,
      body: match[1] ?? '',
    })),
  )
}

describe('the taxonomy', () => {
  it('lists every action exactly once', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
  })

  it('namespaces every action', () => {
    // `auth.otp.requested`, not `otp_requested`. The prefix is what makes the
    // log queryable by area three years from now.
    for (const action of AUDIT_ACTIONS) {
      expect(action, action).toMatch(/^[a-z]+(\.[a-z_]+)+$/)
    }
  })

  it('covers the five areas the done-criterion names, less the one that cannot exist', () => {
    const areas = new Set(AUDIT_ACTIONS.map((action) => action.split('.')[0]))

    expect(areas).toContain('auth')
    expect(areas).toContain('event')
    expect(areas).toContain('contribution')
    expect(areas).toContain('report')
    // And the review screen itself, because reading a queue of reports is a
    // security-relevant action too.
    expect(areas).toContain('admin')
  })

  it('recognises its own strings and nothing else', () => {
    expect(isAuditAction('event.published')).toBe(true)
    expect(isAuditAction('event.unpublished')).toBe(false)
    expect(isAuditAction('')).toBe(false)
  })
})

describe('the payout hook', () => {
  /*
   * Mode B is Milestone 5 and is gated on the legal opinion (architecture §15
   * item 1). There is no payout to request today, so the names are reserved and
   * documented and **nothing writes them** — a logger for an action nobody can
   * take is dead code wearing the appearance of a reviewed control.
   */
  it('reserves the names without admitting them to the union', () => {
    expect(RESERVED_PAYOUT_ACTIONS).toContain('payout.requested')

    for (const reserved of RESERVED_PAYOUT_ACTIONS) {
      expect(isAuditAction(reserved), reserved).toBe(false)
      expect(AUDIT_ACTIONS as readonly string[]).not.toContain(reserved)
    }
  })

  it('has no writer', () => {
    for (const { path, text } of SOURCES) {
      expect(withoutComments(text), path).not.toMatch(/recordPayout/)
    }
  })

  it('says where it attaches, so the hook is documented rather than merely intended', () => {
    const taxonomy = SOURCES.find(({ path }) => path.endsWith('audit/actions.ts'))
    expect(taxonomy).toBeDefined()

    const text = taxonomy?.text ?? ''
    expect(text).toContain('Milestone 5')
    expect(text).toContain('payout.requested')
  })
})

describe('nothing personal reaches a row', () => {
  it('scans a real set of metadata literals', () => {
    // Without this, a rename emptying the scan would make every assertion below
    // pass while checking nothing.
    expect(metadataLiterals().length).toBeGreaterThanOrEqual(6)
  })

  it('never puts a number, an ID or an account in metadata', () => {
    for (const { path, body } of metadataLiterals()) {
      expect(body, path).not.toMatch(/\bphoneE164\b/)
      expect(body, path).not.toMatch(/\bidNumber\b/)
      expect(body, path).not.toMatch(/\baccountNumber\b/)
      // The words somebody typed into a report. The log is exported, shipped
      // and kept far longer than the row it describes.
      expect(body, path).not.toMatch(/\bdetail\b/)
      expect(body, path).not.toMatch(/\baboutTyped\b/)
    }
  })

  it('reaches the log with the phone only as a hash', () => {
    const audit = SOURCES.find(({ path }) => path.endsWith('lib/audit.ts'))
    const source = withoutComments(audit?.text ?? '')

    expect(source).toContain('phoneHash: hashPhone(phoneE164, env.OTP_PEPPER)')
    expect(source).not.toMatch(/phoneE164\s*[,:]\s*phoneE164/)
  })

  it('logs nothing to a console anywhere on this path', () => {
    for (const { path, text } of SOURCES) {
      const source = withoutComments(text)

      expect(source, path).not.toMatch(/\bconsole\s*\./)
      expect(source, path).not.toMatch(/process\.stdout|process\.stderr/)
    }
  })
})

describe('the review screen', () => {
  it('never writes to an event, a collection or a contribution', () => {
    /*
     * The standing rule (docs/decisions.md M3-06 §1) one layer along. M3-06
     * proved a *report* does nothing to an event; the obvious next hole is
     * triage doing it instead, because that is the human decision and letting
     * it write through would be one line. An integration test asserts the row
     * is byte-identical; this asserts the code to do it is not there at all.
     */
    const admin = SOURCES.filter(({ path }) => path.includes('(admin)'))
    expect(admin.length).toBeGreaterThanOrEqual(4)

    for (const { path, text } of admin) {
      const source = withoutComments(text)

      expect(source, path).not.toMatch(/prisma\.event\.(update|delete|upsert)/)
      expect(source, path).not.toMatch(/prisma\.collection\.(update|delete|upsert)/)
      expect(source, path).not.toMatch(/prisma\.contribution\.(update|delete)/)
      expect(source, path).not.toMatch(/\bunpublish|\bhideEvent|\bflagEvent/)
    }
  })

  it('shows the reporter a number on one screen only', () => {
    const detail = SOURCES.find(({ path }) => path.includes('review/[id]/page.tsx'))
    const list = SOURCES.find(({ path }) => path.endsWith('review/page.tsx'))

    expect(withoutComments(detail?.text ?? '')).toContain('reporterPhoneE164')
    expect(withoutComments(list?.text ?? '')).not.toContain('reporterPhoneE164')
  })

  it('exports only the two triage actions from the server-action module', () => {
    // Every export from a `'use server'` module is a callable endpoint. A
    // helper taking an actor id as an argument would be a way for anybody to
    // write an audit row in somebody else's name.
    const actions = SOURCES.find(({ path }) => path.endsWith('review/actions.ts'))
    const exported = [
      ...withoutComments(actions?.text ?? '').matchAll(
        /export\s+async\s+function\s+(\w+)/g,
      ),
    ].map((match) => match[1])

    expect(exported).toEqual(['startReading', 'closeReport'])
  })
})
