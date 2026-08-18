import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { handoverTokenSubject, redeemWitnessToken } from '@/db/repositories/handover'
import { ARCHETYPES } from '@/domain/archetype'
import { recordPublicAction, requestFingerprint } from '@/lib/audit'
import { compressFor } from '@/lib/http-compress'
import { isSameSite } from '@/lib/same-site'
import { HandoverTapPage, type TapState } from '@/ui/handover-tap'

/**
 * The witness's one tap — Part D2.4's default, and the whole of M2-11's
 * done-criterion: **the handover completes with the host taking no action.**
 *
 * Somebody in the group, standing there, opens this on their own phone. No
 * account, no session (rule 4): the link is the capability.
 *
 * Reading the page does not spend it. A person who opens the link, loses signal
 * at a graveside and opens it again has not used up their one tap — the token
 * is spent by the POST, in a conditional update, and the ledger append behind
 * it is conditional too (M2-09).
 */

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  // A capability in a URL is never cached, anywhere, by anybody.
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

/**
 * The done screen reads the collection by id rather than by token.
 *
 * Redeeming spends the token, so re-reading it here would report
 * "already used" to the person who just used it correctly — which is exactly
 * what happened the first time this was wired up.
 */
async function renderDone(request: NextRequest, collectionId: string): Promise<Response> {
  const { renderToStaticMarkup } = await import('react-dom/server')

  const collection = await prisma.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: {
      title: true,
      occasionArchetype: true,
      organiser: { select: { displayName: true } },
    },
  })

  return html(
    request,
    renderToStaticMarkup(
      <HandoverTapPage
        kind="witness"
        token=""
        collectionTitle={collection.title}
        organiserName={collection.organiser.displayName ?? ''}
        archetype={ARCHETYPES[collection.occasionArchetype]}
        state="done"
      />,
    ),
  )
}

async function render(
  request: NextRequest,
  {
    token,
    state,
    error,
  }: {
    token: string
    state: TapState
    error?: 'expired' | 'already-used' | 'not-found' | 'not-confirmable'
  },
): Promise<Response> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const subject = await handoverTokenSubject(prisma, { token })

  // A link that is spent, expired or never existed says so and stops. Nothing
  // about the collection is shown to somebody holding a dead link.
  if (!subject.ok) {
    return html(
      request,
      renderToStaticMarkup(
        <HandoverTapPage
          kind="witness"
          token={token}
          collectionTitle=""
          organiserName=""
          archetype={ARCHETYPES.umngcwabo}
          state="error"
          error={subject.reason}
        />,
      ),
      subject.reason === 'not-found' ? 404 : 200,
    )
  }

  const collection = await prisma.collection.findUniqueOrThrow({
    where: { id: subject.subject.collectionId },
    select: { occasionArchetype: true },
  })

  return html(
    request,
    renderToStaticMarkup(
      <HandoverTapPage
        kind="witness"
        token={token}
        collectionTitle={subject.subject.collectionTitle}
        organiserName={subject.subject.organiserName ?? ''}
        archetype={ARCHETYPES[collection.occasionArchetype]}
        state={state}
        error={error}
      />,
    ),
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params

  return render(request, { token, state: 'ready' })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params

  // The same protection the claim endpoint has (M2-04 §6): without it any page
  // anywhere could close somebody's handover in the background.
  if (!isSameSite(request)) {
    return render(request, { token, state: 'error', error: 'not-found' })
  }

  const outcome = await redeemWitnessToken(prisma, { token })

  if (!outcome.ok) {
    return render(request, { token, state: 'error', error: outcome.reason })
  }

  // A witness closing a handover is security-relevant and has no session behind
  // it, so the fingerprint is the whole of what the row knows about them —
  // which is correct. **Not the member id**: a witness has one, but writing it
  // here would turn the log into a record of which cousin tapped the link, and
  // nobody consented to that.
  await recordPublicAction({
    action: 'handover.confirmed',
    actorType: 'witness',
    target: { type: 'collection', id: outcome.collectionId },
    fingerprint: await requestFingerprint(),
    metadata: { confirmedBy: 'witness' },
  })

  return renderDone(request, outcome.collectionId)
}
