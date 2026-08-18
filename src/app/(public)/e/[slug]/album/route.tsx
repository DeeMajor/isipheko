import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { albumForEvent } from '@/db/repositories/album'
import { publicEventBySlug } from '@/db/repositories/event'
import { ARCHETYPES } from '@/domain/archetype'
import { compressFor } from '@/lib/http-compress'
import { Album } from '@/ui/album'
import { NotFoundPage } from '@/ui/public-page'

/**
 * The album: `/e/<slug>/album`.
 *
 * **A route handler, not a page, for the reason M1-08 measured.** An App Router
 * page ships 174KB of framework runtime whether or not anything on it is
 * interactive, and nothing here is: the strand's beads are anchors and there is
 * no form on the page at all. `renderToStaticMarkup` emits no hydration markers
 * and no script tags, so this route ships zero JavaScript and four hundred
 * photos still lazy-load, because `loading="lazy"` is the browser's.
 *
 * Public, like the event page it belongs to. Anybody holding the link can read
 * the record — that is the same capability the page above it grants, and the
 * people who most need to read it (an aunt, a neighbour) have no account and
 * never will.
 *
 * `noindex` on both the meta tag and the header. A death in the family must not
 * be findable on Google (architecture §10).
 */

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  // The record grows while an umcimbi is live and then never changes again. A
  // minute at the edge is the same bargain the event page strikes.
  'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
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

  const event = await publicEventBySlug(prisma, slug)

  if (event === null) {
    return html(request, renderToStaticMarkup(<NotFoundPage />), 404)
  }

  // One read of the chain produces both the cover and the entries. Two queries
  // could disagree by a row written between them, and the disagreement would be
  // invisible — a bead on the cover pointing at an anchor that is not there.
  const { beads, entries } = await albumForEvent(prisma, event.id)

  const markup = renderToStaticMarkup(
    <Album
      slug={slug}
      title={event.title}
      organiserName={event.organiserName}
      place={event.place}
      eventDate={event.eventDate}
      archetype={ARCHETYPES[event.archetype]}
      beads={beads}
      entries={entries}
    />,
  )

  return html(request, markup)
}
