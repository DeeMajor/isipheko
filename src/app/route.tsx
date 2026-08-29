import type { NextRequest } from 'next/server'

import { compressFor } from '@/lib/http-compress'
import { HomePage } from '@/ui/home-page'

/**
 * `/` — the front page (M1-09).
 *
 * **A route handler, not a page**, for the reason Part G.1 measured: an App
 * Router page with zero client components still ships ~174KB of React and the
 * router. This is a public path under rule 9's ceiling, and `pnpm gate:size`
 * measures it. Do not convert it back to `page.tsx`.
 *
 * **The one public route without `x-robots-tag: noindex`**, and the absence is
 * the decision. Architecture §10 keeps event and collection pages out of search
 * because a death in the family must not be findable on Google — that is about
 * pages naming a family. This page names nobody, and a front door nobody can
 * find is not a front door.
 */

export async function GET(request: NextRequest): Promise<Response> {
  const { renderToStaticMarkup } = await import('react-dom/server')

  const { body, encoding } = compressFor(
    request.headers.get('accept-encoding'),
    `<!doctype html>${renderToStaticMarkup(<HomePage />)}`,
  )

  return new Response(body as unknown as BodyInit, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Nothing here is anybody's, so unlike every other public route this one
      // may sit in a shared cache. It changes when the copy changes.
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      ...(encoding === 'identity' ? {} : { 'content-encoding': encoding }),
      vary: 'accept-encoding',
    },
  })
}
