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
  requiresPayment,
  type ContributionRoute,
  type ContributionStep,
  type Visibility,
} from '@/domain/contribution'
import { MAX_BODY_BYTES, type PhotoRejection } from '@/domain/media'
import { parseMoney } from '@/domain/money'
import { normalisePhone } from '@/domain/auth'
import { formatReference } from '@/domain/reference'
import { requestFingerprint } from '@/lib/audit'
import {
  acceptPhoto,
  claimFromTicket,
  digestFromKey,
  digestFromTicket,
  fullPhotoKey,
} from '@/lib/contribution-photo'
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
    photoDigest,
    visibility,
    status,
  }: {
    slug: string
    route: ContributionRoute
    step: ContributionStep
    carried: Record<string, string>
    error?: ErrorKey | undefined
    reference?: string | undefined
    contributionId?: string | undefined
    photoDigest?: string | undefined
    visibility?: Visibility | undefined
    status?: number | undefined
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
      photoDigest={photoDigest}
      visibility={visibility}
      error={error}
    />,
  )

  return html(request, markup, status ?? 200)
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

/**
 * The event this slug names, or null. Needed a step earlier than the pay step
 * now: a photo is stored under the event it was uploaded for and signed against
 * it, so a ticket cannot be moved between imicimbi.
 */
async function eventIdFor(slug: string): Promise<string | null> {
  const event = await prisma.event.findFirst({
    where: { slug, status: 'published' },
    select: { id: true },
  })

  return event?.id ?? null
}

/** Every refusal has a sentence. A map rather than a cast, so adding a reason
 *  without adding the copy fails to compile. */
const REJECTION_ERRORS: Readonly<Record<PhotoRejection, ErrorKey>> = {
  empty: 'photo-empty',
  'too-big': 'photo-too-big',
  heic: 'photo-heic',
  'not-an-image': 'photo-not-an-image',
  unreadable: 'photo-unreadable',
}

/**
 * The who step's file field: store it, or say why not.
 *
 * Mutates `carried` — this is the one place the flow's state changes rather
 * than being copied forward, because a file is the one thing that cannot ride
 * in a hidden field. What goes into `carried.photoTicket` is a digest with an
 * HMAC over `(event, digest)`, so the field can be edited but not usefully:
 * a digest without a matching signature attaches nothing.
 *
 * Returns the copy key for a refusal, or null when there is nothing to say.
 */
async function attachPhoto(
  form: FormData,
  eventId: string,
  carried: Record<string, string>,
): Promise<ErrorKey | null> {
  if (form.get('removePhoto') === '1') {
    delete carried.photoTicket
    return null
  }

  const file = form.get('photo')
  // No file chosen is the ordinary case, not an error. Browsers send an empty
  // part for an untouched file input, which is why the size is checked too.
  if (!(file instanceof File) || file.size === 0) return null

  const outcome = await acceptPhoto(file, eventId)

  if (!outcome.ok) {
    delete carried.photoTicket
    return REJECTION_ERRORS[outcome.reason]
  }

  carried.photoTicket = outcome.ticket
  return null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params

  /*
   * The body ceiling, checked before a byte of it is read.
   *
   * The who step is multipart now, and `request.formData()` buffers whatever
   * arrives. Between the photo cap (8MB) and this one (24MB) a genuinely
   * oversized photo is parsed and refused with the whole flow's state intact —
   * they keep their amount, their name and their message. Above it there is
   * nothing worth preserving, and the body is never read.
   */
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return render(request, {
      slug,
      route: 'money',
      step: 'choose',
      carried: {},
      error: 'photo-too-large-request',
      // A real status, not a 200 with a sad face on it. The body was never
      // read, so there is no state left to put back and nothing to pretend.
      status: 413,
    })
  }

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
    'photoTicket',
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

  if (step === 'who') {
    /*
     * The photo is offered only where there is something to attach it to.
     *
     * "Bring something" has no pay step and therefore creates no row — it
     * reserves through the claim path M2-04 already built. Taking a photo on
     * that route would store an object and attach it to nothing. Checked here
     * as well as in the markup, so a forged field cannot orphan one.
     *
     * It is dealt with **before** the name is checked. The other way round,
     * somebody who left the name blank would be sent back to a step where the
     * file input has emptied itself — browsers do not repopulate one — and
     * would have to find the picture again to fix a different mistake.
     */
    let digest: string | undefined

    if (requiresPayment(route)) {
      const eventId = await eventIdFor(slug)
      if (eventId === null) return new Response(null, { status: 404 })

      const rejection = await attachPhoto(form, eventId, carried)
      const removing = text(form, 'removePhoto') === '1'
      digest = digestFromTicket(carried.photoTicket ?? '', eventId) ?? undefined

      if (rejection !== null || removing) {
        return render(request, {
          slug,
          route,
          step: 'who',
          carried,
          error: rejection ?? undefined,
          photoDigest: digest,
        })
      }
    } else {
      delete carried.photoTicket
    }

    if ((carried.name ?? '') === '') {
      return render(request, {
        slug,
        route,
        step: 'who',
        carried,
        error: 'name',
        photoDigest: digest,
      })
    }
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

    /*
     * The done step is the first and only time the contributor sees what they
     * attached. It is read back from the row rather than from the form, so what
     * is shown is what was stored — if the ticket failed to verify at the pay
     * step, nothing appears here, which is the truth.
     */
    const stored =
      contributionId === ''
        ? null
        : await prisma.contribution.findUnique({
            where: { id: contributionId },
            select: { photoKey: true, visibility: true },
          })

    return render(request, {
      slug,
      route,
      step: 'done',
      carried: {},
      photoDigest: digestFromKey(stored?.photoKey ?? null) ?? undefined,
      visibility: stored?.visibility,
    })
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

  /*
   * The ticket becomes a key here, at the moment a row exists to put it on.
   *
   * Verified rather than trusted: an unsigned or mis-signed ticket is treated
   * as no photo at all, not as an error. The only way to be holding one is to
   * have edited the form, and a contribution without a photo is a complete
   * contribution.
   */
  const claim = claimFromTicket(carried.photoTicket ?? '', event.id)

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
    photoKey: claim === null ? null : fullPhotoKey(event.id, claim.digest),
    photoWidth: claim?.width ?? null,
    photoHeight: claim?.height ?? null,
    reportedIpHash: fingerprint.ipHash,
  })

  return render(request, {
    slug,
    route,
    step: 'pay',
    carried,
    contributionId: started.id,
    reference: formatReference({ prefix: started.refPrefix, code: started.refCode }),
    photoDigest: claim?.digest,
  })
}
