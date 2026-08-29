import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { enqueueNotification } from '@/db/repositories/notifications'
import {
  fileReport,
  markAcknowledged,
  reportsFromAddress,
  withinReportLimit,
} from '@/db/repositories/report'
import { normalisePhone } from '@/domain/auth'
import { checkReport, type ReportReason } from '@/domain/report'
import { recordPublicAction, requestFingerprint } from '@/lib/audit'
import { formatDayMonth } from '@/lib/dates'
import { compressFor } from '@/lib/http-compress'
import { isSameSite } from '@/lib/same-site'
import { ReportPage, type ReportPageProps } from '@/ui/report-page'

/**
 * `/report` — somebody telling us a page is not what it says it is (M3-06).
 *
 * Reachable directly, and linked from the three places somebody realises: an
 * event page, a collection page, and `/check` when nothing matched. That last
 * one is the most valuable report there is, because a link resolving to nothing
 * is the scam case — so this accepts a report about **nothing we hold**.
 *
 * No account, no session, no script (rule 4). A POST and a rendered answer.
 *
 * **Filing a report changes nothing about the event.** There is no write to an
 * event in this file, deliberately: a form that changed a page would be a way
 * to attack a family, and the reporter is anonymous by design. See
 * docs/decisions.md M3-06 §1.
 */

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  // What somebody reported is not a shared cache's business.
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

async function page(
  request: NextRequest,
  props: ReportPageProps,
  status = 200,
): Promise<Response> {
  const { renderToStaticMarkup } = await import('react-dom/server')

  return html(request, renderToStaticMarkup(<ReportPage {...props} />), status)
}

function text(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * What the report is about, if anything.
 *
 * A slug identifies a **published** page only: a draft is unreachable (M1-07
 * §7) and this must not become the way to learn one exists. A slug that
 * resolves to nothing is not an error — it is kept as typed text, which is
 * exactly the report worth having.
 */
async function subject(eventSlug: string, collectionSlug: string) {
  if (eventSlug !== '') {
    const event = await prisma.event.findFirst({
      where: { slug: eventSlug, status: 'published' },
      select: { id: true, title: true },
    })
    if (event !== null)
      return { eventId: event.id, collectionId: null, title: event.title }
  }

  if (collectionSlug !== '') {
    const collection = await prisma.collection.findFirst({
      where: { slug: collectionSlug },
      select: { id: true, title: true },
    })
    if (collection !== null) {
      return { eventId: null, collectionId: collection.id, title: collection.title }
    }
  }

  return { eventId: null, collectionId: null, title: null }
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = new URL(request.url).searchParams
  const eventSlug = params.get('e') ?? ''
  const collectionSlug = params.get('c') ?? ''

  const about = await subject(eventSlug, collectionSlug)

  return await page(request, {
    state: 'asking',
    ...(about.title === null ? {} : { aboutTitle: about.title }),
    ...(eventSlug === '' ? {} : { eventSlug }),
    ...(collectionSlug === '' ? {} : { collectionSlug }),
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  const form = await request.formData()

  const eventSlug = text(form, 'event')
  const collectionSlug = text(form, 'collection')
  const about = await subject(eventSlug, collectionSlug)

  const asking: ReportPageProps = {
    state: 'asking',
    ...(about.title === null ? {} : { aboutTitle: about.title }),
    ...(eventSlug === '' ? {} : { eventSlug }),
    ...(collectionSlug === '' ? {} : { collectionSlug }),
  }

  // The same protection the claim endpoint has (M2-04 §6). Without it any page
  // anywhere could file reports in a visitor's name — which on this form means
  // burying the queue that somebody else's real report is waiting in.
  if (!isSameSite(request)) return await page(request, asking, 403)

  // The same hashing every other identifier in this product gets (rule 8): the
  // log and the record answer "was it the same person?" without answering
  // "who?".
  const { ipHash, userAgentHash } = await requestFingerprint()

  const draft = {
    reason: text(form, 'reason'),
    detail: text(form, 'detail'),
    about: text(form, 'about'),
    phone: text(form, 'phone'),
  }

  const filedRecently = await reportsFromAddress(prisma, { ipHash })
  const decision = checkReport(draft, {
    identified: about.eventId !== null || about.collectionId !== null,
    withinLimit: withinReportLimit(filedRecently),
  })

  if (!decision.ok) {
    // Everything they typed goes back into the form (UX-06). A refusal used
    // to render it empty — and `no-reason` is the ordinary miss, since the
    // radios deliberately have no default — so somebody who had written a
    // paragraph about being scammed lost the paragraph, on the form built
    // against people giving up.
    return await page(
      request,
      { ...asking, problem: decision.reason, draft },
      decision.reason === 'rate-limited' ? 429 : 400,
    )
  }

  const phone = draft.phone === '' ? null : normalisePhone(draft.phone)

  const filed = await fileReport(prisma, {
    reason: draft.reason as ReportReason,
    detail: draft.detail === '' ? null : draft.detail,
    eventId: about.eventId,
    collectionId: about.collectionId,
    aboutTyped: draft.about === '' ? null : draft.about,
    reporterPhoneE164: phone !== null && phone.ok ? phone.value : null,
    ipHash,
    userAgentHash,
  })

  // **The row says a report was filed and what it was about. It does not say
  // what was alleged and it names nobody.** The reason is a category, not a
  // sentence; the words stay in `reports`, where two people read them, rather
  // than in a log that is exported, shipped and kept far longer (rule 8).
  //
  // Filing this row still changes nothing about the event (M3-06 §1) — an
  // append to the audit log is not an act on a page.
  await recordPublicAction({
    action: 'report.filed',
    actorType: 'contributor',
    target:
      about.eventId !== null
        ? { type: 'event', id: about.eventId }
        : { type: 'report', id: filed.id },
    fingerprint: { ipHash, userAgentHash },
    metadata: { reason: draft.reason, reportId: filed.id },
  })

  const respondBy = formatDayMonth(filed.respondBy) ?? ''

  if (filed.reachable) {
    // Through the outbox like everything else. **It will queue rather than
    // send**, because no BSP exists (Part J item 3) — which is correct: the
    // outbox is the durable record and nothing is lost by the refusal (M2-08
    // §12). The acknowledgement that arrives today is the reference on screen.
    const enqueued = await enqueueNotification(prisma, {
      kind: 'report_received',
      templateId: 'reporter_report_received',
      params: { reference: filed.reference, respondBy },
      recipient: { phoneE164: phone !== null && phone.ok ? phone.value : null },
    })

    if (enqueued !== null) await markAcknowledged(prisma, { id: filed.id })
  }

  return await page(request, {
    state: 'filed',
    reference: filed.reference,
    respondBy,
    reachable: filed.reachable,
  })
}
