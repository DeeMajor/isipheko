import type { NextRequest } from 'next/server'

import { shareCopy } from '@/copy/share'
import { prisma } from '@/db/client'
import { publicEventBySlug } from '@/db/repositories/event'
import { strandForEvent } from '@/db/repositories/strand'
import { ARCHETYPES } from '@/domain/archetype'
import { undoSecondsRemaining } from '@/domain/needs'
import { CLAIM_COOKIE, claimFromCookie } from '@/lib/claim-session'
import { cardIdentity, cardMeta } from '@/lib/event-card'
import { compressFor } from '@/lib/http-compress'
import type { BoardOutcome } from '@/ui/needs-board'
import { CARD_HEIGHT, CARD_WIDTH } from '@/ui/og-card'
import { NotFoundPage, PublicEventPage } from '@/ui/public-page'

/**
 * The public event page — **a route handler, not a page, on purpose**.
 *
 * An App Router page for this same content measured a 199KB first load, of
 * which 174KB was React and the router. CLAUDE.md rule 9 sets a hard 150KB
 * ceiling, and Part G budgets ~62KB typical, because a contributor in
 * KwaZulu-Natal pays for those kilobytes out of a prepaid bundle and 199KB on
 * 3G is roughly four seconds of blank screen.
 *
 * `renderToStaticMarkup` emits no hydration markers and no script tags, so this
 * route ships **zero JavaScript**. `pnpm gate:size` measures it against the
 * budget on every build and fails the build on breach.
 *
 * **Do not convert this back into `page.tsx`.** It will typecheck, it will
 * render identically, and it will silently reintroduce 174KB. See
 * docs/decisions.md M1-08 and implementation-plan Part G.
 *
 * Anything interactive that lands here later — claiming (M2-03), contributing
 * (M2) — is a `<form method="post">` to a route handler or a server action,
 * which is what rule 5 requires anyway.
 */

/**
 * What just happened to a claim, read off the query string the claim endpoint
 * redirected to. The item id is not a secret — anybody with the link can claim,
 * and the link is the capability — so it travels in the URL. The undo token
 * does not (M2-04).
 */
function outcomeFrom(url: URL): BoardOutcome | undefined {
  const claim = url.searchParams.get('claim')
  const item = url.searchParams.get('item') ?? ''
  const reason = url.searchParams.get('reason') ?? ''

  if (claim === 'claimed' && item !== '') {
    // The photo's fate rides along when it was rejected (UX-11). Validated
    // against the known reasons, so a forged value renders nothing rather
    // than a key lookup gone wrong.
    const rejections = ['empty', 'too-big', 'heic', 'not-an-image', 'unreadable'] as const
    const photo = url.searchParams.get('photo') ?? ''
    const photoRejection = rejections.find((value) => value === photo)

    return { kind: 'claimed', itemId: item, secondsLeft: 15, photoRejection }
  }
  if (claim === 'conflict' && item !== '') return { kind: 'conflict', itemId: item }
  if (claim === 'undone' && item !== '') return { kind: 'undone', itemId: item }
  if (claim === 'too-late') return { kind: 'too-late' }
  if (claim === 'error') {
    const known = [
      'not-open',
      'already-taken',
      'more-than-remains',
      'all-or-nothing',
      'at-least-one',
      'no-name',
      'not-a-whole-number',
      'conflict',
      'too-many-requests',
      'cross-site',
    ] as const

    const match = known.find((value) => value === reason)
    return { kind: 'error', reason: match ?? 'conflict' }
  }

  return undefined
}

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  // The meta tag says this too, for crawlers that parse the document; the
  // header covers the ones that do not (architecture §10).
  'x-robots-tag': 'noindex, nofollow, noarchive',
  // A page whose contributions change often, on a connection where a stale
  // page is better than none. The CDN tag invalidation arrives with M2.
  'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
} as const

/**
 * Next does not compress a raw `Response` from a route handler — it did
 * compress the page this replaced. Ten uncompressed kilobytes is real money on
 * a prepaid bundle, so the handler does it itself (`src/lib/http-compress.ts`).
 */
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
      // A page saying "you've claimed the tent" belongs to one person. Serving
      // it from a shared cache to the next visitor would make the board look
      // like it was lying about what is taken.
      ...(personal ? { 'cache-control': 'no-store' } : {}),
      ...(encoding === 'identity' ? {} : { 'content-encoding': encoding }),
      // Compressed by content, so caches must key on the header that chose it.
      vary: 'accept-encoding, cookie',
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

  // Draft, closed, wrong slug and never-existed are one answer. Anything else
  // confirms a page exists to somebody who should not know that.
  if (event === null) {
    return html(request, renderToStaticMarkup(<NotFoundPage />), { status: 404 })
  }

  const outcome = outcomeFrom(request.nextUrl)
  const claimId = claimFromCookie(request.cookies.get(CLAIM_COOKIE)?.value)

  // The strand (M2-06), read off the ledger rather than off `contributions`,
  // so the picture and the record cannot disagree. An empty query string is a
  // closed bead — the close button submits one.
  const beads = await strandForEvent(prisma, event.id)

  // The link preview (M2-07). The origin comes from the request rather than
  // from configuration, so a preview link built on staging points at staging
  // instead of quietly at production.
  const archetype = ARCHETYPES[event.archetype]
  const origin = request.nextUrl.origin
  const identity = cardIdentity(archetype, event, origin)
  const openBead = request.nextUrl.searchParams.get('bead') ?? ''
  // What happened to a suggestion, if one was just made (UX-19).
  const suggestedParam = request.nextUrl.searchParams.get('suggested') ?? ''
  const suggested =
    suggestedParam === '1'
      ? ('done' as const)
      : suggestedParam === 'empty'
        ? ('empty' as const)
        : undefined
  const now = new Date()

  // The undo offer is the cookie's, not the URL's. Somebody who copies the
  // link to a friend does not hand them the right to undo.
  let canUndo = false
  let secondsLeft = 0

  if (claimId !== null && outcome?.kind === 'claimed') {
    const claim = await prisma.needClaim.findUnique({
      where: { id: claimId },
      select: { createdAt: true, status: true },
    })

    if (claim !== null && claim.status === 'claimed') {
      secondsLeft = undoSecondsRemaining(claim.createdAt, new Date())
      canUndo = secondsLeft > 0
    }
  }

  const markup = renderToStaticMarkup(
    <PublicEventPage
      event={event}
      archetype={archetype}
      outcome={outcome?.kind === 'claimed' ? { ...outcome, secondsLeft } : outcome}
      canUndo={canUndo}
      beads={beads}
      openBeadId={openBead === '' ? undefined : openBead}
      suggested={suggested}
      now={now}
      card={{
        imageUrl: identity.url,
        pageUrl: `${origin}/e/${event.slug}`,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        description: shareCopy.description(cardMeta(archetype, event)),
      }}
    />,
  )

  return html(request, markup, {
    personal: outcome !== undefined || claimId !== null || suggested !== undefined,
  })
}
