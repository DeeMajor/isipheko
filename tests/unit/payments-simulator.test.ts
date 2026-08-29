import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SIMULATOR_SIGNATURE_HEADER,
  SimulatedPaymentProvider,
  clearPaymentSimulator,
  simulatorSignature,
  simulatorState,
} from '@/adapters/payments'
import { fromCents, toCents } from '@/domain/money'
import { PaymentProviderError, type WebhookDelivery } from '@/domain/payments'

/**
 * The simulator holds a balance and settles only on request — and everything it
 * reports, it reports by POSTing.
 *
 * The POST is captured here rather than sent, and fed straight back into
 * `verifyWebhook`, so this file proves the loop closes: what the simulator sends
 * is what the receiver can verify. `tests/e2e/payments-simulator.spec.ts` does
 * the same thing over real HTTP through the real route, which is the assertion
 * that matters; this one is fast enough to run on every save.
 */

const NOTIFY = 'https://isipheko.test/api/payments/simulator'

interface Posted {
  readonly url: string
  readonly rawBody: string
  readonly signature: string
}

function harness(): {
  provider: SimulatedPaymentProvider
  posted: Posted[]
} {
  const posted: Posted[] = []
  let id = 0

  const provider = new SimulatedPaymentProvider({
    fetch: ((url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>

      posted.push({
        url,
        rawBody: typeof init.body === 'string' ? init.body : '',
        signature: headers[SIMULATOR_SIGNATURE_HEADER] ?? '',
      })

      return Promise.resolve(new Response(null, { status: 200 }))
    }) as unknown as typeof globalThis.fetch,
    newId: () => {
      id += 1
      return String(id)
    },
  })

  return { provider, posted }
}

function deliveryOf(post: Posted): WebhookDelivery {
  return {
    rawBody: post.rawBody,
    headers: { [SIMULATOR_SIGNATURE_HEADER]: post.signature },
    sourceAddress: null,
  }
}

beforeEach(() => {
  clearPaymentSimulator()
})

describe('a pay-in', () => {
  it('sends the payer somewhere and holds nothing until they have paid', async () => {
    const { provider, posted } = harness()

    const handle = await provider.startPayIn({
      reference: 'MTH-4K7B2X',
      amount: fromCents(50_000n),
      description: 'Umngcwabo',
      beneficiary: 'BEN-1',
      returnUrl: '/done',
      cancelUrl: '/e/abc',
      notifyUrl: NOTIFY,
    })

    expect(handle.redirect.kind).toBe('follow')
    expect(posted).toHaveLength(0)
    expect(await provider.balanceFor('BEN-1')).toEqual({
      held: fromCents(0n),
      paidOut: fromCents(0n),
    })
  })

  it('credits the beneficiary and POSTs when the payer pays', async () => {
    const { provider, posted } = harness()

    await provider.startPayIn({
      reference: 'MTH-4K7B2X',
      amount: fromCents(50_000n),
      description: 'Umngcwabo',
      beneficiary: 'BEN-1',
      returnUrl: '/done',
      cancelUrl: '/e/abc',
      notifyUrl: NOTIFY,
    })

    await provider.completePayIn('MTH-4K7B2X')

    expect(posted).toHaveLength(1)
    expect(posted[0]?.url).toBe(NOTIFY)

    const balance = await provider.balanceFor('BEN-1')
    expect(balance === null ? null : toCents(balance.held)).toBe(50_000n)
  })

  it('POSTs something the receiver can verify — the whole point of the simulator', async () => {
    const { provider, posted } = harness()

    await provider.startPayIn({
      reference: 'MTH-4K7B2X',
      amount: fromCents(50_000n),
      description: 'Umngcwabo',
      beneficiary: 'BEN-1',
      returnUrl: '/done',
      cancelUrl: '/e/abc',
      notifyUrl: NOTIFY,
    })
    await provider.completePayIn('MTH-4K7B2X')

    const post = posted[0]
    if (post === undefined) expect.unreachable()

    const verification = await provider.verifyWebhook(deliveryOf(post))

    expect(verification.ok).toBe(true)
    if (!verification.ok) expect.unreachable()
    if (verification.event.kind !== 'pay-in-completed') expect.unreachable()

    expect(verification.event.reference).toBe('MTH-4K7B2X')
    expect(toCents(verification.event.amount)).toBe(50_000n)
    // The simulator takes nothing, and says so rather than reporting zero:
    // "no fee" and "this provider does not tell us" are different facts.
    expect(verification.event.fee).toBeNull()
  })

  it('rejects a notification whose body was changed after signing', async () => {
    const { provider, posted } = harness()

    await provider.startPayIn({
      reference: 'MTH-4K7B2X',
      amount: fromCents(50_000n),
      description: 'Umngcwabo',
      beneficiary: 'BEN-1',
      returnUrl: '/done',
      cancelUrl: '/e/abc',
      notifyUrl: NOTIFY,
    })
    await provider.completePayIn('MTH-4K7B2X')

    const post = posted[0]
    if (post === undefined) expect.unreachable()

    const tampered = deliveryOf({
      ...post,
      rawBody: post.rawBody.replace('"50000"', '"5000000"'),
    })

    await expect(provider.verifyWebhook(tampered)).resolves.toEqual({
      ok: false,
      reason: 'bad-signature',
    })
  })

  it('rejects an unsigned notification', async () => {
    const { provider } = harness()

    await expect(
      provider.verifyWebhook({ rawBody: '{}', headers: {}, sourceAddress: null }),
    ).resolves.toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('separates a body it cannot read from one it cannot verify', async () => {
    const { provider } = harness()
    const rawBody = 'not json'

    await expect(
      provider.verifyWebhook({
        rawBody,
        headers: { [SIMULATOR_SIGNATURE_HEADER]: simulatorSignature(rawBody) },
        sourceAddress: null,
      }),
    ).resolves.toEqual({ ok: false, reason: 'unreadable' })
  })

  it('credits nothing twice, however many times the payer is marked as paid', async () => {
    const { provider, posted } = harness()

    await provider.startPayIn({
      reference: 'MTH-4K7B2X',
      amount: fromCents(50_000n),
      description: 'Umngcwabo',
      beneficiary: 'BEN-1',
      returnUrl: '/done',
      cancelUrl: '/e/abc',
      notifyUrl: NOTIFY,
    })

    await provider.completePayIn('MTH-4K7B2X')
    await provider.completePayIn('MTH-4K7B2X')

    expect(posted).toHaveLength(1)
    const balance = await provider.balanceFor('BEN-1')
    expect(balance === null ? null : toCents(balance.held)).toBe(50_000n)
  })

  it('reports a cancellation and credits nothing', async () => {
    const { provider, posted } = harness()

    await provider.startPayIn({
      reference: 'MTH-4K7B2X',
      amount: fromCents(50_000n),
      description: 'Umngcwabo',
      beneficiary: 'BEN-1',
      returnUrl: '/done',
      cancelUrl: '/e/abc',
      notifyUrl: NOTIFY,
    })
    await provider.cancelPayIn('MTH-4K7B2X')

    const post = posted[0]
    if (post === undefined) expect.unreachable()

    await expect(provider.verifyWebhook(deliveryOf(post))).resolves.toEqual({
      ok: true,
      event: {
        kind: 'pay-in-cancelled',
        reference: 'MTH-4K7B2X',
        providerReference: 'SIMP-1',
      },
    })

    const balance = await provider.balanceFor('BEN-1')
    expect(balance === null ? null : toCents(balance.held)).toBe(0n)
  })
})

describe('a balance', () => {
  it('answers null for a beneficiary nobody has paid into', async () => {
    // Not a zero balance. A typo in a reference and an organiser nobody has
    // contributed to are different answers, and only one of them should reach a
    // screen as "R0,00".
    await expect(harness().provider.balanceFor('BEN-NOBODY')).resolves.toBeNull()
  })
})

describe('a withdrawal', () => {
  async function funded(amount = 50_000n) {
    const { provider, posted } = harness()

    await provider.startPayIn({
      reference: 'MTH-4K7B2X',
      amount: fromCents(amount),
      description: 'Umngcwabo',
      beneficiary: 'BEN-1',
      returnUrl: '/done',
      cancelUrl: '/e/abc',
      notifyUrl: NOTIFY,
    })
    await provider.completePayIn('MTH-4K7B2X')
    posted.length = 0

    return { provider, posted }
  }

  it('settles only on request, and not even then until it is completed', async () => {
    const { provider, posted } = await funded()

    const handle = await provider.requestWithdrawal({
      beneficiary: 'BEN-1',
      amount: fromCents(50_000n),
      nonce: 'nonce-1',
    })

    // Requested is not settled. A simulator that completed synchronously would
    // let a caller be written that never handles `pending`.
    expect(handle.state).toEqual({ kind: 'pending' })
    expect(posted).toHaveLength(0)
    await expect(provider.withdrawalState(handle.reference)).resolves.toEqual({
      kind: 'pending',
    })

    await provider.completeWithdrawal(handle.reference)

    expect(posted).toHaveLength(1)
    await expect(provider.withdrawalState(handle.reference)).resolves.toEqual({
      kind: 'completed',
    })
  })

  it('takes the amount out of held at the request, not at the settlement', async () => {
    // Otherwise two requests against one balance both pass their check and the
    // second is only caught when it settles — by which time both were promised.
    const { provider } = await funded()

    await provider.requestWithdrawal({
      beneficiary: 'BEN-1',
      amount: fromCents(30_000n),
      nonce: 'nonce-1',
    })

    const balance = await provider.balanceFor('BEN-1')
    expect(balance === null ? null : toCents(balance.held)).toBe(20_000n)

    await expect(
      provider.requestWithdrawal({
        beneficiary: 'BEN-1',
        amount: fromCents(30_000n),
        nonce: 'nonce-2',
      }),
    ).rejects.toThrow(PaymentProviderError)
  })

  it('moves the amount into paidOut when it settles', async () => {
    const { provider } = await funded()

    const handle = await provider.requestWithdrawal({
      beneficiary: 'BEN-1',
      amount: fromCents(50_000n),
      nonce: 'nonce-1',
    })
    await provider.completeWithdrawal(handle.reference)

    const balance = await provider.balanceFor('BEN-1')
    expect(balance === null ? null : toCents(balance.held)).toBe(0n)
    expect(balance === null ? null : toCents(balance.paidOut)).toBe(50_000n)
  })

  it('POSTs a settlement the receiver can verify', async () => {
    const { provider, posted } = await funded()

    const handle = await provider.requestWithdrawal({
      beneficiary: 'BEN-1',
      amount: fromCents(50_000n),
      nonce: 'nonce-1',
    })
    await provider.completeWithdrawal(handle.reference)

    const post = posted[0]
    if (post === undefined) expect.unreachable()

    const verification = await provider.verifyWebhook(deliveryOf(post))
    if (!verification.ok) expect.unreachable()
    if (verification.event.kind !== 'withdrawal-completed') expect.unreachable()

    expect(verification.event.beneficiary).toBe('BEN-1')
    expect(toCents(verification.event.amount)).toBe(50_000n)
  })

  it('is idempotent on the nonce, which is what makes a retry safe', async () => {
    // Architecture §5.5. The same nonce returns the same withdrawal — it is not
    // an error, and treating it as one is how a timeout becomes a second payout.
    const { provider } = await funded()

    const first = await provider.requestWithdrawal({
      beneficiary: 'BEN-1',
      amount: fromCents(20_000n),
      nonce: 'the-same-one',
    })
    const second = await provider.requestWithdrawal({
      beneficiary: 'BEN-1',
      amount: fromCents(20_000n),
      nonce: 'the-same-one',
    })

    expect(second.reference).toBe(first.reference)

    const balance = await provider.balanceFor('BEN-1')
    expect(balance === null ? null : toCents(balance.held)).toBe(30_000n)
    expect(simulatorState().withdrawals).toHaveLength(1)
  })

  it('refuses a beneficiary it has never held anything for', async () => {
    await expect(
      harness().provider.requestWithdrawal({
        beneficiary: 'BEN-NOBODY',
        amount: fromCents(100n),
        nonce: 'nonce-1',
      }),
    ).rejects.toThrow(PaymentProviderError)
  })

  it('settles nothing twice', async () => {
    const { provider, posted } = await funded()

    const handle = await provider.requestWithdrawal({
      beneficiary: 'BEN-1',
      amount: fromCents(50_000n),
      nonce: 'nonce-1',
    })

    await provider.completeWithdrawal(handle.reference)
    await provider.completeWithdrawal(handle.reference)

    expect(posted).toHaveLength(1)
    const balance = await provider.balanceFor('BEN-1')
    expect(balance === null ? null : toCents(balance.paidOut)).toBe(50_000n)
  })

  it('reports an unknown withdrawal as failed rather than pretending it is pending', async () => {
    await expect(harness().provider.withdrawalState('SIMW-nothing')).resolves.toEqual({
      kind: 'failed',
      reason: 'provider-rejected',
    })
  })
})

describe('the POST itself', () => {
  it('fails loudly when the receiver refuses, rather than dropping it silently', async () => {
    // A real provider retries. This one reports, in the only place a developer
    // is looking — a silent drop would look exactly like a handler that never
    // ran.
    const provider = new SimulatedPaymentProvider({
      fetch: vi.fn(() =>
        Promise.resolve(new Response(null, { status: 500 })),
      ) as unknown as typeof globalThis.fetch,
      newId: () => 'x',
    })

    await provider.startPayIn({
      reference: 'MTH-4K7B2X',
      amount: fromCents(100n),
      description: 'Umngcwabo',
      beneficiary: 'BEN-1',
      returnUrl: '/done',
      cancelUrl: '/e/abc',
      notifyUrl: NOTIFY,
    })

    await expect(provider.completePayIn('MTH-4K7B2X')).rejects.toThrow(
      PaymentProviderError,
    )
  })
})
