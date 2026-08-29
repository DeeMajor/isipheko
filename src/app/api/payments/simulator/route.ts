import { notFound } from 'next/navigation'
import type { NextRequest } from 'next/server'

import {
  paymentProvider,
  recordedPaymentEvents,
  simulatorState,
} from '@/adapters/payments'
import type { PaymentEvent } from '@/domain/payments'
import { clientAddress } from '@/lib/client-address'
import { eventHandler } from '@/lib/payments'
import { env } from '@/lib/env'

/**
 * `POST /api/payments/simulator` — where the simulator's notifications land.
 *
 * **This is the point of the simulator.** It POSTs here over HTTP, signed, and
 * this route verifies the signature and hands the event to the same seam a real
 * provider's notification reaches. Nothing calls a repository from inside the
 * simulator, so the receiver, the verification and the handler are all
 * exercised by the tests rather than stepped around by them.
 *
 * **404 in production**, like `/dev/sms` and `/dev/tokens`. It is an `/api`
 * route rather than a `/dev` one because its shape is production's — a real
 * provider posts to a route exactly like this — but it must not exist where a
 * real one does. In production `paymentProvider()` throws as well, so there
 * would be nothing to verify with even if this guard were bypassed. Two
 * refusals, and the second is not a spare: the guard is a route-level decision
 * and the throw is a construction-level one, and they fail independently.
 *
 * `GET` reports what the simulator is holding, for the E2E suite to assert
 * against — the same idiom as `/dev/sms`, and equally absent in production.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (process.env.NODE_ENV === 'production') notFound()

  const rawBody = await request.text()

  const provider = paymentProvider(env.NODE_ENV)

  const verification = await provider.verifyWebhook({
    rawBody,
    headers: Object.fromEntries(request.headers.entries()),
    sourceAddress: clientAddress(request.headers),
  })

  if (!verification.ok) {
    return Response.json({ rejected: verification.reason }, { status: 400 })
  }

  await eventHandler().handle(verification.event)

  return Response.json({ accepted: verification.event.kind })
}

/**
 * Amounts leave as strings. `Money` is a `bigint` and `JSON.stringify` throws on
 * one — which is the right behaviour for a type that must never become a float
 * (CLAUDE.md rule 7), and means the conversion has to be written out here
 * rather than happening by accident.
 */
function asJson(event: PaymentEvent): Record<string, unknown> {
  switch (event.kind) {
    case 'pay-in-completed':
      return {
        kind: event.kind,
        reference: event.reference,
        providerReference: event.providerReference,
        amountCents: event.amount.toString(),
        feeCents: event.fee === null ? null : event.fee.toString(),
        netCents: event.net === null ? null : event.net.toString(),
      }
    case 'pay-in-cancelled':
      return {
        kind: event.kind,
        reference: event.reference,
        providerReference: event.providerReference,
      }
    case 'withdrawal-completed':
      return {
        kind: event.kind,
        withdrawal: event.withdrawal,
        beneficiary: event.beneficiary,
        amountCents: event.amount.toString(),
      }
  }
}

export function GET(): Response {
  if (process.env.NODE_ENV === 'production') notFound()

  return Response.json({
    ...simulatorState(),
    events: recordedPaymentEvents().map(asJson),
  })
}
