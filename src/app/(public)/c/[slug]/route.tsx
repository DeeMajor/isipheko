import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { collectionPageBySlug } from '@/db/repositories/collection'
import { ARCHETYPES } from '@/domain/archetype'
import { compressFor } from '@/lib/http-compress'
import { CollectionPublicPage } from '@/ui/collection-page'
import { NotFoundPage } from '@/ui/public-page'

/**
 * The collection's own page — **a route handler, not a page**, for the reason
 * M1-08 measured: an App Router page puts 174KB of framework runtime on a
 * public path, and this is one. Same audience, same prepaid bundle, same
 * 150KB ceiling (rule 9), and `pnpm gate:size` measures it.
 *
 * **A collection has a slug only once its organiser was verified** (rule 13),
 * so every page reachable here belongs to somebody who passed that gate. That
 * is what lets the page state the verification as a fact rather than hedge it.
 *
 * Nothing about money moves through this route. It shows who is holding it and
 * says plainly that it is not us (rule 16).
 */

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  // A collection for a family funeral must not be findable on Google either.
  'x-robots-tag': 'noindex, nofollow, noarchive',
  /*
   * Shared caches only, and **no stale-while-revalidate**.
   *
   * The event page can serve a slightly stale copy happily (M1-08): a
   * contribution more or less does not change what the reader came for. This
   * page is a roster somebody has just added themselves to, and serving them a
   * copy without their own name on it reads as the join having failed.
   * `must-revalidate` says so explicitly rather than relying on `max-age=0`
   * being interpreted strictly. `s-maxage` still lets the CDN absorb a WhatsApp
   * group opening the link at once.
   */
  'cache-control': 'public, max-age=0, must-revalidate, s-maxage=30',
} as const

function html(
  request: NextRequest,
  markup: string,
  { status = 200, personal = false }: { status?: number; personal?: boolean } = {},
): Response {
  const { body, encoding } = compressFor(
    request.headers.get('accept-encoding'),
    `<!doctype html>${markup}`,
  )

  return new Response(body as unknown as BodyInit, {
    status,
    headers: {
      ...HTML_HEADERS,
      // "You are on the list" belongs to one person.
      ...(personal ? { 'cache-control': 'no-store' } : {}),
      ...(encoding === 'identity' ? {} : { 'content-encoding': encoding }),
      vary: 'accept-encoding',
    },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { slug } = await params

  const collection = await collectionPageBySlug(prisma, slug)

  // A draft, a collection nobody could share, a wrong slug and one that never
  // existed are one answer.
  if (collection === null) {
    return html(request, renderToStaticMarkup(<NotFoundPage />), { status: 404 })
  }

  const joined = request.nextUrl.searchParams.get('joined') === '1'

  const markup = renderToStaticMarkup(
    <CollectionPublicPage
      collection={collection}
      archetype={ARCHETYPES[collection.archetype]}
      joined={joined}
    />,
  )

  return html(request, markup, { personal: joined })
}
