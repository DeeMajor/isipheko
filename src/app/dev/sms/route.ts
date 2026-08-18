import { notFound } from 'next/navigation'
import type { NextRequest } from 'next/server'

import { lastSmsTo } from '@/adapters/messaging'
import { normalisePhone } from '@/domain/auth'

/**
 * Reads the last SMS the in-memory sender held for a number. Development and
 * test only — **404 in production**, like `/dev/tokens`.
 *
 * This exists so the code never has to be printed. Every OTP tutorial logs it
 * in development, and that is how codes leak: development logs end up in
 * aggregators, in screen shares, and pasted into issues. Playwright reads the
 * code from here instead, and nothing is written to stdout, to a file or to a
 * logger anywhere in the flow.
 *
 * In production the in-memory sender does not exist either — `smsSender()`
 * throws rather than falling back to something that delivers nothing — so this
 * route has nothing to read even if the guard were somehow bypassed.
 */
export function GET(request: NextRequest): Response {
  if (process.env.NODE_ENV === 'production') notFound()

  const parsed = normalisePhone(request.nextUrl.searchParams.get('phone') ?? '')
  if (!parsed.ok) return Response.json({ error: parsed.reason }, { status: 400 })

  const message = lastSmsTo(parsed.value)
  if (message === undefined)
    return Response.json({ error: 'nothing-sent' }, { status: 404 })

  return Response.json({ body: message.body, sentAt: message.sentAt.toISOString() })
}
