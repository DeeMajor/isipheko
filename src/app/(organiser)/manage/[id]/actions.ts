'use server'

import { redirect } from 'next/navigation'

import { prisma } from '@/db/client'
import { confirmContribution } from '@/db/repositories/contribution'
import {
  approveSuggestion,
  confirmDelivery,
  declineSuggestion,
} from '@/db/repositories/needs'
import { issueWitnessInvite } from '@/db/repositories/witness'
import { recordOrganiserAction, requestFingerprint } from '@/lib/audit'
import { currentSession } from '@/lib/session'

/**
 * The organiser's two actions on a live umcimbi: telling us how people pay
 * them, and confirming that somebody did.
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

/**
 * Mode A has no payment rail, so this number **is** the payment path. It is
 * shown to every contributor on the pay screen beside the organiser's name, so
 * they can check it matches before sending anything.
 */
export async function savePayDetails(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData, 'id')
  const phone = text(formData, 'phone')
  const name = text(formData, 'name')

  if (phone === '' || name === '') {
    redirect(`/manage/${id}?error=incomplete`)
  }

  await prisma.event.updateMany({
    where: { id, organiserId },
    data: { directPayDetails: { phone, name } },
  })

  redirect(`/manage/${id}?saved=1`)
}

/**
 * Confirming against their own bank notification — the only thing in Mode A
 * that writes to the ledger.
 *
 * If they are wrong, the correction is a reversal entry (rule 3). There is no
 * unconfirm.
 */
export async function confirmReport(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData, 'id')
  const contributionId = text(formData, 'contribution')

  const outcome = await confirmContribution(prisma, { contributionId, organiserId })

  // The ledger records the entry; this records who was signed in when it was
  // appended, which the ledger row does not carry and which is the question
  // asked afterwards. Only on success — a refused confirmation appended
  // nothing.
  if (outcome.ok) {
    await recordOrganiserAction({
      action: 'contribution.confirmed',
      organiserId,
      // Targeted at the umcimbi rather than the contribution: what the review
      // screen asks is "what has happened to this event", and a trail split
      // across one target per contribution answers nobody's question.
      target: { type: 'event', id },
      fingerprint: await requestFingerprint(),
      metadata: { contributionId },
    })
  }

  redirect(`/manage/${id}?${outcome.ok ? 'confirmed=1' : 'error=confirm'}`)
}

/**
 * "The tent arrived" — the in-kind half of the same act, and the only thing
 * that puts provisions on the ledger and therefore on the strand (M2-06).
 *
 * Same posture as confirming money: no unconfirm, and a correction is a
 * reversal entry.
 */
export async function confirmArrival(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData, 'id')
  const claimId = text(formData, 'claim')

  const outcome = await confirmDelivery(prisma, { claimId, organiserId })

  if (outcome.ok) {
    await recordOrganiserAction({
      action: 'delivery.confirmed',
      organiserId,
      target: { type: 'event', id },
      fingerprint: await requestFingerprint(),
      metadata: { claimId },
    })
  }

  redirect(`/manage/${id}?${outcome.ok ? 'confirmed=1' : 'error=confirm'}`)
}

/**
 * The same link as the setup step's, issued from the screen she is on after
 * publishing (M3-03). Shown, never sent.
 */
export async function askWitnessHere(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()

  const id = text(formData, 'id')
  const witnessId = text(formData, 'witness')

  const outcome = await issueWitnessInvite(prisma, {
    witnessId,
    eventId: id,
    organiserId,
  })

  if (!outcome.ok) redirect(`/manage/${id}?error=${outcome.reason}`)

  redirect(
    `/manage/${id}?invited=${encodeURIComponent(outcome.issued.token)}` +
      `&witness=${encodeURIComponent(witnessId)}`,
  )
}

/**
 * The organiser answering a suggestion (M2-04).
 *
 * A contributor who sees the list can say the family forgot something. Until
 * this screen existed the suggestion landed in `need_items` with status
 * `suggested` and **nobody could ever see it** — built, tested and unreachable.
 *
 * It is her list, so nothing appears on it until she says so, and a decline is
 * recorded rather than deleted: somebody took the trouble to say it, and the
 * row is the evidence of what was offered.
 */
export async function decideSuggestion(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData, 'id')
  const needItemId = text(formData, 'item')
  const answer = text(formData, 'answer')

  if (answer !== 'approve' && answer !== 'decline') {
    redirect(`/manage/${id}?error=suggestion`)
  }

  const decided =
    answer === 'approve'
      ? await approveSuggestion(prisma, { needItemId, organiserId })
      : await declineSuggestion(prisma, { needItemId, organiserId })

  redirect(`/manage/${id}?${decided ? 'listed=1' : 'error=suggestion'}`)
}
