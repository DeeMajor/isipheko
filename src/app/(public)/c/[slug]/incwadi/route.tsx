import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { collectionPageBySlug } from '@/db/repositories/collection'
import { ARCHETYPES } from '@/domain/archetype'
import { compressFor } from '@/lib/http-compress'
import { Incwadi } from '@/ui/incwadi'
import { NotFoundPage } from '@/ui/public-page'

/**
 * The incwadi: the page the group prints and hands over with the money.
 *
 * *"Years later this page may be gone and the paper will not be."* That is why
 * this is a print stylesheet and not a screen with a download button — a family
 * in KwaMashu needs a sheet of paper on the day, from whatever phone or shop
 * printer is to hand.
 *
 * **Not M4-02's album and not M4-03's PDF.** Those are a different artefact
 * (messages and photos across an umcimbi, then a print-ready file with real
 * bleed). This is the record of one act, computed entirely from rows that
 * already exist.
 *
 * Public, because the people who need it are the group and the family, none of
 * whom have accounts. It shows exactly what the collection page already shows
 * the group, and it is `noindex` like everything else on this path.
 */

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  // The roster changes until the handover closes it; after that it never does.
  'cache-control': 'public, max-age=0, must-revalidate, s-maxage=30',
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { slug } = await params

  const collection = await collectionPageBySlug(prisma, slug)

  if (collection === null) {
    return html(request, renderToStaticMarkup(<NotFoundPage />), 404)
  }

  const markup = renderToStaticMarkup(
    <Incwadi collection={collection} archetype={ARCHETYPES[collection.archetype]} />,
  )

  return html(request, markup)
}
