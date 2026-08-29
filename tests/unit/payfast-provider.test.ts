import { describe, expect, it, vi } from 'vitest'

import {
  PayFastProvider,
  centsToZar,
  payFastSignature,
  zarToCents,
  type PayFastDeps,
} from '@/adapters/payments'
import { fromCents, toCents } from '@/domain/money'
import { PaymentProviderError, amountMatches } from '@/domain/payments'

/**
 * The PayFast adapter: a checkout, and three of the four security checks.
 *
 * The fourth — comparing the amount to what we expected — is `amountMatches` in
 * the domain, done by the handler where the record is. An adapter doing it
 * would have to read the database, which would put a repository behind the
 * payment interface. See docs/decisions.md M5-01 §5.
 */

const CONFIG = {
  merchantId: '10000100',
  merchantKey: '46f0cd694581a',
  passphrase: 'jt7NOE43FZPn',
  mode: 'sandbox',
} as const

const PAYFAST_IP = '197.97.145.145'

function deps(overrides: Partial<PayFastDeps> = {}): PayFastDeps {
  return {
    fetch: vi.fn(() => Promise.resolve(new Response('VALID'))),
    resolveHost: (host) =>
      Promise.resolve(host.endsWith('payfast.co.za') ? [PAYFAST_IP] : []),
    now: () => 1_700_000_000_000,
    ...overrides,
  }
}

const REQUEST = {
  reference: 'MTH-4K7B2X',
  amount: fromCents(50_000n),
  description: 'Umngcwabo kaMaMkhize',
  beneficiary: null,
  returnUrl: 'https://isipheko.co.za/e/abc/done',
  cancelUrl: 'https://isipheko.co.za/e/abc',
  notifyUrl: 'https://isipheko.co.za/api/payments/payfast',
} as const

/** A body PayFast would post, signed under the sandbox passphrase. */
function itn(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    m_payment_id: 'MTH-4K7B2X',
    pf_payment_id: '1089250',
    payment_status: 'COMPLETE',
    item_name: 'Umngcwabo+kaMaMkhize',
    amount_gross: '500.00',
    amount_fee: '-11.50',
    amount_net: '488.50',
    custom_str1: '',
    merchant_id: '10000100',
    ...overrides,
  }

  const body = Object.entries(fields)
    .map(([name, value]) => `${name}=${value}`)
    .join('&')

  return `${body}&signature=${payFastSignature(body, CONFIG.passphrase)}`
}

function delivery(rawBody: string, sourceAddress: string | null = PAYFAST_IP) {
  return { rawBody, headers: {}, sourceAddress }
}

describe('amount conversion at the boundary', () => {
  it('reads a decimal string without a float ever existing', () => {
    // CLAUDE.md rule 7. `parseFloat('195.40')` is the ordinary way to do this
    // and is exactly what the rule exists to prevent.
    expect(toCents(zarToCents('200.00') ?? fromCents(0n))).toBe(20_000n)
    expect(toCents(zarToCents('195.40') ?? fromCents(0n))).toBe(19_540n)
    expect(toCents(zarToCents('0.05') ?? fromCents(0n))).toBe(5n)
    expect(toCents(zarToCents('200') ?? fromCents(0n))).toBe(20_000n)
    expect(toCents(zarToCents('200.4') ?? fromCents(0n))).toBe(20_040n)
  })

  it('drops the sign, because Money is a magnitude', () => {
    // `amount_fee` arrives negative — it is a deduction. Direction is carried
    // by which field it came from, not by the number (M1-03).
    expect(toCents(zarToCents('-4.60') ?? fromCents(0n))).toBe(460n)
  })

  it('answers null on anything that is not a plain decimal', () => {
    for (const value of ['', 'R200', '1e3', '200.000', '2,00', 'NaN', ' 200 . 00']) {
      expect(zarToCents(value)).toBeNull()
    }
  })

  it('writes cents back as two places, always', () => {
    expect(centsToZar(fromCents(20_000n))).toBe('200.00')
    expect(centsToZar(fromCents(5n))).toBe('0.05')
    expect(centsToZar(fromCents(123_456n))).toBe('1234.56')
  })
})

describe('starting a pay-in', () => {
  it('posts a form to PayFast with a signature over the fields in order', async () => {
    const handle = await new PayFastProvider(CONFIG, deps()).startPayIn(REQUEST)

    expect(handle.redirect.kind).toBe('post')
    if (handle.redirect.kind !== 'post') expect.unreachable()

    expect(handle.redirect.url).toBe('https://sandbox.payfast.co.za/eng/process')

    const names = handle.redirect.fields.map(([name]) => name)
    expect(names).toEqual([
      'merchant_id',
      'merchant_key',
      'return_url',
      'cancel_url',
      'notify_url',
      'm_payment_id',
      'amount',
      'item_name',
      'signature',
    ])

    expect(handle.redirect.fields).toContainEqual(['amount', '500.00'])
    expect(handle.redirect.fields).toContainEqual(['m_payment_id', 'MTH-4K7B2X'])
  })

  it('has no provider reference yet, and says null rather than inventing one', () => {
    // PayFast issues `pf_payment_id` only once somebody has actually paid.
    return expect(
      new PayFastProvider(CONFIG, deps())
        .startPayIn(REQUEST)
        .then((handle) => handle.providerReference),
    ).resolves.toBeNull()
  })

  it('carries nothing identifying the payer', async () => {
    const handle = await new PayFastProvider(CONFIG, deps()).startPayIn(REQUEST)
    if (handle.redirect.kind !== 'post') expect.unreachable()

    // PayFast accepts name_first, name_last, email_address and cell_number. A
    // contributor is never asked for any of them (CLAUDE.md rule 4) and the
    // domain type has nowhere to put them, so none can be sent.
    for (const [name] of handle.redirect.fields) {
      expect(name).not.toMatch(/name_first|name_last|email|cell/)
    }
  })

  it('refuses a beneficiary rather than quietly ignoring one', async () => {
    // General Terms 5.17(vi). Silently dropping it would settle a contribution
    // into our own account while the caller believed it went to the family.
    await expect(
      new PayFastProvider(CONFIG, deps()).startPayIn({
        ...REQUEST,
        beneficiary: 'BEN-1',
      }),
    ).rejects.toThrow(PaymentProviderError)
  })

  it('uses the live host only when the mode says live', async () => {
    const live = await new PayFastProvider(
      { ...CONFIG, mode: 'live' },
      deps(),
    ).startPayIn(REQUEST)
    if (live.redirect.kind !== 'post') expect.unreachable()

    expect(live.redirect.url).toBe('https://www.payfast.co.za/eng/process')
  })

  it('refuses to construct without a passphrase', () => {
    // Without one the signature is a checksum over data the sender chose.
    expect(() => new PayFastProvider({ ...CONFIG, passphrase: '' }, deps())).toThrow(
      PaymentProviderError,
    )
  })
})

describe('verifying a notification', () => {
  it('accepts one that passes all three checks', async () => {
    const provider = new PayFastProvider(CONFIG, deps())

    const result = await provider.verifyWebhook(delivery(itn()))

    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    if (result.event.kind !== 'pay-in-completed') expect.unreachable()

    expect(result.event.reference).toBe('MTH-4K7B2X')
    expect(result.event.providerReference).toBe('1089250')
    expect(toCents(result.event.amount)).toBe(50_000n)
    expect(result.event.fee === null ? null : toCents(result.event.fee)).toBe(1_150n)
    expect(result.event.net === null ? null : toCents(result.event.net)).toBe(48_850n)
  })

  it('leaves the amount check to the caller, and reports enough to make it', async () => {
    const result = await new PayFastProvider(CONFIG, deps()).verifyWebhook(
      delivery(itn()),
    )
    if (!result.ok) expect.unreachable()

    expect(amountMatches(fromCents(50_000n), result.event)).toBe(true)
    expect(amountMatches(fromCents(50_001n), result.event)).toBe(false)
  })

  it('rejects a tampered body', async () => {
    const body = itn().replace('amount_gross=500.00', 'amount_gross=5.00')

    await expect(
      new PayFastProvider(CONFIG, deps()).verifyWebhook(delivery(body)),
    ).resolves.toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('rejects a correctly signed notification from somewhere else', async () => {
    await expect(
      new PayFastProvider(CONFIG, deps()).verifyWebhook(delivery(itn(), '203.0.113.9')),
    ).resolves.toEqual({ ok: false, reason: 'untrusted-source' })
  })

  it('rejects one with no source address at all', async () => {
    await expect(
      new PayFastProvider(CONFIG, deps()).verifyWebhook(delivery(itn(), null)),
    ).resolves.toEqual({ ok: false, reason: 'untrusted-source' })
  })

  it('checks the source before calling PayFast, so forgeries cannot make us fan out', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('VALID')))

    await new PayFastProvider(CONFIG, deps({ fetch })).verifyWebhook(
      delivery(itn(), '203.0.113.9'),
    )

    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects one PayFast will not confirm', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('INVALID')))

    await expect(
      new PayFastProvider(CONFIG, deps({ fetch })).verifyWebhook(delivery(itn())),
    ).resolves.toEqual({ ok: false, reason: 'not-confirmed' })
  })

  it('rejects one it could not ask PayFast about', async () => {
    // Unreachable is not the same as invalid, but acting on an unconfirmed
    // notification is the failure the check exists to prevent. PayFast retries
    // for hours, so an outage costs a delay rather than a contribution.
    const fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))

    await expect(
      new PayFastProvider(CONFIG, deps({ fetch })).verifyWebhook(delivery(itn())),
    ).resolves.toEqual({ ok: false, reason: 'not-confirmed' })
  })

  it('posts the body back to PayFast exactly as it arrived', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('VALID')))
    const body = itn()

    await new PayFastProvider(CONFIG, deps({ fetch })).verifyWebhook(delivery(body))

    expect(fetch).toHaveBeenCalledWith(
      'https://sandbox.payfast.co.za/eng/query/validate',
      expect.objectContaining({ method: 'POST', body }),
    )
  })

  it('reads a cancellation', async () => {
    const result = await new PayFastProvider(CONFIG, deps()).verifyWebhook(
      delivery(itn({ payment_status: 'CANCELLED' })),
    )

    expect(result).toEqual({
      ok: true,
      event: {
        kind: 'pay-in-cancelled',
        reference: 'MTH-4K7B2X',
        providerReference: '1089250',
      },
    })
  })

  it('separates a status it has not decided how to treat from one it could not read', async () => {
    await expect(
      new PayFastProvider(CONFIG, deps()).verifyWebhook(
        delivery(itn({ payment_status: 'PENDING' })),
      ),
    ).resolves.toEqual({ ok: false, reason: 'unsupported-event' })

    await expect(
      new PayFastProvider(CONFIG, deps()).verifyWebhook(
        delivery(itn({ m_payment_id: '' })),
      ),
    ).resolves.toEqual({ ok: false, reason: 'unreadable' })
  })

  it('caches the resolved hosts rather than resolving per notification', async () => {
    const resolveHost = vi.fn(() => Promise.resolve([PAYFAST_IP]))
    const provider = new PayFastProvider(CONFIG, deps({ resolveHost }))

    await provider.verifyWebhook(delivery(itn()))
    await provider.verifyWebhook(delivery(itn()))

    // Four hosts, once — not eight.
    expect(resolveHost).toHaveBeenCalledTimes(4)
  })

  it('fails closed when no host resolves', async () => {
    const provider = new PayFastProvider(
      CONFIG,
      deps({
        resolveHost: () => Promise.reject(new Error('no resolver')),
      }),
    )

    await expect(provider.verifyWebhook(delivery(itn()))).resolves.toEqual({
      ok: false,
      reason: 'untrusted-source',
    })
  })
})
