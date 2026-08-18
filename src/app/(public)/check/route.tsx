import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { check, parseLookup } from '@/db/repositories/check'
import { allowCheck } from '@/lib/check-rate-limit'
import { formatDayMonth } from '@/lib/dates'
import { compressFor } from '@/lib/http-compress'
import { CheckPage, type CheckPageProps } from '@/ui/check-page'

/**
 * `/check` — the route the trust panel points at, and the one somebody is told
 * to **type rather than tap** (M3-05, built with M3-04 because a panel whose
 * whole content is an instruction to come here cannot ship pointing at a 404).
 *
 * Reachable directly. It takes no session, needs no link, and works from a
 * cold browser on a borrowed phone — which is the entire point of it: an
 * answer that could only be reached from the page being checked would be no
 * answer at all.
 *
 * A GET, so the result has a URL somebody can re-open and compare, and so the
 * whole thing works with JavaScript off.
 *
 * **It answers with what the public page already shows and nothing more**, and
 * a draft answers exactly like a code nobody was issued — see the repository.
 */

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  // Somebody's answer about somebody's funeral is not a shared cache's business.
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
  props: CheckPageProps,
  status = 200,
): Promise<Response> {
  const { renderToStaticMarkup } = await import('react-dom/server')

  return html(request, renderToStaticMarkup(<CheckPage {...props} />), status)
}

/**
 * The address, in the order of how much the header can be trusted — the same
 * ordering `requestFingerprint` uses (M1-06 §5). Hashing is not needed here:
 * nothing is stored, and the counter lives for an hour in memory.
 */
function addressKey(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const address =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    (forwarded === undefined || forwarded === '' ? null : forwarded)

  return address === null || address === '' ? null : address
}

export async function GET(request: NextRequest): Promise<Response> {
  const typed = new URL(request.url).searchParams.get('code') ?? ''

  // Nothing asked, nothing to answer: the form on its own.
  if (typed.trim() === '') return await page(request, { state: 'asking' })

  if (!allowCheck(addressKey(request))) {
    return await page(request, { state: 'too-many', typed }, 429)
  }

  const lookup = parseLookup(typed)

  // A code that cannot be a code and a code nobody was issued get the same
  // answer. Distinguishing them would tell somebody probing which of their
  // guesses were the right *shape*, which is the only free information here.
  const result = lookup === null ? null : await check(prisma, lookup)

  if (result === null) return await page(request, { state: 'not-found', typed })

  return await page(request, {
    state: 'found',
    typed,
    result,
    ...(result.verifiedAt === null
      ? {}
      : { verifiedOn: formatDayMonth(result.verifiedAt) ?? undefined }),
  })
}
