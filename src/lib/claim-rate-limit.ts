import type { PrismaClient } from '@/db/generated/client'

/**
 * How often one address may claim.
 *
 * The endpoint takes no session, so this is the only thing between a script and
 * every chair on a funeral. It is deliberately generous: a family behind one
 * NAT, or a church hall on shared wifi, are ordinary and must not lock each
 * other out.
 *
 * Same caveat as M1-06 §5 — the address is only as trustworthy as the proxy in
 * front of it. Behind Cloudflare this is real; anywhere else it is a speed bump
 * on casual abuse rather than a control.
 */
export const MAX_CLAIMS_PER_ADDRESS_PER_HOUR = 20

const WINDOW_MS = 60 * 60 * 1000

export async function checkClaimRateLimit(
  db: PrismaClient,
  ipHash: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  // No address to count against — a direct hit with no proxy headers. The
  // reservation itself is still atomic; this limit simply cannot apply.
  if (ipHash === null) return true

  const since = new Date(now.getTime() - WINDOW_MS)

  const recent = await db.needClaim.count({
    where: { claimedIpHash: ipHash, createdAt: { gt: since } },
  })

  return recent < MAX_CLAIMS_PER_ADDRESS_PER_HOUR
}
