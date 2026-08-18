import { describe, expect, it } from 'vitest'

import { withFormErrors } from '@/app/(organiser)/verify/form-errors'
import { safeReturnTo } from '@/app/(organiser)/verify/return-to'
import {
  InMemoryIdentityVerifier,
  clearIdentityStore,
  identityVerifier,
} from '@/adapters/identity'
import { verifyCopy } from '@/copy/verify'
import {
  MAX_ATTEMPTS_PER_WINDOW,
  MIN_PROVIDER_POLL_INTERVAL_MS,
  PENDING_DEADLINE_MS,
  applyOutcome,
  canStartVerification,
  hasTimedOut,
  isRetryable,
  nextPollSeconds,
  shouldPollProvider,
} from '@/domain/identity'
import type { VerifyView } from '@/lib/identity'

/**
 * The rules around a check: who may start one, how a pending answer is chased,
 * and what a provider's answer is allowed to do to a record that already has a
 * status.
 */

describe('canStartVerification', () => {
  const base = { status: 'unverified' as const, attemptsInWindow: 0, hasConsent: true }

  it('allows a first check', () => {
    expect(canStartVerification(base)).toEqual({ ok: true })
  })

  it('refuses without consent', () => {
    // POPIA s11 (§7.3). Also enforced by a NOT NULL foreign key, which is a
    // different system and can be observed refusing (M2-05 §7).
    expect(canStartVerification({ ...base, hasConsent: false })).toEqual({
      ok: false,
      reason: 'no-consent',
    })
  })

  it('refuses a second check while one is in flight', () => {
    // A second check is a second bill for the same answer.
    expect(canStartVerification({ ...base, status: 'pending' })).toEqual({
      ok: false,
      reason: 'already-pending',
    })
  })

  it('refuses somebody already verified', () => {
    expect(canStartVerification({ ...base, status: 'verified' })).toEqual({
      ok: false,
      reason: 'already-verified',
    })
  })

  it('allows a retry after a failure', () => {
    expect(canStartVerification({ ...base, status: 'failed' })).toEqual({ ok: true })
  })

  it('stops at three in a day, because each one costs about R30', () => {
    expect(MAX_ATTEMPTS_PER_WINDOW).toBe(3)

    expect(canStartVerification({ ...base, attemptsInWindow: 2 })).toEqual({ ok: true })
    expect(canStartVerification({ ...base, attemptsInWindow: 3 })).toEqual({
      ok: false,
      reason: 'rate-limited',
    })
  })
})

describe('polling', () => {
  it('widens the interval as the check runs on', () => {
    expect(nextPollSeconds(0)).toBe(2)
    expect(nextPollSeconds(20_000)).toBe(3)
    expect(nextPollSeconds(45_000)).toBe(5)
    expect(nextPollSeconds(90_000)).toBe(8)
    expect(nextPollSeconds(200_000)).toBe(13)
  })

  it('survives a 120-second pending answer without giving up', () => {
    // §5.6 documents 120 seconds as a real answer, not a fault.
    const started = new Date('2026-08-17T10:00:00Z')
    const at120 = new Date(started.getTime() + 120_000)

    expect(hasTimedOut(started, at120)).toBe(false)
    expect(PENDING_DEADLINE_MS).toBeGreaterThan(120_000)
  })

  it('calls a pending check timed out well after any provider would have answered', () => {
    const started = new Date('2026-08-17T10:00:00Z')
    const late = new Date(started.getTime() + PENDING_DEADLINE_MS + 1)

    expect(hasTimedOut(started, late)).toBe(true)
  })

  it('keeps a floor between provider calls, so two open tabs cost one call', () => {
    const now = new Date('2026-08-17T10:00:00Z')
    const justPolled = new Date(now.getTime() - 500)
    const polledAWhileAgo = new Date(now.getTime() - MIN_PROVIDER_POLL_INTERVAL_MS)

    expect(shouldPollProvider(null, now)).toBe(true)
    expect(shouldPollProvider(justPolled, now)).toBe(false)
    expect(shouldPollProvider(polledAWhileAgo, now)).toBe(true)
  })
})

describe('applyOutcome', () => {
  const reference = 'ref'
  const checks = {
    identityDocumentMatch: true,
    nameMatch: true,
    liveness: null,
    faceMatch: null,
  }

  it('settles a pending check', () => {
    expect(applyOutcome('pending', { status: 'verified', reference, checks })).toEqual({
      apply: true,
      status: 'verified',
    })
  })

  it('does nothing with a pending answer', () => {
    expect(applyOutcome('pending', { status: 'pending', reference })).toEqual({
      apply: false,
    })
  })

  it('is terminal once — a verified check cannot be turned into a failure', () => {
    // A stale tab, or a duplicate callback. The record of a check is evidence
    // (§7.3); a later answer is a new check, not an edit to this one.
    expect(
      applyOutcome('verified', {
        status: 'failed',
        reference,
        reason: 'no-match',
        checks,
      }),
    ).toEqual({ apply: false })

    expect(applyOutcome('failed', { status: 'verified', reference, checks })).toEqual({
      apply: false,
    })
  })
})

describe('isRetryable', () => {
  it('is true where the fault is ours or the provider’s', () => {
    expect(isRetryable('provider-unavailable')).toBe(true)
    expect(isRetryable('timed-out')).toBe(true)
  })

  it('is false where Home Affairs disagrees, because the answer will not change', () => {
    expect(isRetryable('no-match')).toBe(false)
    expect(isRetryable('deceased')).toBe(false)
    expect(isRetryable('duplicate-identity')).toBe(false)
  })
})

describe('the in-memory verifier', () => {
  const request = { idNumber: '5306075800082', claimedName: 'J Clegg', nonce: 'n1' }

  it('answers pending first, so the polling path cannot ship untested', async () => {
    clearIdentityStore()
    const verifier = new InMemoryIdentityVerifier()

    const started = await verifier.start(request)
    expect(started.kind).toBe('inline')
    if (started.kind !== 'inline') return

    expect(started.outcome.status).toBe('pending')
    // Pending again on the first poll: a verifier that answered immediately
    // would let the reload path ship untested.
    expect((await verifier.poll(started.outcome.reference)).status).toBe('pending')
    expect((await verifier.poll(started.outcome.reference)).status).toBe('verified')
  })

  it('stays pending past 120 seconds and then verifies', async () => {
    clearIdentityStore()
    let clock = 1_000_000
    const verifier = new InMemoryIdentityVerifier({ now: () => clock })

    const started = await verifier.start({
      ...request,
      idNumber: '5306070001082',
      nonce: 'slow',
    })
    if (started.kind !== 'inline') throw new Error('expected an inline start')

    clock += 120_000
    expect((await verifier.poll(started.outcome.reference)).status).toBe('pending')

    clock += 20_000
    expect((await verifier.poll(started.outcome.reference)).status).toBe('verified')
  })

  it('resumes the same check for the same nonce rather than billing twice', async () => {
    clearIdentityStore()
    const verifier = new InMemoryIdentityVerifier()

    const first = await verifier.start(request)
    const again = await verifier.start(request)

    if (first.kind !== 'inline' || again.kind !== 'inline') throw new Error('inline')
    expect(again.outcome.reference).toBe(first.outcome.reference)
  })

  it('offers the hosted redirect shape, so a vendor like Didit is an adapter', async () => {
    clearIdentityStore()
    const started = await new InMemoryIdentityVerifier().start({
      ...request,
      idNumber: '5306070004086',
      nonce: 'hosted',
    })

    expect(started.kind).toBe('redirect')
  })

  it('refuses to exist in production', () => {
    // A verifier that quietly answered "verified" would put a badge on a page
    // nobody checked, which is worse than no badge (M1-08 §5).
    expect(() => identityVerifier('production')).toThrow(
      /No identity verification provider/,
    )
    expect(() => identityVerifier('development')).not.toThrow()
  })
})

describe('safeReturnTo', () => {
  it('allows a same-origin path', () => {
    expect(safeReturnTo('/collections/abc')).toBe('/collections/abc')
  })

  it('refuses anywhere off this origin', () => {
    // An open redirect on a signed-in page is the exact shape of the scam this
    // product exists to be distinguishable from (§10).
    expect(safeReturnTo('https://evil.example/pay')).toBeNull()
    expect(safeReturnTo('//evil.example/pay')).toBeNull()
    expect(safeReturnTo('/\\evil.example')).toBeNull()
    expect(safeReturnTo('javascript:alert(1)')).toBeNull()
    expect(safeReturnTo(undefined)).toBeNull()
  })
})

describe('withFormErrors', () => {
  const idle: VerifyView = {
    kind: 'idle',
    needsName: false,
    blocked: null,
    idError: null,
  }

  it('turns a code from the query string into a rendered error', () => {
    const view = withFormErrors(idle, { id: 'check-digit' })

    expect(view.kind === 'idle' && view.idError).toBe('check-digit')
  })

  it('ignores anything not in the fixed set', () => {
    // These index into copy, and a query parameter is whatever somebody typed.
    const view = withFormErrors(idle, { id: 'constructor', blocked: '__proto__' })

    expect(view.kind === 'idle' && view.idError).toBeNull()
    expect(view.kind === 'idle' && view.blocked).toBeNull()
  })

  it('leaves a pending or verified view alone', () => {
    const pending: VerifyView = { kind: 'pending', refreshSeconds: 3 }

    expect(withFormErrors(pending, { id: 'empty' })).toEqual(pending)
  })
})

describe('the copy', () => {
  it('has a line for every way a check can end', () => {
    // `satisfies Record<VerificationFailure, string>` holds this at compile
    // time; this is the runtime half, so a widened type cannot lose one quietly.
    expect(Object.keys(verifyCopy.failed.reasons)).toHaveLength(9)
    expect(Object.keys(verifyCopy.blocked)).toHaveLength(4)
    expect(Object.keys(verifyCopy.idErrors)).toHaveLength(6)
  })

  it('does not tell somebody a number they typed belongs to another person', () => {
    // The duplicate case must not become an identity-enumeration oracle.
    expect(verifyCopy.failed.reasons['duplicate-identity']).not.toMatch(
      /another account|someone else has|belongs to/i,
    )
  })

  it('promises no report channel, because there is not one yet', () => {
    // M3-06 builds it. Pointing at a channel that does not exist is the failure
    // M1-08 §5 refused on the event page.
    const strings = JSON.stringify(verifyCopy)

    expect(strings).not.toMatch(/tell us and we will|report this to us at|contact us on/i)
    expect(verifyCopy.failed.noChannelYet).toContain('nowhere on Isipheko to report')
  })

  it('says the number is not kept, on the screen where it is asked for', () => {
    expect(verifyCopy.consent.statement).toContain('It is not stored')
    expect(verifyCopy.verified.note).toContain('was not kept')
  })
})
