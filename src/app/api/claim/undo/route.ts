import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

import { prisma } from '@/db/client'
import { undoClaim } from '@/db/repositories/needs'
import { CLAIM_COOKIE, claimFromCookie } from '@/lib/claim-session'
import { isSameSite } from '@/lib/same-site'

/**
 * `POST /api/claim/undo` — the fifteen seconds after a claim.
 *
 * The right to undo is a **capability, not an identity**: a contributor has no
 * account (CLAUDE.md rule 4), so the server issued an `HttpOnly` cookie when the
 * claim was made and this checks it. Nothing in the request body grants
 * anything — the item id is there to redirect back to the right place, and
 * changing it gets somebody nowhere.
 *
 * The window is enforced here, not by the button disappearing. A window that
 * only exists in the interface is not a window.
 *
 * This is **not** withdrawal. Withdrawal is the organiser releasing something
 * back to the board and has no window; they are different acts by different
 * people.
 */

function redirect(slug: string, query: string): Response {
  return new Response(null, { status: 303, headers: { location: `/e/${slug}?${query}` } })
}

export async function POST(request: NextRequest): Promise<Response> {
  const form = await request.formData()
  const value = (key: string) => {
    const entry = form.get(key)
    return typeof entry === 'string' ? entry.trim() : ''
  }

  const slug = value('slug')
  const itemId = value('item')

  if (!isSameSite(request)) {
    return redirect(slug, 'claim=error&reason=cross-site')
  }

  const jar = await cookies()
  const claimId = claimFromCookie(jar.get(CLAIM_COOKIE)?.value)

  // Missing, malformed and forged all land here. Somebody probing learns which
  // of the three they managed only if we tell them, so we do not.
  if (claimId === null) return redirect(slug, `claim=too-late&item=${itemId}`)

  const outcome = await undoClaim(prisma, { claimId })

  if (!outcome.ok) {
    return redirect(slug, `claim=too-late&item=${itemId}`)
  }

  // The capability is spent. Clearing it stops a second undo of a claim that no
  // longer exists, and stops the cookie outliving the fifteen seconds.
  const headers = new Headers({ location: `/e/${slug}?claim=undone&item=${itemId}` })
  headers.append(
    'set-cookie',
    `${CLAIM_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly`,
  )

  return new Response(null, { status: 303, headers })
}
