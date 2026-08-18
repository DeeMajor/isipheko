/**
 * How often one address may ask `/check`.
 *
 * **In memory, and honestly a speed bump.** Every other limit in this product
 * counts rows the action itself writes — claims, OTP challenges, self-reports
 * (M1-06 §4, M2-04 §6). A lookup writes nothing, so counting it would mean
 * writing a row per public read into an append-only table nothing may prune,
 * which is a worse thing to own than a weak limit.
 *
 * Architecture §10 puts rate limiting at the Cloudflare edge *and* in the
 * application, and for an unauthenticated public read the edge is the half
 * that does the work. This is the other half: it survives a single instance,
 * it costs nothing, and it is stated plainly rather than presented as a
 * control.
 *
 * **Enumeration is not what this defends against anyway.** A reference is three
 * letters and six Crockford characters — about 1.9 × 10^13 — and a slug is
 * sixteen base62, about 95 bits. Guessing is not a strategy at any rate limit.
 * What this bounds is somebody making the lookup expensive for us, and what the
 * answer reveals is what the public page shows to anybody holding the link.
 *
 * Same caveat as M1-06 §5 for the third time: the address is only as
 * trustworthy as the proxy in front of it.
 */

export const MAX_CHECKS_PER_ADDRESS_PER_HOUR = 60

const WINDOW_MS = 60 * 60 * 1000

interface Window {
  readonly hits: Map<string, number[]>
}

/**
 * On `globalThis`, so Next's module reloading in development does not hand two
 * halves of a request different counters.
 */
const store: Window = ((globalThis as Record<string, unknown>).__isiphekoCheckLimit ??= {
  hits: new Map<string, number[]>(),
}) as Window

export function allowCheck(
  ipHash: string | null,
  now: Date = new Date(),
  limit: number = MAX_CHECKS_PER_ADDRESS_PER_HOUR,
): boolean {
  // No address to count against — a direct hit with no proxy headers. The
  // limit simply cannot apply, and the lookup reveals nothing that matters.
  if (ipHash === null) return true

  const cutoff = now.getTime() - WINDOW_MS
  const recent = (store.hits.get(ipHash) ?? []).filter((at) => at > cutoff)

  if (recent.length >= limit) {
    store.hits.set(ipHash, recent)
    return false
  }

  recent.push(now.getTime())
  store.hits.set(ipHash, recent)

  // Bounded: a busy day must not turn this into a memory leak on a long-lived
  // process. Entries whose whole window has passed are dropped opportunistically
  // rather than on a timer nobody would notice failing.
  if (store.hits.size > 10_000) {
    for (const [key, times] of store.hits) {
      if (times.every((at) => at <= cutoff)) store.hits.delete(key)
    }
  }

  return true
}

/** Test-only. There is no production caller. */
export function clearCheckLimits(): void {
  store.hits.clear()
}
