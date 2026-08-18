import { createHmac } from 'node:crypto'

import { headers } from 'next/headers'

import { prisma } from '@/db/client'
import { hashPhone } from '@/domain/auth'
import { env } from '@/lib/env'

/**
 * The audit log, for auth. Architecture §4.2 and §10 — append-only, and
 * everything security-relevant lands in it.
 *
 * **Nothing identifying is written in the clear.** The IP, the user agent and
 * the phone number are HMAC'd under `OTP_PEPPER`, so the log answers "was it
 * the same person?" and "how often?" without answering "who?" (CLAUDE.md rule
 * 8). The one-time code is not written at all, hashed or otherwise.
 *
 * The application role holds INSERT and SELECT on `audit_log` and not UPDATE or
 * DELETE, so a row written here cannot later be tidied away by the code that
 * wrote it.
 */

/**
 * Identity verification (M3-01). Every one of these is security-relevant and
 * some of them cost money, so the log is also how somebody paying the Home
 * Affairs bill can see what it was spent on.
 *
 * **The metadata carries codes and never a number.** Not the ID number, not its
 * hash, not the provider's message — a failure is `no-match`, and which identity
 * it was about is not a question this log needs to answer.
 */
export type IdentityAction =
  | 'identity.consent.captured'
  | 'identity.check.started'
  | 'identity.check.verified'
  | 'identity.check.failed'
  | 'identity.check.refused'

export type AuthAction =
  | 'auth.otp.requested'
  | 'auth.otp.rate_limited'
  | 'auth.otp.verified'
  | 'auth.otp.rejected'
  | 'auth.otp.exhausted'
  | 'auth.organiser.created'
  | 'auth.session.started'
  | 'auth.session.ended'
  | 'auth.session.ended_everywhere'

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
 * Where the request came from, in order of how much the header can be trusted.
 *
 * `cf-connecting-ip` first: Cloudflare sets it and strips any copy the client
 * sent, so it is the one header here an attacker cannot choose. `x-real-ip` is
 * set by our own proxy. `x-forwarded-for` is last and is **client-controlled** —
 * anybody can send one, and its first entry is whatever they typed.
 *
 * That matters for the per-IP limit, which is evadable by whoever is willing to
 * rotate a header. It is a speed bump on casual enumeration, not a control; the
 * per-number limit is the one that holds, because a number is not something the
 * requester gets to invent. The ordering above means the limit is real in
 * production behind Cloudflare and best-effort anywhere else.
 *
 * Used for rate limiting and the audit trail, never for authorisation. A
 * spoofed value costs somebody a limit; it cannot let anybody in.
 */
export async function requestFingerprint(): Promise<RequestFingerprint> {
  const header = await headers()

  const forwarded = header.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip =
    header.get('cf-connecting-ip') ??
    header.get('x-real-ip') ??
    (forwarded === undefined || forwarded === '' ? null : forwarded)
  const userAgent = header.get('user-agent')

  return {
    ipHash: ip === null || ip === '' ? null : hashIdentifier('ip', ip),
    userAgentHash:
      userAgent === null || userAgent === '' ? null : hashIdentifier('ua', userAgent),
  }
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
}: {
  action: AuthAction | IdentityAction
  organiserId?: string | null
  phoneE164?: string | null
  fingerprint: RequestFingerprint
  metadata?: Record<string, string | number | boolean>
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: 'organiser',
      actorId: organiserId,
      action,
      targetType: organiserId === null ? null : 'organiser',
      targetId: organiserId,
      ipHash: fingerprint.ipHash,
      userAgentHash: fingerprint.userAgentHash,
      metadata: {
        ...(metadata ?? {}),
        ...(phoneE164 === null
          ? {}
          : { phoneHash: hashPhone(phoneE164, env.OTP_PEPPER) }),
      },
    },
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
  metadata?: Record<string, string | number | boolean>
}): Promise<void> {
  await recordAuthEvent(entry)
}
