import type { NextRequest } from 'next/server'

import { compressFor } from '@/lib/http-compress'
import { AddressNotFoundPage } from '@/ui/home-page'

/**
 * The 404 for an address nobody issued (M1-09).
 *
 * ## Why this is a catch-all route handler and not `not-found.tsx`
 *
 * Next renders `not-found.tsx` as an App Router **page**, which drags the client
 * runtime with it. Measured on this build: **1.7KB of document and eight
 * scripts, 174.8KB transferred** — over rule 9's ceiling, on the one screen
 * whose entire audience is somebody on a prepaid bundle holding a link they do
 * not trust. That is the reader the budget exists for, and Part G.1 already
 * measured the same 174KB and moved the event page off a page because of it.
 *
 * Served from here the same answer is about six kilobytes.
 *
 * ## Route precedence, which is the thing to be careful about
 *
 * A root catch-all matches anything, so it is only correct because Next resolves
 * more specific segments first: `/check` beats it on a literal segment, and
 * `/e/[slug]` beats it on a shorter, more specific dynamic one. That is a
 * framework guarantee this file depends on rather than one it enforces, so
 * `tests/e2e/routes.spec.ts` walks **every** public route and asserts none of
 * them fell through to this handler. Add a route, add it there.
 *
 * ## `not-found.tsx` still exists, and is still reached
 *
 * `notFound()` called from inside a page or a route — the four `/dev` screens
 * and the simulator receiver, all in production — renders that file. Both read
 * `homeCopy.notFound`, so the words cannot drift; only the rendering differs,
 * and each is right for its own constraint.
 */

export async function GET(request: NextRequest): Promise<Response> {
  const { renderToStaticMarkup } = await import('react-dom/server')

  const { body, encoding } = compressFor(
    request.headers.get('accept-encoding'),
    `<!doctype html>${renderToStaticMarkup(<AddressNotFoundPage />)}`,
  )

  return new Response(body as unknown as BodyInit, {
    status: 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // An address that does not exist is not a page to index, and unlike the
      // front page there is nothing here worth finding.
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'cache-control': 'no-store',
      ...(encoding === 'identity' ? {} : { 'content-encoding': encoding }),
      vary: 'accept-encoding',
    },
  })
}
