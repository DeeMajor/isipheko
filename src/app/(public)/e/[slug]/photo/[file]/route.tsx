import { objectStore } from '@/adapters/storage'
import { prisma } from '@/db/client'
import { parsePhotoFile, photoKey } from '@/domain/media'

/**
 * A contribution photo: `/e/<slug>/photo/<digest>-<size>.<avif|webp>`.
 *
 * **Every URL names exactly one representation.** The AVIF and the WebP have
 * different addresses and the choice is made by `<picture>` in the markup, not
 * by an `Accept` header — so nothing here varies, nothing is negotiated, and a
 * cache that ignores `Vary` cannot hand an AVIF to a browser that asked for the
 * fallback.
 *
 * Content-addressed, so the bytes at a URL cannot change and the response is
 * `immutable` for a year. That also means the digest names bytes that have
 * already been stripped: there is no route to an original, because no original
 * is kept.
 *
 * Reachable by anybody holding the slug, which is the same capability as the
 * event page itself. A photo somebody attached to a public record is public;
 * what is not public is where it was taken, and that was removed before it was
 * stored.
 */

function notFound(): Response {
  // The same answer for a draft, a wrong slug, a malformed name and a digest
  // nobody ever stored. Anything else tells somebody what exists.
  return new Response(null, { status: 404 })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; file: string }> },
): Promise<Response> {
  const { slug, file } = await params

  const parsed = parsePhotoFile(file)
  if (parsed === null) return notFound()

  const event = await prisma.event.findFirst({
    where: { slug, status: 'published' },
    select: { id: true },
  })

  if (event === null) return notFound()

  const stored = await objectStore().get(
    photoKey(event.id, parsed.digest, parsed.size, parsed.format),
  )

  if (stored === null) return notFound()

  return new Response(stored.bytes as unknown as BodyInit, {
    headers: {
      'content-type': stored.contentType,
      'content-length': String(stored.bytes.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
      // Not a page and not a document. Nothing here should be interpreted as
      // one by a browser that disagrees with the content type.
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-robots-tag': 'noindex, noimageindex',
    },
  })
}
