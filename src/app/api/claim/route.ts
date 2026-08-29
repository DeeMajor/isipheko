import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { claimItem } from '@/db/repositories/needs'
import { acceptClaimPhoto } from '@/lib/contribution-photo'
import { CLAIM_COOKIE, claimCookieOptions, claimCookieValue } from '@/lib/claim-session'
import { requestFingerprint } from '@/lib/audit'
import { checkClaimRateLimit } from '@/lib/claim-rate-limit'
import { isSameSite } from '@/lib/same-site'

/**
 * `POST /api/claim`. Implementation plan Part C.5.
 *
 * **Two callers, two correct answers.** A browser posting a form gets
 * `303 See Other` back to the event page — POST-redirect-GET, so a refresh does
 * not claim a second tent. A caller asking for JSON gets the `409 Conflict`
 * that C.5 specifies, which is what the page enhancement reads. Same
 * reservation either way; C.5's "409" describes the JSON path.
 *
 * **Nothing here decides who wins.** The reservation is M2-03's conditional
 * UPDATE, and it is the only thing standing between two people tapping "I'll
 * bring the tent" in the same second (CLAUDE.md rule 5).
 *
 * Claiming needs no session — anybody holding the event link can claim, and the
 * link is the capability. So the endpoint carries its own two protections: a
 * same-site check, and a per-address limit.
 */

function wantsJson(request: NextRequest): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json')
}

function respond(
  request: NextRequest,
  {
    slug,
    status,
    query,
    cookie,
  }: {
    slug: string
    status: number
    query: string
    cookie?: { name: string; value: string } | undefined
  },
): Response {
  const headers = new Headers()

  if (cookie !== undefined) {
    const options = claimCookieOptions
    headers.append(
      'set-cookie',
      `${cookie.name}=${cookie.value}; Max-Age=${String(options.maxAge)}; Path=${options.path}; SameSite=Lax; HttpOnly${options.secure ? '; Secure' : ''}`,
    )
  }

  if (wantsJson(request)) {
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify({ ok: status === 200, query }), {
      status,
      headers,
    })
  }

  // A browser form post. Redirect so the result is a GET somebody can refresh.
  headers.set('location', `/e/${slug}?${query}`)
  return new Response(null, { status: 303, headers })
}

export async function POST(request: NextRequest): Promise<Response> {
  const form = await request.formData()
  const text = (key: string) => {
    const value = form.get(key)
    return typeof value === 'string' ? value.trim() : ''
  }

  const slug = text('slug')
  const itemId = text('item')
  const name = text('name')
  const quantity = Number(text('quantity'))

  // A claim triggered from another site would silently hold a chair on somebody
  // else's funeral. No money moves, which does not make it harmless.
  if (!isSameSite(request)) {
    return respond(request, { slug, status: 403, query: 'claim=error&reason=cross-site' })
  }

  const fingerprint = await requestFingerprint()
  const withinLimit = await checkClaimRateLimit(prisma, fingerprint.ipHash)

  if (!withinLimit) {
    return respond(request, {
      slug,
      status: 429,
      query: 'claim=error&reason=too-many-requests',
    })
  }

  // Two different mistakes, two sentences (UX-11): a missing name used to
  // answer with the quantity error. A missing item id is a forged form and
  // keeps the generic answer.
  if (name === '') {
    return respond(request, { slug, status: 400, query: 'claim=error&reason=no-name' })
  }
  if (itemId === '') {
    return respond(request, {
      slug,
      status: 400,
      query: 'claim=error&reason=at-least-one',
    })
  }

  /*
   * The photograph (M4-02b), stripped before anything is reserved.
   *
   * Order matters here in the opposite direction to the handover's: a rejected
   * photo must not consume the last tent. So it is processed **before** the
   * conditional UPDATE, and a rejection is only a photo that does not travel —
   * the claim goes through, because somebody bringing the tent is bringing the
   * tent whatever their camera produced.
   */
  const submitted = form.get('photo')

  /*
   * Scoped by event, because `/e/[slug]/photo/[file]` builds its key from the
   * event id — a photo stored under the item id would be written successfully
   * and then be unreachable from the album it exists for. The extra read
   * happens only when somebody actually attached one.
   */
  const eventId =
    submitted instanceof File && submitted.size > 0
      ? ((
          await prisma.needItem.findUnique({
            where: { id: itemId },
            select: { eventId: true },
          })
        )?.eventId ?? null)
      : null

  const photo =
    submitted instanceof File && submitted.size > 0 && eventId !== null
      ? await acceptClaimPhoto(submitted, eventId)
      : null

  const message = text('message')

  const outcome = await claimItem(prisma, {
    needItemId: itemId,
    quantity: Number.isFinite(quantity) ? quantity : Number.NaN,
    claimantName: name,
    claimedIpHash: fingerprint.ipHash,
    message: message === '' ? null : message.slice(0, 500),
    photoKey: photo?.ok === true ? photo.key : null,
    photoWidth: photo?.ok === true ? photo.width : null,
    photoHeight: photo?.ok === true ? photo.height : null,
  })

  if (!outcome.ok) {
    // 409 for the JSON caller; the browser is redirected to the same branch.
    return respond(request, {
      slug,
      status: outcome.reason === 'conflict' ? 409 : 400,
      query: `claim=${outcome.reason === 'conflict' ? 'conflict' : 'error'}&item=${itemId}&reason=${outcome.reason}`,
    })
  }

  /*
   * A rejected photo did not stop the claim (M4-02b §4) — but it must not be
   * silent either (UX-11): "You've claimed the tent" with nothing about the
   * photo reads as "photo attached". The reason travels in the query so the
   * claimed panel can say what happened, while the seconds for the one honest
   * remedy — undo and claim again — are still counting.
   */
  const photoNote =
    photo !== null && !photo.ok ? `&photo=${encodeURIComponent(photo.reason)}` : ''

  return respond(request, {
    slug,
    status: 200,
    query: `claim=claimed&item=${itemId}${photoNote}`,
    cookie: { name: CLAIM_COOKIE, value: claimCookieValue(outcome.claimId) },
  })
}
