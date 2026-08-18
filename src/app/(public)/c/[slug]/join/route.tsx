import type { NextRequest } from 'next/server'

import { collectionCopy } from '@/copy/collection'
import { prisma } from '@/db/client'
import { collectionPageBySlug, joinCollection } from '@/db/repositories/collection'
import { ARCHETYPES } from '@/domain/archetype'
import { normalisePhone } from '@/domain/auth'
import { parseMoney, toCents } from '@/domain/money'
import { compressFor } from '@/lib/http-compress'
import { isSameSite } from '@/lib/same-site'
import {
  CollectionJoinPage,
  isJoinStep,
  nextJoinStep,
  type JoinStep,
} from '@/ui/collection-join-page'

/**
 * Joining a collection.
 *
 * The contribution flow's shape — hidden fields, form posts, no session — and
 * none of its money: there is no payment rail here at all. The last step shows
 * where to send it in the organiser's own words and takes the person's word for
 * it, because we never touch it (rule 12) and cannot verify it.
 *
 * **No account, no login, no email** (rule 4). An end-to-end test walks every
 * step and asserts there is no password, email or signup input in any of them.
 *
 * A member arrives `pending`: the organiser marks it off when the money reaches
 * her. Only confirmed members count toward what the ledger will eventually say
 * the group handed over (M2-09).
 */

type ErrorKey = keyof typeof collectionCopy.join.errors

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  // Every screen here is one person's.
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

function text(form: FormData | URLSearchParams, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

const CARRIED = ['amount', 'name', 'phone', 'named'] as const

async function render(
  request: NextRequest,
  {
    slug,
    step,
    carried,
    error,
  }: {
    slug: string
    step: JoinStep
    carried: Record<string, string>
    error?: ErrorKey | undefined
  },
): Promise<Response> {
  const collection = await collectionPageBySlug(prisma, slug)
  if (collection === null) return new Response(null, { status: 404 })

  const markup = (await import('react-dom/server')).renderToStaticMarkup(
    <CollectionJoinPage
      slug={slug}
      collectionTitle={collection.title}
      organiserName={collection.organiserName ?? ''}
      bankHint={collection.organiserBankHint}
      archetype={ARCHETYPES[collection.archetype]}
      step={step}
      carried={carried}
      error={error}
    />,
  )

  return html(request, markup)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params
  const requested = request.nextUrl.searchParams.get('step') ?? ''
  const step: JoinStep = isJoinStep(requested) ? requested : 'amount'

  return render(request, { slug, step, carried: {} })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params
  const form = await request.formData()

  if (!isSameSite(request)) {
    return render(request, { slug, step: 'amount', carried: {}, error: 'cross-site' })
  }

  const submitted = text(form, 'step')
  const step: JoinStep = isJoinStep(submitted) ? submitted : 'amount'

  const carried: Record<string, string> = {}
  for (const key of CARRIED) {
    const value = text(form, key)
    if (value !== '') carried[key] = value
  }

  // The checkbox is absent when unticked, which is how a checkbox works and
  // what makes "show my name" default to on without a second field.
  if (step === 'who') carried.named = text(form, 'named') === 'yes' ? 'yes' : 'no'

  if (step === 'amount' && !parseMoney(carried.amount ?? '').ok) {
    return render(request, { slug, step: 'amount', carried, error: 'amount' })
  }

  if (step === 'who' && (carried.name ?? '') === '') {
    return render(request, { slug, step: 'who', carried, error: 'name' })
  }

  // "I've sent it" — the only step that writes anything.
  if (step === 'hand') {
    const collection = await collectionPageBySlug(prisma, slug)
    if (collection === null) return new Response(null, { status: 404 })

    const amount = parseMoney(carried.amount ?? '')
    const phone = normalisePhone(carried.phone ?? '')

    const joined = await joinCollection(prisma, {
      collectionId: collection.id,
      name: carried.name ?? '',
      phoneE164: phone.ok ? phone.value : null,
      amountCents: amount.ok ? toCents(amount.value) : null,
      // Quiet from the wider world, not from the group: the amount stays in
      // the roster either way, because the total has to add up for them.
      visibility: carried.named === 'no' ? 'anonymous' : 'public',
    })

    if (!joined.ok) {
      return render(request, { slug, step: 'hand', carried, error: 'not-open' })
    }

    return render(request, { slug, step: 'done', carried: {} })
  }

  const upcoming = nextJoinStep(step)
  if (upcoming === null) return render(request, { slug, step: 'done', carried: {} })

  return render(request, { slug, step: upcoming, carried })
}
