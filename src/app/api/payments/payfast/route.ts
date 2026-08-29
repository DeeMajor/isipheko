import type { NextRequest } from 'next/server'

import { payFastProvider } from '@/adapters/payments'
import { clientAddress } from '@/lib/client-address'
import { eventHandler } from '@/lib/payments'
import { env } from '@/lib/env'

/**
 * `POST /api/payments/payfast` — PayFast's Instant Transaction Notification.
 *
 * ## The body is read as text, before anything else touches it
 *
 * PayFast signs the bytes it sent. A body that has been through a form parser
 * and back is a different string, so parsing before verifying would mean
 * verifying a reconstruction rather than the thing that was signed — and it
 * would hand a parser to an unauthenticated caller first.
 *
 * ## What each status code means to PayFast
 *
 * PayFast documents: no `200` and the notification is re-sent immediately, then
 * after ten minutes, then at exponentially longer intervals. So the codes here
 * are a retry instruction and are chosen as one:
 *
 *   * **200 on a verified event**, once the handler has finished with it.
 *   * **200 on a rejected notification.** A forged or unconfirmable
 *     notification will not become genuine on the fourth attempt, and asking
 *     PayFast to retry it buys nothing while turning one forgery into an hours-
 *     long retry loop. It is dropped, and the rejection is recorded rather than
 *     swallowed.
 *   * **503 when the receiver is not wired**, and **500 when the handler
 *     throws** — both transient from PayFast's side, both worth retrying, and
 *     the difference between them is the difference between a deployment
 *     problem and a bug.
 *
 * ## Three of the four checks happen inside the adapter
 *
 * Signature, source and PayFast's own confirmation are in
 * `PayFastProvider.verifyWebhook`. Comparing the amount to what we expected is
 * the fourth, and it needs the record the notification is about — which is
 * M5-03's, along with the handler that credits anything. Nothing here reaches
 * the database.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text()

  let provider
  let handler

  try {
    provider = payFastProvider(env)
    handler = eventHandler()
  } catch {
    // Not configured, or no handler wired. Deliberately not 200: if a real
    // notification ever reached an unwired receiver, the right outcome is that
    // PayFast keeps it and tries again, not that it is quietly acknowledged.
    return new Response(null, { status: 503 })
  }

  const verification = await provider.verifyWebhook({
    rawBody,
    headers: Object.fromEntries(request.headers.entries()),
    sourceAddress: clientAddress(request.headers),
  })

  if (!verification.ok) {
    // The reason is on the response for a person reading a log, never in a body
    // the sender can learn from — a forger should not be told which of the four
    // checks caught them.
    return new Response(null, {
      status: 200,
      headers: { 'x-isipheko-rejected': verification.reason },
    })
  }

  await handler.handle(verification.event)

  return new Response(null, { status: 200 })
}
