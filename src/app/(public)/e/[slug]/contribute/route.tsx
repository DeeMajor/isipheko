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
  canReachPayStep,
  isRoute,
  isStep,
  isVisibility,
  nextStep,
  type ContributionRoute,
  type ContributionStep,
  type PaymentMode,
  type Visibility,
} from '@/domain/contribution'
import { MAX_BODY_BYTES, type PhotoRejection } from '@/domain/media'
import { formatMoney, fromCents, parseMoney } from '@/domain/money'
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
import { checkoutUrls, notifyUrlFor, provider } from '@/lib/payments'
import { isSameSite } from '@/lib/same-site'
import { ContributePage } from '@/ui/contribute-page'
import type { contributeCopy } from '@/copy/contribute'

/**
 * The contribution steps, as a route handler.
 *
 * **Money and money-toward-one-thing only.** Bringing something is the needs
 * board's claim path (M2-04) and the choose step links there — this flow once
 * carried its own item route and that path recorded nothing at all, while its
 * done screen said otherwise. See `src/domain/contribution/flow.ts`.
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
 * **Two modes, one flow** (M5-02). `events.mode` decides what the pay step is:
 * `ledger_only` shows the organiser's number and takes the contributor's word
 * for it, `hosted` sends them to a checkout and the payment confirms itself.
 * Every step before the pay step is identical, and so is the row — the
 * reference, the photo claim and the rate limit do not care which it is.
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

/**
 * Where a hosted payment settles.
 *
 * **A stand-in, and not a design.** The organiser's id is used as the
 * beneficiary reference because the simulator creates a balance for whatever it
 * is handed, and that is enough to walk the model. A real one is a provider's
 * own beneficiary — a Paystack subaccount code — created from bank details that
 * have been resolved, compared to a Home Affairs-verified name and reviewed.
 * That is M5-04, and it is gated on the three written answers in
 * docs/paystack-analysis.md §6. See docs/decisions.md M5-02 §2.
 */
function beneficiaryFor(row: { organiserId: string; mode: PaymentMode }): string | null {
  return row.mode === 'hosted' ? row.organiserId : null
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
    paymentConfirmed,
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
    paymentConfirmed?: boolean | undefined
    status?: number | undefined
  },
): Promise<Response> {
  const event = await publicEventBySlug(prisma, slug)
  if (event === null) return new Response(null, { status: 404 })

  const row = await prisma.event.findFirstOrThrow({
    where: { slug, status: 'published' },
    select: {
      id: true,
      directPayDetails: true,
      visibilityDefault: true,
      mode: true,
      organiserId: true,
    },
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
      mode={row.mode}
      beneficiary={beneficiaryFor(row)}
      paymentConfirmed={paymentConfirmed}
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

  /*
   * The hosted return path. A contributor comes back from the provider through
   * a redirect, so the row cannot travel in a hidden field — `c` is how the
   * done step knows which contribution it is describing.
   *
   * It carries no authority: what is read is the photo, the visibility and
   * whether the payment has landed, and nothing is written. Scoped to the slug,
   * so a contribution id from one umcimbi cannot be read through another's URL.
   * The divergence from M2-04 §3 is recorded in docs/decisions.md M5-02 §3.
   */
  const returning = query.get('c') ?? ''

  if (returning !== '' && (step === 'done' || step === 'pay')) {
    const stored = await contributionForReturn(slug, returning)

    if (stored !== null) {
      /*
       * Somebody who backed out at the provider comes back to the pay step, not
       * to the start — and with their amount still on it. The row already
       * carries it, so it is read from there rather than asked for again.
       * Hesitating is not a mistake and retyping is a punishment for it.
       */
      const carried =
        step === 'pay'
          ? {
              contribution: returning,
              ...(stored.amountCents === null
                ? {}
                : { amount: formatMoney(fromCents(stored.amountCents)) }),
            }
          : {}

      return render(request, {
        slug,
        route,
        step,
        carried,
        photoDigest: digestFromKey(stored.photoKey) ?? undefined,
        visibility: stored.visibility,
        paymentConfirmed: stored.status === 'confirmed',
      })
    }
  }

  return render(request, { slug, route, step, carried: {} })
}

/**
 * One contribution, by id, **only if it belongs to this slug**.
 *
 * The scoping is the whole of the check. Without it, an id lifted from one
 * umcimbi's URL would render that contribution's photo on another's done
 * screen — small, but it is somebody's photograph on a page it does not belong
 * to.
 */
async function contributionForReturn(
  slug: string,
  contributionId: string,
): Promise<{
  photoKey: string | null
  visibility: Visibility
  status: string
  amountCents: bigint | null
} | null> {
  const row = await prisma.contribution.findFirst({
    where: { id: contributionId, event: { slug, status: 'published' } },
    select: { photoKey: true, visibility: true, status: true, amountCents: true },
  })

  return row === null
    ? null
    : {
        photoKey: row.photoKey,
        visibility: row.visibility,
        status: row.status,
        amountCents: row.amountCents,
      }
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
     * The photo. Both routes through this flow create a row at the pay step
     * (M2-05 §3), so there is always something for it to attach to — "bring
     * something", which creates no row, is not a route here and takes its
     * photo on the needs board's claim form (M4-02b).
     *
     * It is dealt with **before** the name is checked. The other way round,
     * somebody who left the name blank would be sent back to a step where the
     * file input has emptied itself — browsers do not repopulate one — and
     * would have to find the picture again to fix a different mistake.
     */
    const eventId = await eventIdFor(slug)
    if (eventId === null) return new Response(null, { status: 404 })

    const rejection = await attachPhoto(form, eventId, carried)
    const removing = text(form, 'removePhoto') === '1'
    const digest = digestFromTicket(carried.photoTicket ?? '', eventId) ?? undefined

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

  if (step === 'pay') {
    const contributionId = carried.contribution ?? ''

    const event = await prisma.event.findFirst({
      where: { slug, status: 'published' },
      select: { id: true, title: true, mode: true, organiserId: true },
    })
    if (event === null) return new Response(null, { status: 404 })

    // Hosted: this submit starts a checkout and leaves the site. Ledger-only:
    // it is the contributor's word that they already paid. Same button, same
    // form, and the difference is entirely on this side of it.
    if (event.mode === 'hosted') {
      return startCheckout(request, { slug, route, carried, event, contributionId })
    }

    // "I've paid" — the only thing that puts this in front of an organiser.
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
    select: {
      id: true,
      title: true,
      directPayDetails: true,
      mode: true,
      organiserId: true,
    },
  })

  if (event === null) return new Response(null, { status: 404 })

  /*
   * Nowhere for the money to go, so no row is created.
   *
   * The render still happens — the step says honestly what is missing, per
   * mode — but nothing is written. Creating a contribution and issuing a
   * reference for a page that cannot take money leaves the organiser a queue of
   * payments nobody could have made (M2-05 §7), and the same is true of a
   * checkout that cannot settle.
   */
  if (
    !canReachPayStep(event.mode, {
      payDetails: payDetailsOf(event.directPayDetails),
      beneficiary: beneficiaryFor(event),
    })
  ) {
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

/**
 * The hosted submit: start a pay-in and send the contributor to it.
 *
 * The row already exists — it was created when the pay step was reached, for
 * the reason M2-05 §3 gives — so this reads it back rather than trusting the
 * form. What the provider is told is the amount **on the row**, never the
 * amount in a hidden field somebody could have edited between the two screens.
 *
 * `303`, so the browser follows with a GET and a refresh does not start a
 * second checkout. The whole path is `<form method="post">` and a redirect;
 * nothing here needs JavaScript.
 */
async function startCheckout(
  request: NextRequest,
  {
    slug,
    route,
    carried,
    event,
    contributionId,
  }: {
    slug: string
    route: ContributionRoute
    carried: Record<string, string>
    event: { id: string; title: string; mode: PaymentMode; organiserId: string }
    contributionId: string
  },
): Promise<Response> {
  const unavailable = () =>
    render(request, {
      slug,
      route,
      step: 'pay',
      carried,
      error: 'checkout-unavailable',
    })

  if (contributionId === '') return unavailable()

  const contribution = await prisma.contribution.findFirst({
    where: { id: contributionId, eventId: event.id, status: 'pending' },
    select: { amountCents: true, refPrefix: true, refCode: true },
  })

  if (
    contribution === null ||
    contribution.amountCents === null ||
    contribution.refPrefix === null ||
    contribution.refCode === null
  ) {
    return unavailable()
  }

  const beneficiary = beneficiaryFor(event)
  if (beneficiary === null) return unavailable()

  const instance = provider()
  const urls = checkoutUrls(slug, route, contributionId)

  let handle
  try {
    handle = await instance.startPayIn({
      reference: formatReference({
        prefix: contribution.refPrefix,
        code: contribution.refCode,
      }),
      amount: fromCents(contribution.amountCents),
      // What the payer sees named on their statement: the umcimbi, never the
      // contributor and never the amount.
      description: event.title,
      beneficiary,
      returnUrl: urls.returnUrl,
      cancelUrl: urls.cancelUrl,
      notifyUrl: notifyUrlFor(instance),
    })
  } catch {
    return unavailable()
  }

  /*
   * A provider answering with a form to post rather than a link to follow needs
   * a screen of its own, and none exists — see the copy note on
   * `checkout-unavailable`. Refused rather than half-rendered.
   */
  if (handle.redirect.kind !== 'follow') return unavailable()

  return new Response(null, {
    status: 303,
    headers: { location: handle.redirect.url, 'cache-control': 'no-store' },
  })
}
