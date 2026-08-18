import type { NextRequest } from 'next/server'

import { env } from '@/lib/env'

/**
 * Whether a state-changing request came from this site.
 *
 * `POST /api/claim` takes no session and no token, because a contributor has
 * neither (CLAUDE.md rule 4). Without this check, any page anywhere could make
 * a visitor silently hold a chair on somebody's funeral — no money moves, which
 * does not make it harmless.
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be forged by script. Where
 * it is absent — an old browser, a curl — `Origin` is checked instead, and a
 * request with neither is refused rather than trusted.
 */
export function isSameSite(request: Request | NextRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')

  if (fetchSite !== null) {
    return fetchSite === 'same-origin' || fetchSite === 'none'
  }

  const origin = request.headers.get('origin')
  if (origin === null) return false

  return origin === env.NEXT_PUBLIC_APP_URL || origin === new URL(request.url).origin
}
