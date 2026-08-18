import { notFound } from 'next/navigation'
import type { NextRequest } from 'next/server'

import { sentEmail, sentWhatsApp } from '@/adapters/messaging'

/**
 * What the in-memory senders are holding. Development and test only — **404 in
 * production**, like `/dev/sms` and `/dev/tokens`.
 *
 * It exists so an end-to-end test can assert that fifty contributions produced
 * one message, which is M2-08's done-criterion and cannot be observed any other
 * way while no BSP exists. Nothing is written to a log to make it observable
 * (rule 8): a message body carries somebody's name and the umcimbi they gave
 * to, and "it is only development" is how that ends up in an aggregator.
 *
 * In production there is nothing to read even if the guard were bypassed — the
 * senders throw rather than falling back to something that delivers nothing.
 */
export function GET(request: NextRequest): Response {
  if (process.env.NODE_ENV === 'production') notFound()

  const to = request.nextUrl.searchParams.get('to')

  const whatsapp = sentWhatsApp()
    .filter((message) => to === null || message.to === to)
    .map((message) => ({
      to: message.to,
      template: message.template,
      metaName: message.metaName,
      params: message.params,
      sentAt: message.sentAt.toISOString(),
    }))

  const email = sentEmail()
    .filter((message) => to === null || message.to === to)
    .map((message) => ({
      to: message.to,
      subject: message.subject,
      body: message.body,
      sentAt: message.sentAt.toISOString(),
    }))

  return Response.json({ whatsapp, email })
}
