import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { respondToInvite, witnessForToken } from '@/db/repositories/witness'
import { ARCHETYPES, type ArchetypeKey } from '@/domain/archetype'
import { checkInvite, isInviteAnswer } from '@/domain/witness'
import { compressFor } from '@/lib/http-compress'
import { isSameSite } from '@/lib/same-site'
import { WitnessInvitePage } from '@/ui/witness-invite'

/**
 * `/k/<token>` — an umkhaphi answering an invitation. One question, two
 * answers, no account (rule 4).
 *
 * **Three capability routes now exist and they are easy to confuse**, so they
 * are written down here and in docs/decisions.md M3-03:
 *
 * | route | who holds it | what it does |
 * | ----- | ------------ | ------------ |
 * | `/w/<token>` | a member of a collection, at the handover | closes the record (M2-11) |
 * | `/h/<token>` | the host family, optionally, afterwards | adds a line to that record, and is never required (rule 15) |
 * | `/k/<token>` | an umkhaphi on an event | accepts or declines standing with the family (M3-03) |
 *
 * All three are 32 random bytes stored as a SHA-256, expiring, scoped to one
 * person and one thing, and none of them moves money.
 *
 * Reading does not spend it. Somebody who opens the link, loses signal and
 * opens it again has not used up their answer — the POST decides, in a
 * conditional update (M2-11 §2, which learned this by getting it wrong).
 */

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  // A capability in a URL is never cached, anywhere, by anybody.
  'cache-control': 'no-store',
} as const

function html(request: NextRequest, markup: string, status = 200): Response {
  const { body, encoding } = compressFor(
    request.headers.get('accept-encoding'),
    `<!doctype html>${markup}`,
  )

  return new Response(body as unknown as BodyInit, {
    status,
    headers: {
      ...HTML_HEADERS,
      ...(encoding === 'identity' ? {} : { 'content-encoding': encoding }),
      vary: 'accept-encoding',
    },
  })
}

async function page(
  request: NextRequest,
  props: Parameters<typeof WitnessInvitePage>[0],
  status = 200,
): Promise<Response> {
  const { renderToStaticMarkup } = await import('react-dom/server')

  return html(request, renderToStaticMarkup(<WitnessInvitePage {...props} />), status)
}

/** Nothing about a family is shown to somebody holding a link that is not ours. */
async function notFound(request: NextRequest, token: string): Promise<Response> {
  return await page(
    request,
    {
      state: 'not-found',
      token,
      witnessName: '',
      eventTitle: '',
      organiserName: '',
      archetype: ARCHETYPES.umngcwabo,
    },
    404,
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  const subject = await witnessForToken(prisma, token)

  if (subject === null) return await notFound(request, token)

  const archetype = ARCHETYPES[subject.archetype as ArchetypeKey]
  const allowed = checkInvite(
    { status: subject.status, expiresAt: subject.expiresAt },
    new Date(),
  )

  // Somebody re-opening their own answered link is shown their answer rather
  // than an error: they did nothing wrong, and "already used" reads as a fault.
  if (!allowed.ok && subject.status !== 'invited') {
    return await page(request, {
      state: subject.status === 'accepted' ? 'accepted' : 'declined',
      token,
      witnessName: subject.witnessName,
      eventTitle: subject.eventTitle,
      organiserName: subject.organiserName ?? '',
      archetype,
    })
  }

  return await page(request, {
    state: allowed.ok ? 'ready' : 'problem',
    token,
    witnessName: subject.witnessName,
    eventTitle: subject.eventTitle,
    organiserName: subject.organiserName ?? '',
    archetype,
    ...(allowed.ok ? {} : { problem: allowed.reason }),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params

  // The same protection the claim endpoint has (M2-04 §6). Without it any page
  // anywhere could answer somebody's invitation in the background — and the
  // answer it forged would appear beside a family's name in public.
  if (!isSameSite(request)) return await notFound(request, token)

  const form = await request.formData()
  const answer = form.get('answer')

  if (typeof answer !== 'string' || !isInviteAnswer(answer)) {
    return await notFound(request, token)
  }

  const outcome = await respondToInvite(prisma, { token, answer })
  if (!outcome.ok && outcome.reason === 'not-found') {
    return await notFound(request, token)
  }

  // **POST, redirect, GET** — the posture M2-04 §1 took for claiming, and for
  // the same reason: rendering the answer straight from the POST leaves a
  // reload re-submitting it. Here that meant somebody re-opening their own
  // answered link was shown a refusal, which is the M2-11 §2 mistake arriving
  // by a different road.
  //
  // The GET reads the row and shows them what they answered, because the link
  // stays readable once it is spent.
  return new Response(null, {
    status: 303,
    headers: { location: `/k/${encodeURIComponent(token)}`, 'cache-control': 'no-store' },
  })
}
