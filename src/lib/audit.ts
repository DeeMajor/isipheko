import { createHmac } from 'node:crypto'

import { headers } from 'next/headers'

import { prisma } from '@/db/client'
import { recordAudit } from '@/db/repositories/audit'
import { hashPhone } from '@/domain/auth'
import { clientAddress } from '@/lib/client-address'
import type {
  AdminAction,
  AuditActorType,
  AuditMetadata,
  AuditTargetType,
  AuthAction,
  ConfirmAction,
  EventAction,
  IdentityAction,
  ReportAction,
} from '@/domain/audit'
import { env } from '@/lib/env'

/**
 * The audit log, from the request side. Architecture §4.2 and §10 — append-only,
 * and everything security-relevant lands in it.
 *
 * The taxonomy is `src/domain/audit/actions.ts`; the INSERT is
 * `src/db/repositories/audit.ts`. What lives here is the part that needs a
 * request and a pepper: the fingerprint, the hashing, and one narrow function
 * per kind of actor so a call site cannot reach for the wrong one.
 *
 * **Nothing identifying is written in the clear.** The IP, the user agent and
 * the phone number are HMAC'd under `OTP_PEPPER`, so the log answers "was it
 * the same person?" and "how often?" without answering "who?" (CLAUDE.md rule
 * 8). The one-time code is not written at all, hashed or otherwise.
 *
 * The application role holds INSERT and SELECT on `audit_log` and not UPDATE or
 * DELETE, so a row written here cannot later be tidied away by the code that
 * wrote it.
 *
 * **There is no payout writer**, and that is deliberate rather than missing:
 * Mode B is Milestone 5 and no payout can be requested today. The reserved
 * names and where they attach are in the taxonomy.
 */

/**
 * Domain-separated: the same pepper is used for several kinds of identifier, and
 * without the prefix a value could in principle collide across kinds.
 */
function hashIdentifier(kind: string, value: string): string {
  return createHmac('sha256', env.OTP_PEPPER).update(`${kind}:${value}`).digest('hex')
}

export interface RequestFingerprint {
  readonly ipHash: string | null
  readonly userAgentHash: string | null
}

/**
 * The hashed fingerprint of a request: the address and the user agent, HMAC'd,
 * never stored in the clear (CLAUDE.md rule 8).
 *
 * Which header the address comes from, and why none of them may be trusted for
 * authorisation, is in `src/lib/client-address.ts` — it has a second caller now
 * and the reasoning belongs with the function rather than with one of them.
 */
export async function requestFingerprint(): Promise<RequestFingerprint> {
  const header = await headers()

  const ip = clientAddress(header)
  const userAgent = header.get('user-agent')

  return {
    ipHash: ip === null ? null : hashIdentifier('ip', ip),
    userAgentHash:
      userAgent === null || userAgent === '' ? null : hashIdentifier('ua', userAgent),
  }
}

interface Target {
  readonly type: AuditTargetType
  readonly id: string
}

/**
 * `metadata` is for outcomes and counts — a retry-after, which limit was hit,
 * how many sessions were ended. **Never a phone number, never a code.** The
 * phone is passed separately and only its hash is stored.
 */
export async function recordAuthEvent({
  action,
  organiserId = null,
  phoneE164 = null,
  fingerprint,
  metadata,
  now,
}: {
  action: AuthAction | IdentityAction
  organiserId?: string | null
  phoneE164?: string | null
  fingerprint: RequestFingerprint
  metadata?: AuditMetadata
  now?: Date
}): Promise<void> {
  await recordAudit(prisma, {
    actorType: 'organiser',
    actorId: organiserId,
    action,
    targetType: organiserId === null ? null : 'organiser',
    targetId: organiserId,
    ipHash: fingerprint.ipHash,
    userAgentHash: fingerprint.userAgentHash,
    metadata: {
      ...(metadata ?? {}),
      ...(phoneE164 === null ? {} : { phoneHash: hashPhone(phoneE164, env.OTP_PEPPER) }),
    },
    ...(now === undefined ? {} : { now }),
  })
}

/**
 * The same append-only write, narrowed so an identity call site cannot reach
 * for an auth action by accident and so the name says what it records.
 */
export async function recordIdentityEvent(entry: {
  action: IdentityAction
  organiserId: string
  fingerprint: RequestFingerprint
  metadata?: AuditMetadata
}): Promise<void> {
  await recordAuthEvent(entry)
}

/**
 * An organiser acting on something of theirs: publishing, confirming a
 * contribution, marking provisions delivered, closing a handover.
 *
 * The target is the thing acted on rather than the organiser, because the
 * question asked afterwards is *what happened to this event* far more often
 * than *what did this person do* — and the actor is on the row either way.
 */
export async function recordOrganiserAction({
  action,
  organiserId,
  target,
  fingerprint,
  metadata,
  now,
}: {
  action: EventAction | ConfirmAction
  organiserId: string
  target: Target
  fingerprint: RequestFingerprint
  metadata?: AuditMetadata
  now?: Date
}): Promise<void> {
  await recordAudit(prisma, {
    actorType: 'organiser',
    actorId: organiserId,
    action,
    targetType: target.type,
    targetId: target.id,
    ipHash: fingerprint.ipHash,
    userAgentHash: fingerprint.userAgentHash,
    metadata: metadata ?? {},
    ...(now === undefined ? {} : { now }),
  })
}

/**
 * Somebody with no account and no session: a contributor filing a report, a
 * witness spending a handover link.
 *
 * **`actorId` is null and there is no parameter to set it.** These people are
 * anonymous by design (rule 4) and the fingerprint is the whole of what the row
 * knows about them. A witness has a member id, but writing it here would turn
 * the log into a record of which cousin tapped the link, which is not something
 * this log needs and not something anybody consented to.
 */
export async function recordPublicAction({
  action,
  actorType,
  target,
  fingerprint,
  metadata,
  now,
}: {
  action: ConfirmAction | ReportAction
  actorType: Extract<AuditActorType, 'contributor' | 'witness'>
  target: Target
  fingerprint: RequestFingerprint
  metadata?: AuditMetadata
  now?: Date
}): Promise<void> {
  await recordAudit(prisma, {
    actorType,
    actorId: null,
    action,
    targetType: target.type,
    targetId: target.id,
    ipHash: fingerprint.ipHash,
    userAgentHash: fingerprint.userAgentHash,
    metadata: metadata ?? {},
    ...(now === undefined ? {} : { now }),
  })
}

/**
 * A person on the review queue — **including one who only read it.**
 *
 * A queue of reports is a list of families somebody has been accused of
 * defrauding. An admin who opens every report about one family and changes
 * nothing would leave no trace at all under a log that recorded only actions,
 * so reading is a row here as much as deciding is.
 *
 * The actor is the organiser id behind the session, because the allowlist
 * authorises a person we already know rather than creating a second kind of
 * account (docs/decisions.md M3-07 §2).
 */
export async function recordAdminAction({
  action,
  organiserId,
  target,
  fingerprint,
  metadata,
  now,
}: {
  action: AdminAction | ReportAction
  organiserId: string
  target?: Target
  fingerprint: RequestFingerprint
  metadata?: AuditMetadata
  now?: Date
}): Promise<void> {
  await recordAudit(prisma, {
    actorType: 'admin',
    actorId: organiserId,
    action,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    ipHash: fingerprint.ipHash,
    userAgentHash: fingerprint.userAgentHash,
    metadata: metadata ?? {},
    ...(now === undefined ? {} : { now }),
  })
}
