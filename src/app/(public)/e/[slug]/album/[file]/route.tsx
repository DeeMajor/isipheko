import { objectStore } from '@/adapters/storage'
import { prisma } from '@/db/client'
import { renderAt } from '@/db/repositories/album-render'
import { isAlbumVersion } from '@/domain/print'

/**
 * The printed album: `/e/<slug>/album/<version>.pdf`.
 *
 * **Content-addressed**, so the bytes at a URL cannot change and the response
 * is `immutable` for a year. A family who printed from this link in August and
 * again in October are holding the same book — a record that has grown since
 * has a different version and therefore a different address, rather than one
 * URL that changed underneath them.
 *
 * Reachable by anybody holding the link, which is the same capability the album
 * page above it grants. **Generating one is not** — that costs real CPU and is
 * the organiser's button on her own dashboard (M4-03 §8).
 *
 * Only a render that finished is served. A queued or failed job answers 404
 * like anything else that is not there: the organiser's screen is where the
 * state of a job belongs, not a half-written file.
 */

function notFound(): Response {
  // The same answer for a draft, a wrong slug, a version nobody rendered and a
  // job still queued. Anything else tells somebody what exists.
  return new Response(null, { status: 404 })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; file: string }> },
): Promise<Response> {
  const { slug, file } = await params

  if (!file.endsWith('.pdf')) return notFound()

  const version = file.slice(0, -'.pdf'.length)
  if (!isAlbumVersion(version)) return notFound()

  const event = await prisma.event.findFirst({
    where: { slug, status: 'published' },
    select: { id: true, title: true },
  })

  if (event === null) return notFound()

  const render = await renderAt(prisma, { eventId: event.id, version })
  if (render === null || render.status !== 'ready' || render.objectKey === null) {
    return notFound()
  }

  const stored = await objectStore().get(render.objectKey)
  if (stored === null) return notFound()

  return new Response(stored.bytes as unknown as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(stored.bytes.byteLength),
      /*
       * `inline`, with a filename.
       *
       * A phone browser shows it rather than dropping it into a downloads
       * folder nobody can find, and the name is what the print shop will see
       * on the counter — so it is the family's name, not a hash.
       */
      'content-disposition': `inline; filename="${asFilename(event.title)}.pdf"`,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    },
  })
}

/**
 * A title somebody can read off a counter, reduced to what a filename may hold.
 *
 * Not the slug and not the version: whoever prints this needs to know whose
 * book it is. Falls back rather than producing an empty name.
 */
function asFilename(title: string): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^\w -]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)

  return cleaned === '' ? 'isipheko-album' : cleaned
}
