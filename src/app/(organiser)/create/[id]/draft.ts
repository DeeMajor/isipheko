import { redirect } from 'next/navigation'

import { prisma } from '@/db/client'
import { draftForOrganiser, type DraftSummary } from '@/db/repositories/event'
import { ARCHETYPES, type ArchetypeConfig } from '@/domain/archetype'
import { currentSession } from '@/lib/session'

/**
 * Loads a draft for the signed-in organiser, or leaves.
 *
 * The scoping is the access control: `draftForOrganiser` filters on the
 * organiser id, so somebody else's draft is indistinguishable from one that
 * does not exist. An id in a URL is not a permission, and there is no branch
 * here that could be written to treat it as one.
 */
export async function loadDraft(
  id: string,
): Promise<{ draft: DraftSummary; archetype: ArchetypeConfig; organiserId: string }> {
  const session = await currentSession()
  if (session === null) redirect('/sign-in')

  const draft = await draftForOrganiser(prisma, { id, organiserId: session.organiserId })
  if (draft === null) redirect('/account')

  return {
    draft,
    archetype: ARCHETYPES[draft.archetype],
    organiserId: session.organiserId,
  }
}
