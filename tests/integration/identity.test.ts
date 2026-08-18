import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import { clearIdentityStore, InMemoryIdentityVerifier } from '@/adapters/identity'
import { hashIdNumber } from '@/db/encryption'
import type { PrismaClient } from '@/db/generated/client'
import { organiserForPhone } from '@/db/repositories/auth'
import {
  applyVerificationOutcome,
  claimPollSlot,
  failVerification,
  identityTaken,
  latestVerification,
  organiserIdentityState,
  recordConsent,
  setProviderReference,
  startVerification,
} from '@/db/repositories/identity'
import { canShare } from '@/domain/collection'

import { clientFor } from '../setup/prisma'

/**
 * Identity verification against a real Postgres.
 *
 * The half of M3-01's done criterion a source scan cannot reach: **no plaintext
 * ID number and no image is in the database**, which is only worth asserting
 * against rows a real check actually wrote.
 *
 * Two guarantees here belong to the database rather than to application code,
 * and both are checked by watching Postgres refuse:
 *
 *   * a check cannot exist without the consent that preceded it — a NOT NULL
 *     foreign key, not an ordering somebody remembers;
 *   * a consent cannot be edited or deleted afterwards — the application role
 *     holds neither grant, the same posture as `ledger_entries` (rule 3).
 */

const ID_NUMBER = '5306075800082'
const PEPPER = Buffer.from('ZGV2ZWxvcG1lbnQtb25seS1wZXBwZXItZG8tbm90ISE=', 'base64')

/**
 * One identity per test, because one identity means one account and these tests
 * share a database. All valid: the date of birth varies and the check digit
 * follows it. `5306075800082` is Stitch's documented sandbox identity (§5.6).
 */
const IDENTITIES = [
  '5301015800086',
  '5301025800084',
  '5302015800084',
  '5302025800082',
  '5303015800082',
  '5303025800080',
  '5304015800080',
  '5304025800088',
  '5305015800087',
  '5305025800085',
  '5306015800085',
  '5306025800083',
  '5307015800083',
  '5307025800081',
  '5308015800081',
  '5308025800089',
  '5309015800089',
  '5309025800087',
  '5310015800087',
  '5310025800085',
  '5311015800085',
  '5311025800083',
  '5312015800083',
  '5312025800081',
] as const

let identityCounter = -1

function unusedIdentity(): string {
  identityCounter += 1
  const value = IDENTITIES[identityCounter]
  if (value === undefined) throw new Error('Add another identity to IDENTITIES.')

  return value
}

let app: PrismaClient
let phoneCounter = 900

beforeAll(() => {
  app = clientFor(inject('appDatabaseUrl'))
  clearIdentityStore()
})

afterAll(async () => {
  await app.$disconnect()
})

function uniquePhone(): string {
  return `+2787${String(++phoneCounter).padStart(7, '0')}`
}

async function organiser(): Promise<string> {
  const record = await organiserForPhone(app, uniquePhone())
  await app.organiser.update({
    where: { id: record.id },
    data: { displayName: 'Nomsa Mthembu' },
  })

  return record.id
}

async function consentFor(organiserId: string): Promise<string> {
  const consent = await recordConsent(app, {
    organiserId,
    copyKey: 'identity.consent',
    copyVersion: '2026-08-17',
    copyHash: 'a'.repeat(64),
    ipHash: null,
    userAgentHash: null,
  })

  return consent.id
}

async function attempt(
  organiserId: string,
  { idNumber = unusedIdentity() }: { idNumber?: string } = {},
) {
  return await startVerification(app, {
    organiserId,
    consentId: await consentFor(organiserId),
    provider: 'in-memory',
    providerReference: null,
    idNumberHash: hashIdNumber(idNumber, PEPPER),
  })
}

describe('consent', () => {
  it('is required by the schema, not merely by the order of two calls', async () => {
    const organiserId = await organiser()

    await expect(
      app.identityVerification.create({
        data: {
          organiserId,
          // A consent that does not exist. The foreign key is the enforcement:
          // "consent before any check" is a property of the schema.
          consentId: '00000000-0000-0000-0000-000000000000',
          provider: 'in-memory',
        },
      }),
    ).rejects.toThrow()
  })

  it('cannot be edited or deleted by the application role', async () => {
    // Insert-only, like the ledger and the audit log. A consent that can be
    // back-dated afterwards is not evidence of anything.
    const organiserId = await organiser()
    const consentId = await consentFor(organiserId)

    await expect(
      app.identityConsent.update({
        where: { id: consentId },
        data: { copyVersion: 'rewritten' },
      }),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      app.identityConsent.delete({ where: { id: consentId } }),
    ).rejects.toThrow(/permission denied/i)
  })

  it('records what was agreed to, not only that something was', async () => {
    const organiserId = await organiser()
    const consentId = await consentFor(organiserId)

    const stored = await app.identityConsent.findUniqueOrThrow({
      where: { id: consentId },
    })

    expect(stored.copyKey).toBe('identity.consent')
    expect(stored.copyVersion).toBe('2026-08-17')
    expect(stored.copyHash).toHaveLength(64)
    expect(stored.consentedAt).toBeInstanceOf(Date)
  })
})

describe('a check', () => {
  it('marks the organiser pending and verifies them on a provider answer', async () => {
    clearIdentityStore()
    const organiserId = await organiser()
    const verifier = new InMemoryIdentityVerifier()

    const record = await attempt(organiserId)

    const pending = await organiserIdentityState(app, { organiserId })
    expect(pending?.status).toBe('pending')

    const started = await verifier.start({
      idNumber: ID_NUMBER,
      claimedName: 'Nomsa Mthembu',
      nonce: record.id,
    })
    if (started.kind !== 'inline') throw new Error('expected an inline start')

    await setProviderReference(app, {
      id: record.id,
      providerReference: started.outcome.reference,
    })

    // Pending first: the answer arrives on a poll, with the plaintext long gone.
    // That is the whole reason the hash is carried on the attempt.
    expect(started.outcome.status).toBe('pending')

    await verifier.poll(started.outcome.reference)
    const outcome = await verifier.poll(started.outcome.reference)

    const applied = await applyVerificationOutcome(app, {
      record: { ...record, providerReference: started.outcome.reference },
      outcome,
    })

    expect(applied).toEqual({ status: 'verified' })

    const after = await organiserIdentityState(app, { organiserId })
    expect(after?.status).toBe('verified')
    expect(after?.verifiedAt).toBeInstanceOf(Date)
  })

  it('promotes the hash to the organiser only on success', async () => {
    clearIdentityStore()
    const organiserId = await organiser()
    const record = await attempt(organiserId, { idNumber: '5306070002080' })

    // While pending, the identity is not claimed: a mistyped digit must not park
    // somebody else's identity against this account.
    const during = await app.organiser.findUniqueOrThrow({
      where: { id: organiserId },
      select: { idNumberHash: true },
    })
    expect(during.idNumberHash).toBeNull()

    await failVerification(app, { record, reason: 'no-match' })

    const after = await app.organiser.findUniqueOrThrow({
      where: { id: organiserId },
      select: { idNumberHash: true, idVerificationStatus: true },
    })
    expect(after.idNumberHash).toBeNull()
    expect(after.idVerificationStatus).toBe('failed')
  })

  it('is terminal once, so a second answer changes nothing', async () => {
    clearIdentityStore()
    const organiserId = await organiser()
    const record = await attempt(organiserId)

    await applyVerificationOutcome(app, {
      record,
      outcome: {
        status: 'verified',
        reference: 'r',
        checks: {
          identityDocumentMatch: true,
          nameMatch: true,
          liveness: null,
          faceMatch: null,
        },
      },
    })

    const late = await applyVerificationOutcome(app, {
      record,
      outcome: {
        status: 'failed',
        reference: 'r',
        reason: 'no-match',
        checks: {
          identityDocumentMatch: false,
          nameMatch: false,
          liveness: null,
          faceMatch: null,
        },
      },
    })

    expect(late).toEqual({ status: 'unchanged' })
    expect((await organiserIdentityState(app, { organiserId }))?.status).toBe('verified')
  })

  it('never demotes somebody already verified', async () => {
    clearIdentityStore()
    const organiserId = await organiser()

    const first = await attempt(organiserId)
    await applyVerificationOutcome(app, {
      record: first,
      outcome: {
        status: 'verified',
        reference: 'r1',
        checks: {
          identityDocumentMatch: true,
          nameMatch: true,
          liveness: null,
          faceMatch: null,
        },
      },
    })

    // A later attempt that fails is a new attempt on an account that is already
    // verified. The badge it earned is not something a later typo takes away.
    const second = await attempt(organiserId, { idNumber: '5306070002080' })
    await failVerification(app, { record: second, reason: 'no-match' })

    expect((await organiserIdentityState(app, { organiserId }))?.status).toBe('verified')
  })

  it('cannot be recorded terminal without a time or a reason', async () => {
    // The CHECK constraint. A row sitting "verified" with no completion time
    // would leave the badge with nothing to say but the word.
    const organiserId = await organiser()
    const record = await attempt(organiserId)

    await expect(
      app.identityVerification.update({
        where: { id: record.id },
        data: { status: 'verified' },
      }),
    ).rejects.toThrow(/identity_verifications_terminal_is_complete/)
  })

  it('cannot be deleted by the application role', async () => {
    const organiserId = await organiser()
    const record = await attempt(organiserId)

    await expect(
      app.identityVerification.delete({ where: { id: record.id } }),
    ).rejects.toThrow(/permission denied/i)
  })
})

describe('one identity, one account', () => {
  it('sees a duplicate before a provider is ever called', async () => {
    clearIdentityStore()
    const first = await organiser()
    const identity = unusedIdentity()
    const record = await attempt(first, { idNumber: identity })

    await applyVerificationOutcome(app, {
      record,
      outcome: {
        status: 'verified',
        reference: 'dup',
        checks: {
          identityDocumentMatch: true,
          nameMatch: true,
          liveness: null,
          faceMatch: null,
        },
      },
    })

    const second = await organiser()

    expect(
      await identityTaken(app, {
        idNumberHash: hashIdNumber(identity, PEPPER),
        organiserId: second,
      }),
    ).toBe(true)

    // And not a duplicate of itself: re-checking your own identity is allowed.
    expect(
      await identityTaken(app, {
        idNumberHash: hashIdNumber(identity, PEPPER),
        organiserId: first,
      }),
    ).toBe(false)
  })

  it('fails the second attempt rather than raising a unique violation at the user', async () => {
    clearIdentityStore()
    const first = await organiser()
    const shared = unusedIdentity()
    const firstRecord = await attempt(first, { idNumber: shared })
    await applyVerificationOutcome(app, {
      record: firstRecord,
      outcome: {
        status: 'verified',
        reference: 'race-1',
        checks: {
          identityDocumentMatch: true,
          nameMatch: true,
          liveness: null,
          faceMatch: null,
        },
      },
    })

    // The identity was claimed between the pre-check and the write. The check
    // itself passed; what failed is that this identity already has an account.
    const second = await organiser()
    const secondRecord = await attempt(second, { idNumber: shared })

    const applied = await applyVerificationOutcome(app, {
      record: secondRecord,
      outcome: {
        status: 'verified',
        reference: 'race-2',
        checks: {
          identityDocumentMatch: true,
          nameMatch: true,
          liveness: null,
          faceMatch: null,
        },
      },
    })

    expect(applied).toEqual({ status: 'failed', reason: 'duplicate-identity' })

    const stored = await app.identityVerification.findUniqueOrThrow({
      where: { id: secondRecord.id },
    })
    expect(stored.failureReason).toBe('duplicate-identity')
    expect((await organiserIdentityState(app, { organiserId: second }))?.status).toBe(
      'failed',
    )
  })
})

describe('the poll slot', () => {
  it('is claimed by exactly one caller, so two open tabs cost one provider call', async () => {
    clearIdentityStore()
    const organiserId = await organiser()
    const record = await attempt(organiserId)
    const now = new Date()

    const [a, b] = await Promise.all([
      claimPollSlot(app, { id: record.id, now, minIntervalMs: 2_000 }),
      claimPollSlot(app, { id: record.id, now, minIntervalMs: 2_000 }),
    ])

    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it('opens again once the interval has passed', async () => {
    clearIdentityStore()
    const organiserId = await organiser()
    const record = await attempt(organiserId)
    const now = new Date()

    expect(await claimPollSlot(app, { id: record.id, now, minIntervalMs: 2_000 })).toBe(
      true,
    )
    expect(
      await claimPollSlot(app, {
        id: record.id,
        now: new Date(now.getTime() + 2_000),
        minIntervalMs: 2_000,
      }),
    ).toBe(true)
  })
})

describe('nothing personal is in the database', () => {
  it('holds no plaintext ID number in any column of either table', async () => {
    clearIdentityStore()
    const organiserId = await organiser()
    const verifier = new InMemoryIdentityVerifier()
    const identity = unusedIdentity()
    const record = await attempt(organiserId, { idNumber: identity })

    const started = await verifier.start({
      idNumber: identity,
      claimedName: 'Nomsa Mthembu',
      nonce: record.id,
    })
    if (started.kind !== 'inline') throw new Error('expected an inline start')

    await setProviderReference(app, {
      id: record.id,
      providerReference: started.outcome.reference,
    })
    await verifier.poll(started.outcome.reference)
    const outcome = await verifier.poll(started.outcome.reference)
    await applyVerificationOutcome(app, {
      record: { ...record, providerReference: started.outcome.reference },
      outcome,
    })

    // Every row of both tables, and the organiser, serialised whole. Not a
    // named-column check: a column added later would slip past that.
    const dump = JSON.stringify([
      await app.identityVerification.findMany(),
      await app.identityConsent.findMany(),
      await app.organiser.findMany({ where: { id: organiserId } }),
      await app.auditLog.findMany({ where: { targetId: organiserId } }),
    ])

    expect(dump).not.toContain(identity)
    // Nor any spelling of it a normaliser would have accepted.
    expect(dump).not.toContain('530607')
    expect(dump).not.toMatch(/photo|image|selfie/i)
    expect(dump).not.toContain(Buffer.from('not-a-real-photo').toString('base64'))

    // What is stored is the peppered hash, and only after success.
    const stored = await app.organiser.findUniqueOrThrow({ where: { id: organiserId } })
    expect(stored.idNumberHash).toBe(hashIdNumber(identity, PEPPER))
  })

  it('keeps only booleans and nulls in the checks column', async () => {
    const rows = (await app.identityVerification.findMany()).filter(
      (row) => row.checks !== null,
    )

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      for (const value of Object.values(row.checks as Record<string, unknown>)) {
        expect(typeof value === 'boolean' || value === null).toBe(true)
      }
    }
  })
})

describe('the gates this finally opens', () => {
  it('lets a verified organiser share a collection', async () => {
    // `canShare` has refused everybody since M2-09 §8, because nothing set the
    // status. This is the first time anything does.
    clearIdentityStore()
    const organiserId = await organiser()
    const record = await attempt(organiserId)

    expect(canShare({ idVerificationStatus: 'unverified' })).toBe(false)

    await applyVerificationOutcome(app, {
      record,
      outcome: {
        status: 'verified',
        reference: 'share',
        checks: {
          identityDocumentMatch: true,
          nameMatch: true,
          liveness: null,
          faceMatch: null,
        },
      },
    })

    const state = await organiserIdentityState(app, { organiserId })
    expect(canShare({ idVerificationStatus: state?.status ?? 'unverified' })).toBe(true)
  })

  it('counts attempts for the three-a-day limit from the rows themselves', async () => {
    clearIdentityStore()
    const organiserId = await organiser()

    await attempt(organiserId)
    const second = await latestVerification(app, { organiserId })
    expect(second).not.toBeNull()

    const state = await organiserIdentityState(app, { organiserId })
    expect(state?.attemptsInWindow).toBe(1)
  })
})
