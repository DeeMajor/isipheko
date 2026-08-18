import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ImageResponse } from 'next/og'

import { objectStore } from '@/adapters/storage'
import { prisma } from '@/db/client'
import { eventCardBySlug } from '@/db/repositories/event'
import { ARCHETYPES } from '@/domain/archetype'
import { isCardVersion } from '@/domain/share'
import { cardIdentity, cardMeta } from '@/lib/event-card'
import { CARD_HEIGHT, CARD_WIDTH, OgCard } from '@/ui/og-card'

/**
 * The Open Graph card: `/e/<slug>/og/<version>.png`.
 *
 * **Generated once per version, not per request** (architecture §9.1). The
 * version is a hash of everything the card draws, so the same facts always
 * produce the same URL and the same cached object; a changed title mints a new
 * URL, which is also the only way to make WhatsApp look at a card again — it
 * caches previews against the URL it fetched and revisits on nobody's schedule
 * but its own.
 *
 * The cache is an `ObjectStore` (`src/adapters/storage/`). No storage provider
 * has been chosen — architecture §15 item 6 — so today it writes to local disk
 * and an S3 implementation arrives with that decision.
 *
 * This route is reachable by anybody holding the slug, which is the same
 * capability as the page itself: WhatsApp's crawler has no cookies and no
 * session, so an image only its owner could fetch would be an image nobody
 * ever sees.
 */

/** WhatsApp gives up on a preview well before this. Ours is ~30KB. */
const MAX_CARD_BYTES = 600 * 1024

const FONT_DIR = join(process.cwd(), 'src', 'assets', 'fonts')

interface Face {
  readonly name: string
  readonly data: ArrayBuffer
  readonly weight: 400 | 800
  readonly style: 'normal'
}

let faces: Promise<Face[]> | null = null

/**
 * Public Sans, as `.woff`.
 *
 * Satori reads `ttf`, `otf` and `woff` and **not** `woff2`, which is the only
 * format the page ships. So these are two separate binaries that no browser
 * ever downloads, kept in `src/assets/` rather than `public/` precisely so that
 * stays true — M1-05's test asserts exactly two woff2 files ship, and it still
 * passes.
 *
 * Read once per process and held: the file does not change under a running
 * server, and reading 37KB on every cold card is waste on the path a family is
 * waiting on.
 */
function fonts(): Promise<Face[]> {
  faces ??= Promise.all([
    readFile(join(FONT_DIR, 'public-sans-latin-400.woff')),
    readFile(join(FONT_DIR, 'public-sans-latin-800.woff')),
  ]).then(([regular, heavy]) => [
    {
      name: 'Public Sans',
      data: regular.buffer.slice(
        regular.byteOffset,
        regular.byteOffset + regular.byteLength,
      ),
      weight: 400 as const,
      style: 'normal' as const,
    },
    {
      name: 'Public Sans',
      data: heavy.buffer.slice(heavy.byteOffset, heavy.byteOffset + heavy.byteLength),
      weight: 800 as const,
      style: 'normal' as const,
    },
  ])

  return faces
}

function notFound(): Response {
  // The same answer for a draft, a wrong slug, a malformed version and an event
  // that never existed. Anything else tells somebody a page is there.
  return new Response(null, { status: 404 })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; file: string }> },
): Promise<Response> {
  const { slug, file } = await params

  if (!file.endsWith('.png')) return notFound()
  const requested = file.slice(0, -'.png'.length)
  if (!isCardVersion(requested)) return notFound()

  const event = await eventCardBySlug(prisma, slug)
  if (event === null) return notFound()

  const archetype = ARCHETYPES[event.archetype]
  const origin = new URL(request.url).origin
  const identity = cardIdentity(archetype, event, origin)

  /*
   * A version that is not the current one still gets a card.
   *
   * A link sitting in a chat from before the family fixed a spelling holds the
   * old URL, and answering it with a 404 would replace a preview somebody
   * already sent with a broken box. It serves the current card instead, and is
   * only cached for a minute — the current URL is the one that gets a year.
   */
  const current = requested === identity.version

  const store = objectStore()
  const cached = await store.get(identity.key)

  const bytes =
    cached?.bytes ??
    new Uint8Array(
      await new ImageResponse(
        <OgCard
          archetype={archetype}
          title={event.title}
          subtitle={event.subtitle}
          organiserName={event.organiserName}
          meta={cardMeta(archetype, event)}
          // Read from the same facts the version was hashed from, never decided
          // again here. It was a hard `false` until M3-02, and the version was
          // *already* hashing the badge — so a second source of truth for it
          // would draw an unbadged card at a URL that claims to be the badged
          // one, and cache that answer for a year.
          verified={identity.facts.verified}
        />,
        { width: CARD_WIDTH, height: CARD_HEIGHT, fonts: await fonts() },
      ).arrayBuffer(),
    )

  if (cached === null) {
    if (bytes.byteLength > MAX_CARD_BYTES) {
      // Not thrown: a card too big for WhatsApp is a card WhatsApp drops, and a
      // 500 here would take the page's preview with it. Loud in the logs, no
      // event name in them (rule 8).
      console.error('[og] card exceeded the preview size limit', {
        bytes: bytes.byteLength,
        archetype: archetype.key,
      })
    }

    await store.put(identity.key, { bytes, contentType: 'image/png' })
  }

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
      'cache-control': current
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=60',
      // A death in the family must not be findable on Google, and neither must
      // a picture of one (§10).
      'x-robots-tag': 'noindex, nofollow, noarchive',
    },
  })
}
