import { createHash } from 'node:crypto'

/**
 * PayFast's signature scheme, both directions.
 *
 * ## On MD5
 *
 * This file hashes with MD5, which is broken for every purpose this codebase
 * would otherwise choose a hash for. It is here because it is **PayFast's
 * scheme, not ours** — their server computes the signature they send us, and a
 * stronger hash on our side would simply not match.
 *
 * What makes the notification safe is not this hash. PayFast documents **four**
 * checks and the signature is one of them: the notification must also come from
 * a PayFast host, the amount must match what we expected, and the notification
 * must be posted back to PayFast and confirmed by them before it is acted on.
 * A forged notification therefore has to originate from PayFast's network
 * *and* survive PayFast telling us it is not theirs. See
 * `payfast-provider.ts`.
 *
 * Nothing else in this product uses MD5. The ledger chain is SHA-256 (M2-01),
 * one-time codes are HMAC-SHA256 (M1-06 §3), and the simulator signs with
 * HMAC-SHA256 because it is ours to choose.
 *
 * ## Two directions, and they are not symmetrical
 *
 * **Outgoing** (the checkout form): the non-blank fields, in the order PayFast
 * documents them, url-encoded, joined with `&`, then the passphrase appended,
 * then MD5. Blank fields are omitted.
 *
 * **Incoming** (the ITN): every posted field except `signature`, **including
 * the blank ones** — PayFast posts empty strings for the custom variables
 * nobody used, and they are part of the string it signed. Their own reference
 * implementations differ in exactly this way, and it is the most common cause
 * of a mismatch.
 *
 * ## The incoming direction does not re-encode anything, on purpose
 *
 * PayFast's reference implementations decode the posted body into a map and
 * then encode it again. That round trip only reproduces the original bytes if
 * their encoder and ours agree on every character — and the two implementations
 * PayFast publishes **do not agree with each other**. PHP's `urlencode` escapes
 * `!'()*~`; JavaScript's `encodeURIComponent` leaves them alone. A surname
 * containing an apostrophe is enough to make the two disagree, and O'Brien is
 * not a rare payer.
 *
 * So {@link payFastItnParameterString} takes the raw body and removes the
 * `signature` pair from it, byte for byte, decoding nothing. There is nothing
 * to get wrong: whatever PayFast encoded is what we hash.
 *
 * The outgoing direction has to encode, because we are producing the fields. It
 * follows PHP's `urlencode` — PayFast's server is PHP and its own signature is
 * computed that way — and {@link assertUnambiguous} refuses outright to sign a
 * value containing a character the two published implementations disagree on.
 * We control every outgoing field, so that refusal costs nothing and makes the
 * ambiguity unreachable rather than merely unlikely.
 *
 * ## What is confirmed, and what is not
 *
 * PayFast publishes an example ITN payload alongside the signature
 * `ad8e7685c9522c24365d7ccea8cb3db7`. **That signature does not verify against
 * that payload** under any combination of their two documented algorithms,
 * either passphrase, or any plausible rendering of the decimal fields — it is
 * an illustrative placeholder rather than a test vector. There is no published
 * vector to pin against.
 *
 * So the outgoing direction was settled against their server instead.
 * `pnpm check:payfast` posts a signed form to the sandbox and a corrupted one
 * after it: **PayFast mints a payment page for ours and answers 400 to the
 * corrupted one.** The PHP-versus-JavaScript question above is therefore
 * answered rather than reasoned about — PHP's `urlencode` is what their server
 * agrees with.
 *
 * **The incoming direction is not confirmed.** An ITN is posted by PayFast to a
 * publicly reachable `notify_url` after a completed sandbox payment, which
 * needs a public URL and a person. That half stays partially met, the same
 * posture as M2-07's WhatsApp rendering and M4-03b's printer preflight. See
 * docs/decisions.md M5-01 §4.
 */

/**
 * The characters on which PHP's `urlencode` and JavaScript's
 * `encodeURIComponent` disagree. Both of PayFast's reference implementations
 * are official, so a value containing one of these has two equally documented
 * signatures and no way to choose between them.
 */
const AMBIGUOUS = /[!'()*~]/

export class PayFastSignatureError extends Error {
  override readonly name = 'PayFastSignatureError'

  /** Carries the field name, never the value — the value is payer data. */
  readonly field: string

  constructor(field: string) {
    super(
      `PayFast: the value of "${field}" contains a character that PayFast's PHP and ` +
        'JavaScript reference implementations encode differently, so its signature is ' +
        'ambiguous. Do not send it.',
    )
    this.field = field
  }
}

/**
 * PHP's `urlencode`: everything but `A-Za-z0-9-_.` is percent-encoded in upper
 * case, and a space becomes `+`.
 *
 * Hand-written rather than composed from `encodeURIComponent`, because the
 * difference between the two is the entire subject of this file and expressing
 * one in terms of the other would hide it.
 */
export function urlencode(value: string): string {
  let out = ''

  for (const byte of Buffer.from(value, 'utf8')) {
    const char = String.fromCharCode(byte)

    if (/[A-Za-z0-9\-_.]/.test(char)) {
      out += char
    } else if (char === ' ') {
      out += '+'
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }

  return out
}

function assertUnambiguous(field: string, value: string): void {
  if (AMBIGUOUS.test(value)) throw new PayFastSignatureError(field)
}

/**
 * The string PayFast signs for an outgoing payment request.
 *
 * Order is the caller's — PayFast's documented attribute order, not
 * alphabetical, and explicitly not the ordering its own API signature uses.
 * That is why {@link PayInRedirect} carries ordered pairs rather than an object.
 */
export function payFastFormParameterString(
  fields: readonly (readonly [string, string])[],
): string {
  return fields
    .filter(([, value]) => value !== '')
    .map(([name, value]) => {
      const trimmed = value.trim()
      assertUnambiguous(name, trimmed)
      return `${name}=${urlencode(trimmed)}`
    })
    .join('&')
}

/**
 * The two halves of an incoming notification: what PayFast signed, and what it
 * says the signature is.
 *
 * **Exactly one `signature` pair, or nothing.** PayFast documents it last and
 * its own PHP reference stops at it, which truncates the body if it is ever not
 * last — safe, but it fails every notification rather than one. Removing the
 * pair wherever it sits survives a reordering; requiring there to be exactly
 * one closes what that would otherwise open, which is a second `signature=`
 * injected earlier in the body for a verifier that takes the first it finds.
 *
 * Nothing is decoded. Whatever PayFast encoded is what gets hashed — see the
 * module note on why a decode-and-re-encode round trip cannot be made correct.
 */
function splitSignature(
  rawBody: string,
): { readonly parameterString: string; readonly signature: string } | null {
  const pairs = rawBody.split('&')
  const found = pairs.flatMap((pair, index) =>
    pair.startsWith('signature=') ? [index] : [],
  )

  if (found.length !== 1) return null

  const index = found[0] ?? 0
  const pair = pairs[index] ?? ''

  return {
    parameterString: pairs.filter((_, other) => other !== index).join('&'),
    signature: pair.slice('signature='.length).toLowerCase(),
  }
}

/** What PayFast signed. `null` where the body carries no single signature pair. */
export function payFastItnParameterString(rawBody: string): string | null {
  return splitSignature(rawBody)?.parameterString ?? null
}

/** The `signature` value as posted, lower-cased for comparison. */
export function payFastPostedSignature(rawBody: string): string | null {
  return splitSignature(rawBody)?.signature ?? null
}

/**
 * MD5 of the parameter string with the passphrase salted onto the end, lower
 * case, as PayFast documents.
 *
 * An account without a passphrase signs the parameter string alone. PayFast
 * recommends setting one and requires it for recurring billing; this product
 * requires one, because without it the signature is a checksum over data the
 * sender chose rather than a shared secret.
 */
export function payFastSignature(parameterString: string, passphrase: string): string {
  assertUnambiguous('passphrase', passphrase.trim())

  const salted = `${parameterString}&passphrase=${urlencode(passphrase.trim())}`

  return createHash('md5').update(salted, 'utf8').digest('hex')
}

/**
 * Constant-time-ish comparison is not attempted here and would be theatre: the
 * attacker already knows the parameter string, so a timing oracle on the digest
 * buys nothing they cannot compute directly. The three other checks are what
 * this rests on.
 */
export function payFastSignatureMatches(
  rawBody: string,
  passphrase: string,
): 'ok' | 'bad-signature' | 'unreadable' {
  const parts = splitSignature(rawBody)

  if (parts === null) return 'unreadable'

  return payFastSignature(parts.parameterString, passphrase) === parts.signature
    ? 'ok'
    : 'bad-signature'
}
