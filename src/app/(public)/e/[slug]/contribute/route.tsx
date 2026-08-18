import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { publicEventBySlug } from '@/db/repositories/event'
import { formatDayMonth } from '@/lib/dates'
import { boardForEvent } from '@/db/repositories/needs'
import {
  checkReportRateLimit,
  selfReport,
  startContribution,
} from '@/db/repositories/contribution'
import { ARCHETYPES } from '@/domain/archetype'
import {
  isRoute,
  isStep,
  isVisibility,
  nextStep,
  type ContributionRoute,
  type ContributionStep,
  type Visibility,
} from '@/domain/contribution'
import { parseMoney } from '@/domain/money'
import { normalisePhone } from '@/domain/auth'
import { formatReference } from '@/domain/reference'
import { requestFingerprint } from '@/lib/audit'
import { compressFor } from '@/lib/http-compress'
import { isSameSite } from '@/lib/same-site'
import { ContributePage } from '@/ui/contribute-page'
import type { contributeCopy } from '@/copy/contribute'

/**
 * The five steps, as a route handler.
 *
 * **No account, no login, no email.** A contributor arrives from a WhatsApp
 * link and leaves without being asked to become anything (CLAUDE.md rule 4).
 * State moves between steps in hidden fields — nothing to expire, nothing to
 * clean up, and the back button works.
 *
 * A route handler rather than a page for the reason M1-08 measured: an App
 * Router page would put 174KB of framework runtime back on the path a stranger
 * walks on a prepaid bundle, and this is the path that matters most.
 *
 * **Mode A.** Nothing here touches money. The contributor pays the organiser
 * from their own banking app against a reference code, comes back, and says so.
 */

type ErrorKey = keyof typeof contributeCopy.errors

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  // Every screen here is one person's, and one of them carries a payment
  // reference. None of it may be served to the next visitor from a cache.
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

/** Pay details live in `events.direct_pay_details`, written by the organiser. */
function payDetailsOf(value: unknown): { phone: string; name: string } | null {
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  const phone = typeof record.phone === 'string' ? record.phone : ''
  const name = typeof record.name === 'string' ? record.name : ''

  return phone === '' || name === '' ? null : { phone, name }
}

async function render(
  request: NextRequest,
  {
    slug,
    route,
    step,
    carried,
    error,
    reference,
    contributionId,
  }: {
    slug: string
    route: ContributionRoute
    step: ContributionStep
    carried: Record<string, string>
    error?: ErrorKey | undefined
    reference?: string | undefined
    contributionId?: string | undefined
  },
): Promise<Response> {
  const event = await publicEventBySlug(prisma, slug)
  if (event === null) return new Response(null, { status: 404 })

  const row = await prisma.event.findFirstOrThrow({
    where: { slug, status: 'published' },
    select: { id: true, directPayDetails: true, visibilityDefault: true },
  })

  const archetype = ARCHETYPES[event.archetype]
  const board = await boardForEvent(prisma, row.id)
  const amount = carried.amount === undefined ? undefined : parseMoney(carried.amount)

  const markup = (await import('react-dom/server')).renderToStaticMarkup(
    <ContributePage
      slug={slug}
      eventTitle={event.title}
      organiserName={event.organiserName}
      {...(event.organiserVerifiedAt === null
        ? {}
        : { verifiedOn: formatDayMonth(event.organiserVerifiedAt) ?? undefined })}
      archetype={archetype}
      route={route}
      step={step}
      amountsPublic={archetype.amountsPublic}
      carried={{
        ...carried,
        ...(contributionId === undefined ? {} : { contribution: contributionId }),
      }}
      needs={board.map((item) => ({
        id: item.id,
        label: item.label,
        remaining: item.remaining,
      }))}
      amount={amount?.ok === true ? amount.value : undefined}
      reference={reference}
      payDetails={payDetailsOf(row.directPayDetails)}
      defaultVisibility={row.visibilityDefault}
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
  const query = request.nextUrl.searchParams

  const route = isRoute(query.get('route') ?? '')
    ? (query.get('route') as ContributionRoute)
    : 'money'
  const step = isStep(query.get('step') ?? '')
    ? (query.get('step') as ContributionStep)
    : 'choose'

  return render(request, { slug, route, step, carried: {} })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params
  const form = await request.formData()

  if (!isSameSite(request)) {
    return render(request, {
      slug,
      route: 'money',
      step: 'choose',
      carried: {},
      error: 'cross-site',
    })
  }

  const route = isRoute(text(form, 'route'))
    ? (text(form, 'route') as ContributionRoute)
    : 'money'
  const step = isStep(text(form, 'step'))
    ? (text(form, 'step') as ContributionStep)
    : 'choose'

  // Everything the earlier steps gathered, carried forward as hidden fields.
  const carried: Record<string, string> = {}
  for (const key of [
    'amount',
    'item',
    'name',
    'phone',
    'message',
    'visibility',
    'contribution',
  ]) {
    const value = text(form, key)
    if (value !== '') carried[key] = value
  }

  const upcoming = nextStep(route, step)
  if (upcoming === null) {
    return render(request, { slug, route, step: 'done', carried: {} })
  }

  if (step === 'amount' && parseMoney(carried.amount ?? '').ok === false) {
    return render(request, { slug, route, step: 'amount', carried, error: 'amount' })
  }

  if (step === 'who' && (carried.name ?? '') === '') {
    return render(request, { slug, route, step: 'who', carried, error: 'name' })
  }

  // Reaching the pay step is what creates the row: a reference code needs
  // something to be unique against, and this is the first moment one is shown.
  if (upcoming === 'pay') {
    return startPayStep(request, { slug, route, carried })
  }

  // "I've paid" — the only thing that puts this in front of an organiser.
  if (step === 'pay') {
    const contributionId = carried.contribution ?? ''
    if (contributionId !== '') await selfReport(prisma, { contributionId })

    return render(request, { slug, route, step: 'done', carried: {} })
  }

  return render(request, { slug, route, step: upcoming, carried })
}

async function startPayStep(
  request: NextRequest,
  {
    slug,
    route,
    carried,
  }: { slug: string; route: ContributionRoute; carried: Record<string, string> },
): Promise<Response> {
  const event = await prisma.event.findFirst({
    where: { slug, status: 'published' },
    select: { id: true, title: true, directPayDetails: true },
  })

  if (event === null) return new Response(null, { status: 404 })

  // No number, no pay step. A blank where a payment number belongs is how
  // somebody pays the wrong account.
  if (payDetailsOf(event.directPayDetails) === null) {
    return render(request, { slug, route, step: 'pay', carried })
  }

  const parsed = parseMoney(carried.amount ?? '')
  if (!parsed.ok) {
    return render(request, { slug, route, step: 'amount', carried, error: 'amount' })
  }

  const fingerprint = await requestFingerprint()
  const phone = normalisePhone(carried.phone ?? '')
  const phoneE164 = phone.ok ? phone.value : null

  const verdict = await checkReportRateLimit(prisma, {
    phoneE164,
    ipHash: fingerprint.ipHash,
  })

  if (!verdict.allowed) {
    return render(request, {
      slug,
      route,
      step: 'who',
      carried,
      error: verdict.reason === 'phone' ? 'too-many-phone' : 'too-many-address',
    })
  }

  const visibility = isVisibility(carried.visibility ?? '')
    ? (carried.visibility as Visibility)
    : 'public'

  const started = await startContribution(prisma, {
    eventId: event.id,
    eventTitle: event.title,
    type: route === 'earmark' ? 'cash_toward_item' : 'cash',
    amountCents: parsed.value,
    needItemId: carried.item ?? null,
    contributorName: carried.name ?? '',
    contributorPhoneE164: phoneE164,
    message: carried.message ?? null,
    visibility,
    reportedIpHash: fingerprint.ipHash,
  })

  return render(request, {
    slug,
    route,
    step: 'pay',
    carried,
    contributionId: started.id,
    reference: formatReference({ prefix: started.refPrefix, code: started.refCode }),
  })
}
