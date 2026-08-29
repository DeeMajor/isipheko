import { describe, expect, it } from 'vitest'

import {
  PayFastSignatureError,
  payFastFormParameterString,
  payFastItnParameterString,
  payFastPostedSignature,
  payFastSignature,
  payFastSignatureMatches,
  urlencode,
} from '@/adapters/payments'

/**
 * PayFast's signature scheme.
 *
 * ## There is no published vector to pin against, and that is a finding
 *
 * PayFast's documentation shows an example ITN payload alongside the signature
 * `ad8e7685c9522c24365d7ccea8cb3db7`. **That signature does not verify against
 * that payload** under either of their two documented algorithms, with or
 * without the sandbox passphrase, with blanks included or excluded, or under
 * any plausible rendering of the three decimal fields. It is illustrative, not
 * a test vector.
 *
 * So what is pinned here is the *encoder*, against fixed strings, plus a
 * signature computed over PayFast's own documented example **data**. That fixes
 * the algorithm against regression; what proves it is the one their server
 * agrees with is `pnpm check:payfast`, which posts a signed form to the sandbox
 * and watches PayFast mint a payment page for it and answer 400 to a corrupted
 * one. It is a command rather than a test in this file because it makes a real
 * request to a third party, and a gate that fails when the wifi does is a gate
 * people re-run instead of read.
 *
 * **The incoming direction is still unconfirmed** — an ITN needs a public
 * `notify_url` and a completed sandbox payment. Recorded as partially met, the
 * same posture as M2-07's WhatsApp rendering and M4-03b's preflight. See
 * docs/decisions.md M5-01 §4.
 */

const PASSPHRASE = 'jt7NOE43FZPn'

describe('urlencode', () => {
  it('follows PHP, which is what PayFast computes its own signature with', () => {
    expect(urlencode('test product')).toBe('test+product')
    expect(urlencode('https://www.example.com/notify')).toBe(
      'https%3A%2F%2Fwww.example.com%2Fnotify',
    )
    expect(urlencode('R1 234,56')).toBe('R1+234%2C56')
    expect(urlencode('a-b_c.d')).toBe('a-b_c.d')
    expect(urlencode('MTH-4K7B2X')).toBe('MTH-4K7B2X')
  })

  it('percent-encodes in upper case, as PayFast requires', () => {
    expect(urlencode('://')).toBe('%3A%2F%2F')
    expect(urlencode(':/')).not.toContain('%3a')
  })

  it('encodes UTF-8 a byte at a time', () => {
    // A surname with a diacritic is ordinary here, and encoding the code point
    // rather than the bytes would produce a signature PayFast cannot reproduce.
    expect(urlencode('ú')).toBe('%C3%BA')
  })

  it('escapes the characters encodeURIComponent leaves alone', () => {
    // This is the divergence the whole file is about: JavaScript's
    // encodeURIComponent leaves these, PHP's urlencode escapes them, and both
    // implementations are published by PayFast as correct.
    expect(urlencode('~')).toBe('%7E')
    expect(urlencode("'")).toBe('%27')
    expect(urlencode('!')).toBe('%21')
    expect(urlencode('(')).toBe('%28')
    expect(urlencode('*')).toBe('%2A')
  })
})

describe('the outgoing parameter string', () => {
  // PayFast's own documented example data, from the step-2 signature section.
  const FIELDS = [
    ['merchant_id', '10000100'],
    ['merchant_key', '46f0cd694581a'],
    ['return_url', 'https://www.example.com'],
    ['notify_url', 'https://www.example.com/notify_url'],
    ['m_payment_id', 'UniqueId'],
    ['amount', '200'],
    ['item_name', 'test product'],
  ] as const

  it('is the fields in the documented order, url-encoded', () => {
    expect(payFastFormParameterString(FIELDS)).toBe(
      'merchant_id=10000100&merchant_key=46f0cd694581a&' +
        'return_url=https%3A%2F%2Fwww.example.com&' +
        'notify_url=https%3A%2F%2Fwww.example.com%2Fnotify_url&' +
        'm_payment_id=UniqueId&amount=200&item_name=test+product',
    )
  })

  it('signs it under the passphrase', () => {
    // Frozen from our own implementation over PayFast's example data. It pins
    // the algorithm against regression; it does not prove PayFast agrees.
    expect(payFastSignature(payFastFormParameterString(FIELDS), PASSPHRASE)).toBe(
      'f74a321292f7a839c770d42868e21db1',
    )
  })

  it('omits blank fields, which the incoming direction does not', () => {
    expect(
      payFastFormParameterString([
        ['a', '1'],
        ['b', ''],
        ['c', '3'],
      ]),
    ).toBe('a=1&c=3')
  })

  it('is order-sensitive, so an object would make a correct signature an accident', () => {
    const forwards = payFastFormParameterString([
      ['a', '1'],
      ['b', '2'],
    ])
    const backwards = payFastFormParameterString([
      ['b', '2'],
      ['a', '1'],
    ])

    expect(forwards).not.toBe(backwards)
  })

  it('refuses to sign a value whose encoding is ambiguous', () => {
    // We control every outgoing field, so this refusal costs nothing and takes
    // the whole PHP-versus-JavaScript question off the table in this direction.
    expect(() => payFastFormParameterString([['item_name', "Thabo's umcimbi"]])).toThrow(
      PayFastSignatureError,
    )
  })

  it('names the field and never the value', () => {
    // The value is payer data and this message reaches logs (CLAUDE.md rule 8).
    try {
      payFastFormParameterString([['name_last', "O'Brien"]])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(PayFastSignatureError)
      expect((error as Error).message).toContain('name_last')
      expect((error as Error).message).not.toContain('Brien')
    }
  })
})

describe('the incoming parameter string', () => {
  const BODY =
    'm_payment_id=MTH-4K7B2X&pf_payment_id=1089250&payment_status=COMPLETE&' +
    'item_name=test+product&amount_gross=200.00&amount_fee=-4.60&amount_net=195.40&' +
    'custom_str1=&name_last=O%27Brien&merchant_id=10000100'

  it('takes the raw body byte for byte, so nothing is re-encoded', () => {
    // The apostrophe is the point. A decode-and-re-encode round trip would turn
    // `O%27Brien` into `O'Brien` under encodeURIComponent and back into
    // `O%27Brien` under urlencode — and the two disagree, so whichever we chose
    // would be wrong half the time. Cutting the raw string cannot be wrong.
    expect(payFastItnParameterString(`${BODY}&signature=abc`)).toBe(BODY)
  })

  it('keeps blank fields, unlike the outgoing direction', () => {
    expect(payFastItnParameterString(`${BODY}&signature=abc`)).toContain('custom_str1=')
  })

  it('removes the signature pair wherever it is', () => {
    // PayFast documents it last and its own reference implementation stops at
    // it. Removing rather than truncating survives a reordering.
    expect(payFastItnParameterString('a=1&signature=abc&b=2')).toBe('a=1&b=2')
    expect(payFastItnParameterString('signature=abc&b=2')).toBe('b=2')
  })

  it('refuses a body carrying two signature pairs', () => {
    // The reason removal is safe: a verifier that removed one and read the
    // first would let an attacker prepend a signature over a body they chose.
    // Two is not a mismatch, it is not an ITN.
    expect(payFastItnParameterString('signature=abc&a=1&signature=def')).toBeNull()
    expect(payFastPostedSignature('signature=abc&a=1&signature=def')).toBeNull()
    expect(payFastSignatureMatches('signature=abc&a=1&signature=def', PASSPHRASE)).toBe(
      'unreadable',
    )
  })

  it('answers null when there is no signature at all', () => {
    // Not an ITN. A rejection, and a different one from a mismatch.
    expect(payFastItnParameterString('a=1&b=2')).toBeNull()
    expect(payFastPostedSignature('a=1&b=2')).toBeNull()
  })

  it('reads the posted signature in lower case', () => {
    expect(payFastPostedSignature(`${BODY}&signature=ABCDEF`)).toBe('abcdef')
  })
})

describe('payFastSignatureMatches', () => {
  const BODY = 'm_payment_id=MTH-4K7B2X&pf_payment_id=1089250&payment_status=COMPLETE'
  const SIGNATURE = payFastSignature(BODY, PASSPHRASE)

  it('accepts a body signed under the passphrase', () => {
    expect(payFastSignatureMatches(`${BODY}&signature=${SIGNATURE}`, PASSPHRASE)).toBe(
      'ok',
    )
  })

  it('rejects one signed under a different passphrase', () => {
    expect(
      payFastSignatureMatches(`${BODY}&signature=${SIGNATURE}`, 'something-else'),
    ).toBe('bad-signature')
  })

  it('rejects a body whose fields were altered after signing', () => {
    const tampered = BODY.replace('COMPLETE', 'CANCELLED')

    expect(
      payFastSignatureMatches(`${tampered}&signature=${SIGNATURE}`, PASSPHRASE),
    ).toBe('bad-signature')
  })

  it('reports an unreadable body separately from a wrong signature', () => {
    expect(payFastSignatureMatches(BODY, PASSPHRASE)).toBe('unreadable')
  })
})
