'use server'

import { redirect } from 'next/navigation'

import { prisma } from '@/db/client'
import {
  consumeOtpChallenge,
  countRecentOtpRequests,
  createOtpChallenge,
  latestOtpChallenge,
  organiserForPhone,
  recordFailedAttempt,
} from '@/db/repositories/auth'
import {
  OTP_LENGTH,
  checkOtpRateLimit,
  generateOtpCode,
  normalisePhone,
  otpChallengeStatus,
  otpCodeMatches,
} from '@/domain/auth'
import { smsSender } from '@/adapters/messaging'
import { authCopy } from '@/copy/auth'
import { recordAuthEvent, requestFingerprint } from '@/lib/audit'
import { env } from '@/lib/env'
import {
  clearPendingPhone,
  currentSession,
  endAllSessions,
  endSession,
  pendingPhone,
  setPendingPhone,
  startSession,
} from '@/lib/session'

import { destinationParam, signInDestination } from './destination'

/**
 * The two steps of signing in.
 *
 * These are server actions, so the forms work with JavaScript disabled: the
 * browser posts, the action runs, and the redirect carries any error back as a
 * code the page turns into copy. Nothing here returns a value that a no-script
 * page would silently drop.
 *
 * **The code is a local variable and nothing else.** It is generated, hashed
 * into the database, handed to the SMS sender, and goes out of scope. It is
 * never logged, never returned, never put in a redirect and never in an error.
 * `tests/unit/auth-no-code-in-logs.test.ts` reads this file and fails if that
 * stops being true.
 */

/** Error codes travel in the URL; the copy lives in `src/copy/auth.ts`. */
type PhoneError = keyof typeof authCopy.errors.phone
type CodeError = keyof typeof authCopy.errors.code

function backToPhone(error?: PhoneError): never {
  redirect(error === undefined ? '/sign-in' : `/sign-in?error=${error}`)
}

function backToCode(error?: CodeError, next = ''): never {
  redirect(
    error === undefined
      ? `/sign-in?step=code${next}`
      : `/sign-in?step=code&error=${error}${next}`,
  )
}

export async function requestCode(formData: FormData): Promise<void> {
  const raw = formData.get('phone')
  // Where they were going before they were sent here (M1-09). Allowlisted, so
  // an unrecognised value is the default rather than an error and never reaches
  // a Location header.
  const next = destinationParam(formData.get('next'))
  const parsed = normalisePhone(typeof raw === 'string' ? raw : '')

  if (!parsed.ok) backToPhone(parsed.reason)

  const phoneE164 = parsed.value
  const now = new Date()
  const fingerprint = await requestFingerprint()

  const counts = await countRecentOtpRequests(prisma, {
    phoneE164,
    ipHash: fingerprint.ipHash,
    now,
  })
  const decision = checkOtpRateLimit(counts, now)

  if (!decision.allowed) {
    await recordAuthEvent({
      action: 'auth.otp.rate_limited',
      phoneE164,
      fingerprint,
      metadata: { limit: decision.reason, retryAfterSeconds: decision.retryAfterSeconds },
    })

    // Same destination, same words as a code that was actually sent. Telling
    // somebody they have hit a limit tells them the number is worth hammering.
    await setPendingPhone(phoneE164)
    redirect(`/sign-in?step=code${next}`)
  }

  const code = generateOtpCode()
  await createOtpChallenge(prisma, {
    phoneE164,
    code,
    pepper: env.OTP_PEPPER,
    ipHash: fingerprint.ipHash,
    now,
  })

  await smsSender(env.NODE_ENV).send({ to: phoneE164, body: authCopy.code.sms(code) })

  await recordAuthEvent({ action: 'auth.otp.requested', phoneE164, fingerprint })

  await setPendingPhone(phoneE164)
  redirect(`/sign-in?step=code${next}`)
}

export async function verifyCode(formData: FormData): Promise<void> {
  const next = destinationParam(formData.get('next'))
  const phoneE164 = await pendingPhone()
  if (phoneE164 === null) backToPhone()

  const submitted = formData.get('code')
  const code = typeof submitted === 'string' ? submitted.replace(/\s/g, '') : ''
  const now = new Date()
  const fingerprint = await requestFingerprint()

  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) backToCode('malformed', next)

  const challenge = await latestOtpChallenge(prisma, phoneE164)

  // No challenge at all reads exactly like a wrong code. A number nobody has
  // ever asked for must not answer differently from one that has.
  if (challenge === null) {
    await recordAuthEvent({ action: 'auth.otp.rejected', phoneE164, fingerprint })
    backToCode('rejected', next)
  }

  const status = otpChallengeStatus(challenge, now)

  if (status === 'too-many-attempts') {
    await recordAuthEvent({ action: 'auth.otp.exhausted', phoneE164, fingerprint })
    backToCode('exhausted', next)
  }

  if (status !== 'usable' || !otpCodeMatches(code, env.OTP_PEPPER, challenge.codeHash)) {
    await recordFailedAttempt(prisma, challenge.id)
    await recordAuthEvent({
      action: 'auth.otp.rejected',
      phoneE164,
      fingerprint,
      metadata: { status },
    })
    backToCode('rejected', next)
  }

  // Conditional update: two requests carrying the same valid code race, and
  // exactly one of them wins. The loser is a failed attempt, not a second
  // session.
  const consumed = await consumeOtpChallenge(prisma, challenge.id, now)
  if (!consumed) {
    await recordAuthEvent({ action: 'auth.otp.rejected', phoneE164, fingerprint })
    backToCode('rejected', next)
  }

  const organiser = await organiserForPhone(prisma, phoneE164)

  if (organiser.isNew) {
    await recordAuthEvent({
      action: 'auth.organiser.created',
      organiserId: organiser.id,
      phoneE164,
      fingerprint,
    })
  }

  await recordAuthEvent({
    action: 'auth.otp.verified',
    organiserId: organiser.id,
    phoneE164,
    fingerprint,
  })

  await startSession(organiser.id, fingerprint, now)
  await clearPendingPhone()

  await recordAuthEvent({
    action: 'auth.session.started',
    organiserId: organiser.id,
    fingerprint,
  })

  redirect(signInDestination(formData.get('next')))
}

/** "Use a different number" — drops the pending number and starts over. */
export async function startOver(): Promise<void> {
  await clearPendingPhone()
  redirect('/sign-in')
}

export async function signOut(): Promise<void> {
  const fingerprint = await requestFingerprint()
  const organiserId = await endSession()

  if (organiserId !== null) {
    await recordAuthEvent({ action: 'auth.session.ended', organiserId, fingerprint })
  }

  redirect('/sign-in')
}

/** For a lost or stolen phone. Ends this session as well — that is the point. */
export async function signOutEverywhere(): Promise<void> {
  const fingerprint = await requestFingerprint()
  const session = await currentSession()

  if (session === null) redirect('/sign-in')

  const ended = await endAllSessions(session.organiserId)

  await recordAuthEvent({
    action: 'auth.session.ended_everywhere',
    organiserId: session.organiserId,
    fingerprint,
    metadata: { sessionsEnded: ended },
  })

  redirect('/sign-in')
}
