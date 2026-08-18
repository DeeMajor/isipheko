'use server'

import { redirect } from 'next/navigation'

import { prisma } from '@/db/client'
import {
  confirmHandover,
  confirmMember,
  createCollection,
  openCollection,
  shareCollection,
} from '@/db/repositories/collection'
import { issueHostToken, issueWitnessToken } from '@/db/repositories/handover'
import { isArchetypeKey } from '@/domain/archetype'
import { recordOrganiserAction, requestFingerprint } from '@/lib/audit'
import { currentSession } from '@/lib/session'

/**
 * The collection organiser's four actions: start one, open it, mark somebody's
 * money as arrived, and ask for the link.
 *
 * **The link request refuses, and there is no way to make it not refuse.**
 * `shareCollection` requires a verified identity (rule 13); M3-01 sets that and
 * M3-01 does not exist. No flag here bypasses it — the point of the gate is
 * that it is the only leverage this product has over somebody who already holds
 * the money, and a bypass added to make a screen demoable would spend it.
 */

async function requireOrganiser(): Promise<string> {
  const session = await currentSession()
  if (session === null) redirect('/sign-in')
  return session.organiserId
}

function text(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

export async function startCollection(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()

  const archetype = text(formData, 'archetype')
  const title = text(formData, 'title')
  const purpose = text(formData, 'purpose')
  const bankHint = text(formData, 'bankHint')

  if (!isArchetypeKey(archetype) || title === '') {
    redirect('/collections/new?error=incomplete')
  }

  const collection = await createCollection(prisma, {
    organiserId,
    archetype,
    title,
    purpose: purpose === '' ? null : purpose,
    // Free text, in her words. Never an account we hold, verify or pay into —
    // the moment it is one, rule 12 is gone (Part D2.2).
    organiserBankHint: bankHint === '' ? null : bankHint,
  })

  await openCollection(prisma, { id: collection.id, organiserId })

  redirect(`/collections/${collection.id}`)
}

export async function markArrived(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData, 'id')
  const memberId = text(formData, 'member')

  await confirmMember(prisma, { memberId, organiserId })

  redirect(`/collections/${id}?confirmed=1`)
}

/**
 * "Get the link."
 *
 * Every call returns `not-verified` today. The screen says why, in the words
 * `collectionCopy.shareBlocked` uses, and offers nothing else — because there
 * is nothing else honest to offer until the check exists.
 */
export async function requestShareLink(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData, 'id')

  const outcome = await shareCollection(prisma, { id, organiserId })

  redirect(`/collections/${id}?${outcome.ok ? 'shared=1' : `blocked=${outcome.reason}`}`)
}

/**
 * Asks one of the group to be the one who confirms it (Part D2.4).
 *
 * The link comes back to her screen and she passes it on the way she already
 * talks to these people. **Nothing sends it** — no BSP is configured (M2-08),
 * and a template nobody can exercise is worse than an obvious gap (M2-08 §6).
 */
export async function askWitness(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData, 'id')
  const memberId = text(formData, 'member')

  const outcome = await issueWitnessToken(prisma, {
    collectionId: id,
    memberId,
    organiserId,
  })

  if (!outcome.ok) redirect(`/collections/${id}?handover=${outcome.reason}`)

  // The token is in the URL because it has to reach a different person's phone
  // and no cookie travels (docs/decisions.md M2-11). It is single use and
  // expiring, and it confirms a handover and nothing else.
  redirect(`/collections/${id}?witness=${outcome.issued.token}&member=${memberId}`)
}

/**
 * She closes it herself, on her own word.
 *
 * Phones die and signal fails at gravesides. **The record says it was her word
 * rather than a witness's, and that difference stays on it** — which is the
 * point of offering this rather than an apology for it.
 *
 * The photo the design offers is not built: evidence upload needs M4-01's EXIF
 * stripping, and a JPEG off a phone carries the GPS of the house it was taken
 * at. It attaches in M4-01 to a record that already exists.
 */
export async function markHandedOver(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData, 'id')

  const collection = await prisma.collection.findFirst({
    where: { id, organiserId },
    select: { organiser: { select: { displayName: true } } },
  })

  if (collection === null) redirect('/account')

  const outcome = await confirmHandover(prisma, {
    collectionId: id,
    confirmedBy: 'organiser',
    confirmedByName: collection.organiser.displayName,
    // Null on purpose: no member was there to tap it, and the null *is* the
    // organiser-marked case on the record.
    confirmedByMemberId: null,
  })

  // Her own word rather than a witness's, and the log says which — the same
  // distinction the record itself keeps, for the same reason.
  if (outcome.ok) {
    await recordOrganiserAction({
      action: 'handover.confirmed',
      organiserId,
      target: { type: 'collection', id },
      fingerprint: await requestFingerprint(),
      metadata: { confirmedBy: 'organiser' },
    })
  }

  redirect(`/collections/${id}?${outcome.ok ? 'closed=1' : 'handover=not-confirmable'}`)
}

/**
 * The optional link for the family — **never required** (rule 15).
 *
 * It exists so a host who wants to say "it reached us" can, in one tap and with
 * no account. The record was already closed by the people who handed it over.
 */
export async function askHost(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData, 'id')

  const outcome = await issueHostToken(prisma, { collectionId: id, organiserId })

  if (!outcome.ok) redirect(`/collections/${id}?handover=${outcome.reason}`)

  redirect(`/collections/${id}?host=${outcome.issued.token}`)
}
