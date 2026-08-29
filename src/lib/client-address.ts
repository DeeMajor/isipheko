/**
 * Where a request came from, in order of how much the header can be trusted.
 *
 * `cf-connecting-ip` first: Cloudflare sets it and strips any copy the client
 * sent, so it is the one header here an attacker cannot choose. `x-real-ip` is
 * set by our own proxy. `x-forwarded-for` is last and is **client-controlled** —
 * anybody can send one, and its first entry is whatever they typed.
 *
 * ## Two callers, and neither may treat this as authorisation
 *
 * **Rate limiting and the audit trail** (`src/lib/audit.ts`). The per-address
 * limit is evadable by whoever is willing to rotate a header. It is a speed
 * bump on casual enumeration, not a control; the per-number limit is the one
 * that holds, because a number is not something the requester gets to invent.
 *
 * **PayFast's notification receiver** (`src/adapters/payments/`), which checks
 * the address against PayFast's own hosts. Everything above applies there too,
 * and it is exactly why that check is one of four rather than the whole of it:
 * the notification is also posted back to PayFast to be confirmed, and no
 * header a sender chooses can make PayFast say a payment was theirs.
 *
 * It is a file of its own so that the receiver does not have to import the
 * audit module, and through it the Prisma client, to read a header.
 */
export function clientAddress(header: Headers): string | null {
  const forwarded = header.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip =
    header.get('cf-connecting-ip') ??
    header.get('x-real-ip') ??
    (forwarded === undefined || forwarded === '' ? null : forwarded)

  return ip === null || ip === '' ? null : ip
}
