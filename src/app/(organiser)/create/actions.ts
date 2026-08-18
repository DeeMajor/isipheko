'use server'

import { redirect } from 'next/navigation'

import { prisma } from '@/db/client'
import {
  createDraft,
  draftForOrganiser,
  publishDraft,
  replaceNeeds,
  replaceWitnesses,
  setOrganiserName,
  updateDetails,
} from '@/db/repositories/event'
import { ARCHETYPE_KEYS, type ArchetypeKey } from '@/domain/archetype'
import { issueWitnessInvite } from '@/db/repositories/witness'
import { MAX_WITNESSES, canPublish } from '@/domain/event'
import { normalisePhone } from '@/domain/auth'
import { currentSession } from '@/lib/session'

/**
 * The setup steps, as server actions.
 *
 * Plain form posts, so the whole flow works with JavaScript disabled — adding a
 * need, removing a witness and publishing are all submit buttons carrying a
 * name and a value, not click handlers. A family on a borrowed phone with a
 * broken script can still set up a funeral page.
 *
 * Every action re-checks the session and scopes its write to the organiser. An
 * event id in a URL is not a permission, and these are the only writers.
 */

async function requireOrganiser(): Promise<string> {
  const session = await currentSession()
  if (session === null) redirect('/sign-in')
  return session.organiserId
}

/**
 * A form field, as text.
 *
 * `FormDataEntryValue` is `string | File`, and a `File` stringifies to
 * "[object File]" — so a multipart post aimed at one of these fields would
 * otherwise store that as somebody's event title. Anything that is not a string
 * is nothing.
 */
function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Reads the repeated fields the needs and witnesses steps post. */
function pairs(formData: FormData, first: string, second: string): [string, string][] {
  const firsts = formData.getAll(first).map(text)
  const seconds = formData.getAll(second).map(text)

  return firsts.map((value, index) => [value, seconds[index] ?? ''])
}

function archetypeFrom(value: FormDataEntryValue | null): ArchetypeKey {
  const key = text(value)
  // An unknown archetype is a tampered form, not a user mistake. Back to the
  // start rather than guessing which ceremony somebody meant.
  if (!ARCHETYPE_KEYS.includes(key as ArchetypeKey)) redirect('/create')
  return key as ArchetypeKey
}

export async function createFromDetails(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const archetype = archetypeFrom(formData.get('archetype'))

  const title = text(formData.get('title'))
  const organiserName = text(formData.get('organiserName'))

  if (title === '') redirect(`/create/details?kind=${archetype}&error=no-title`)

  // M1-06 left display_name null on purpose: sign-in asks for a number and
  // nothing else. This is the first moment somebody has told us their name.
  if (organiserName !== '') await setOrganiserName(prisma, organiserId, organiserName)

  const draft = await createDraft(prisma, {
    organiserId,
    archetype,
    title,
    subtitle: emptyToNull(formData.get('subtitle')),
    place: emptyToNull(formData.get('place')),
    eventDate: dateOrNull(formData.get('eventDate')),
  })

  redirect(`/create/${draft.id}/needs`)
}

export async function saveDetails(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData.get('id'))
  const title = text(formData.get('title'))

  if (title === '') redirect(`/create/${id}/details?error=no-title`)

  await updateDetails(
    prisma,
    { id, organiserId },
    {
      title,
      subtitle: emptyToNull(formData.get('subtitle')),
      place: emptyToNull(formData.get('place')),
      eventDate: dateOrNull(formData.get('eventDate')),
    },
  )

  redirect(`/create/${id}/needs`)
}

/**
 * One action for the whole needs step: saving, adding a row and removing one.
 *
 * All three are submits, because "add another" as a click handler would mean
 * the step needs JavaScript. Every path writes what is currently on screen
 * first, so a row typed and then removed does not take its neighbours with it.
 */
export async function saveNeeds(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData.get('id'))

  const draft = await draftForOrganiser(prisma, { id, organiserId })
  if (draft === null) redirect('/account')

  // A submit button carries one name and one value, so "remove" identifies
  // itself by the index it sends rather than by also setting `action`.
  const action = text(formData.get('action')) || 'continue'
  const removeIndex = Number(formData.get('remove') ?? -1)
  const removing = Number.isInteger(removeIndex) && removeIndex >= 0

  const items = pairs(formData, 'label', 'note')
    .filter(([label], index) => label !== '' && index !== removeIndex)
    .map(([label, note]) => ({ label, note }))

  await replaceNeeds(prisma, id, items)

  if (removing) redirect(`/create/${id}/needs`)
  if (action === 'add') redirect(`/create/${id}/needs?add=1`)

  if (items.length === 0) redirect(`/create/${id}/needs?error=empty`)
  redirect(`/create/${id}/witnesses`)
}

export async function saveWitnesses(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData.get('id'))

  const draft = await draftForOrganiser(prisma, { id, organiserId })
  if (draft === null) redirect('/account')

  const action = text(formData.get('action')) || 'continue'
  const removeIndex = Number(formData.get('remove') ?? -1)
  const removing = Number.isInteger(removeIndex) && removeIndex >= 0

  const people = pairs(formData, 'name', 'phone')
    .filter(([name], index) => name !== '' && index !== removeIndex)
    .slice(0, MAX_WITNESSES)
    .map(([name, phone]) => {
      const parsed = normalisePhone(phone)
      return { name, phoneE164: parsed.ok ? parsed.value : '' }
    })
    .filter((person) => person.phoneE164 !== '')

  await replaceWitnesses(prisma, id, people)

  if (removing) redirect(`/create/${id}/witnesses`)
  if (action === 'add') redirect(`/create/${id}/witnesses?add=1`)

  if (people.length === 0) redirect(`/create/${id}/witnesses?error=empty`)
  redirect(`/create/${id}/verify`)
}

/**
 * A link for one umkhaphi, to pass on herself.
 *
 * **Nothing is sent** — no SMS provider and no BSP exist (M1-06 §6, M2-08 §12),
 * and the same posture M2-11 §7 took for the handover link: shown, not sent.
 * The token appears once, in the redirect, and the database keeps only its
 * hash.
 *
 * The token is in a query string, which M2-04 §3 refuses for the undo
 * capability. It is allowed here for the reason M2-11 §1 records: this
 * capability has to travel to somebody else's phone, and no cookie can be set
 * on a phone we have never seen. What bounds it is that it is scoped to one
 * witness, expires, and answers one question.
 */
export async function askWitness(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData.get('id'))
  const witnessId = text(formData.get('witness'))

  const outcome = await issueWitnessInvite(prisma, {
    witnessId,
    eventId: id,
    organiserId,
  })

  if (!outcome.ok) redirect(`/create/${id}/witnesses?error=${outcome.reason}`)

  redirect(
    `/create/${id}/witnesses?invited=${encodeURIComponent(outcome.issued.token)}` +
      `&witness=${encodeURIComponent(witnessId)}`,
  )
}

export async function publish(formData: FormData): Promise<void> {
  const organiserId = await requireOrganiser()
  const id = text(formData.get('id'))

  const draft = await draftForOrganiser(prisma, { id, organiserId })
  if (draft === null) redirect('/account')

  const decision = canPublish(draft)
  if (!decision.ok) redirect(`/create/${id}/share?error=${decision.blocker}`)

  // The UPDATE carries the same conditions and can still refuse — the draft was
  // read a moment ago, and what it says about the organiser is a moment old.
  // Its answer is honoured rather than assumed: reporting a publish that
  // Postgres declined would leave her looking for a link that does not exist.
  const published = await publishDraft(prisma, { id, organiserId })
  if (!published) redirect(`/create/${id}/share?error=not-verified`)

  redirect(`/create/${id}/share?published=1`)
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const trimmed = text(value)
  return trimmed === '' ? null : trimmed
}

function dateOrNull(value: FormDataEntryValue | null): Date | null {
  const day = text(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null

  const date = new Date(`${day}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}
