'use server'

import { redirect } from 'next/navigation'

import { prisma } from '@/db/client'
import { confirmContribution } from '@/db/repositories/contribution'
import { confirmDelivery } from '@/db/repositories/needs'
import { issueWitnessInvite } from '@/db/repositories/witness'
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
