import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { suggestItem } from '@/db/repositories/needs'
import { requestFingerprint } from '@/lib/audit'
import { checkClaimRateLimit } from '@/lib/claim-rate-limit'
import { isSameSite } from '@/lib/same-site'

/**
 * `POST /api/suggest` — a contributor telling the family they forgot
 * something (UX-19).
 *
 * `suggestItem` was built and tested in M2-04 with **no screen anywhere**.
 * M3-08 found the organiser's half of that pipe unreachable and built the
 * board group that answers suggestions — without noticing the contributor's
 * half was just as unreachable, so the group it built could never populate
 * through the product. This is the missing end.
 *
 * Same posture as `/api/claim`, because it is the same kind of caller: no
 * session — the event link is the capability — a same-site check so no other
 * page can file suggestions in a visitor's name, and the claim path's
 * per-address limit, because a flood of suggestions buries the board the
 * organiser works from.
 *
 * **A suggestion changes nothing on the board.** It is invisible to everybody
 * but the organiser until she answers (M2-03 §7) — the copy on the form says
 * so before the name is typed, and the redirect's notice says it again.
 */

function respond(slug: string, query: string, status = 303): Response {
  const headers = new Headers()
  // POST-redirect-GET, so a refresh does not suggest a second time.
  headers.set('location', `/e/${slug}?${query}`)
  return new Response(null, { status, headers })
}

export async function POST(request: NextRequest): Promise<Response> {
  const form = await request.formData()
  const text = (key: string) => {
    const value = form.get(key)
    return typeof value === 'string' ? value.trim() : ''
  }

  const slug = text('slug')
  const label = text('label')
  const name = text('name')

  if (!isSameSite(request)) {
    return respond(slug, 'claim=error&reason=cross-site')
  }

  const fingerprint = await requestFingerprint()
  if (!(await checkClaimRateLimit(prisma, fingerprint.ipHash))) {
    return respond(slug, 'claim=error&reason=too-many-requests')
  }

  if (label === '' || name === '') {
    return respond(slug, 'suggested=empty')
  }

  // Published only: a suggestion against a draft would confirm the draft
  // exists, which is the leak M1-07 §7 closed everywhere else.
  const event = await prisma.event.findFirst({
    where: { slug, status: 'published' },
    select: { id: true },
  })
  if (event === null) return new Response(null, { status: 404 })

  await suggestItem(prisma, {
    eventId: event.id,
    label: label.slice(0, 120),
    suggestedByName: name.slice(0, 120),
  })

  return respond(slug, 'suggested=1')
}
