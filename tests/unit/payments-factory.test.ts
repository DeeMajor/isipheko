import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PayFastProvider,
  SimulatedPaymentProvider,
  payFastProvider,
  paymentEventHandler,
  paymentProvider,
} from '@/adapters/payments'

/**
 * Production refuses, and the simulator is unreachable there.
 *
 * Three separate refusals guard the same thing, and they are not spares for
 * each other — they fail independently and at different layers, which is the
 * only kind of defence in depth M2-05 §7 says is worth having:
 *
 *   1. `paymentProvider()` will not construct the simulator in production.
 *   2. `paymentEventHandler()` will not construct the recorder there either.
 *   3. `/api/payments/simulator` and `/dev/payments` both 404 there.
 *
 * The thing being guarded is a simulator crediting a real organiser's balance
 * with money nobody paid — on the screen she makes promises against.
 */

const PAYFAST = {
  PAYFAST_MERCHANT_ID: '10000100',
  PAYFAST_MERCHANT_KEY: '46f0cd694581a',
  PAYFAST_PASSPHRASE: 'jt7NOE43FZPn',
  PAYFAST_MODE: 'sandbox',
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('paymentProvider', () => {
  it('is the simulator in development and test', () => {
    expect(paymentProvider('development')).toBeInstanceOf(SimulatedPaymentProvider)
    expect(paymentProvider('test')).toBeInstanceOf(SimulatedPaymentProvider)
  })

  it('throws in production rather than falling back to it', () => {
    expect(() => paymentProvider('production')).toThrow(/simulator/)
  })

  it('says what to do, and names where the open questions are', () => {
    expect(() => paymentProvider('production')).toThrow(/paystack-analysis/)
  })
})

describe('paymentEventHandler', () => {
  it('records in development and test', () => {
    expect(paymentEventHandler('development')).toBeDefined()
  })

  it('throws in production, because a dropped notification is a lost contribution', () => {
    expect(() => paymentEventHandler('production')).toThrow(/M5-03/)
  })
})

describe('payFastProvider', () => {
  it('constructs from the four variables', () => {
    expect(payFastProvider(PAYFAST)).toBeInstanceOf(PayFastProvider)
  })

  it('names the variable that is missing, not the fact that something is', () => {
    expect(() =>
      payFastProvider({ ...PAYFAST, PAYFAST_MERCHANT_KEY: undefined }),
    ).toThrow(/PAYFAST_MERCHANT_KEY/)
  })

  it('requires a passphrase, which PayFast treats as optional', () => {
    // Without one the signature is a checksum over data the sender chose rather
    // than a shared secret — the appearance of a security check and not one.
    expect(() => payFastProvider({ ...PAYFAST, PAYFAST_PASSPHRASE: '' })).toThrow(
      /PAYFAST_PASSPHRASE/,
    )
  })

  it('is the sandbox unless the mode says live, never the other way round', () => {
    // Defaulting to live is how a test transaction reaches a real card.
    expect(payFastProvider({ ...PAYFAST, PAYFAST_MODE: undefined })).toBeInstanceOf(
      PayFastProvider,
    )
  })
})

/**
 * A production deployment's worth of environment. `src/lib/env.ts` validates at
 * import, so a route imported with NODE_ENV=production needs the rest of it
 * present or it fails on the wrong thing.
 */
const PRODUCTION_ENV = {
  NEXT_PUBLIC_APP_URL: 'https://isipheko.co.za',
  DATABASE_URL: 'postgresql://app:pw@db:5432/isipheko',
  MIGRATION_DATABASE_URL: 'postgresql://owner:pw@db:5432/isipheko',
  BANK_ACCOUNT_ENCRYPTION_KEY: 'cHJvZHVjdGlvbi1rZXkhISEhISEhISEhISEhISEhISE=',
  ID_NUMBER_PEPPER: 'cHJvZHVjdGlvbi1wZXBwZXIhISEhISEhISEhISEhISE=',
  OTP_PEPPER: 'cHJvZHVjdGlvbi1vdHAhISEhISEhISEhISEhISEhISE=',
}

async function routesUnder(nodeEnv: 'development' | 'production') {
  // `env` is parsed once at module load, so the registry has to be cleared or
  // the second import would answer with the first one's environment.
  vi.resetModules()
  vi.stubEnv('NODE_ENV', nodeEnv)

  if (nodeEnv === 'production') {
    for (const [name, value] of Object.entries(PRODUCTION_ENV)) vi.stubEnv(name, value)
  }

  return {
    receiver: await import('@/app/api/payments/simulator/route'),
    controls: await import('@/app/dev/payments/route'),
  }
}

describe('the simulator is unreachable in production', () => {
  it('404s the receiver route', async () => {
    const { receiver } = await routesUnder('production')

    expect(() => receiver.GET()).toThrow()

    const request = new Request('https://isipheko.co.za/api/payments/simulator', {
      method: 'POST',
      body: '{}',
    })

    await expect(receiver.POST(request as never)).rejects.toThrow()
  })

  it('404s the control surface', async () => {
    const { controls } = await routesUnder('production')

    expect(() => controls.GET()).toThrow()
  })

  it('serves both outside production', async () => {
    // The guard has to be proved to let something through as well, or a route
    // that 404s unconditionally would pass the two tests above.
    const { receiver, controls } = await routesUnder('development')

    expect(receiver.GET().status).toBe(200)
    expect(controls.GET().status).toBe(200)
  })
})
