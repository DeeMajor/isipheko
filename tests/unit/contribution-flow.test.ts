import { describe, expect, it } from 'vitest'

import {
  canReachPayStep,
  defaultVisibility,
  isRoute,
  isStep,
  isVisibility,
  nextStep,
  previousStep,
  stepNumber,
  stepsFor,
} from '@/domain/contribution'

/**
 * Two routes through the flow, and "bring something" deliberately not among
 * them: it reserves through the needs board's claim path (M2-04), which is the
 * only reservation path there is (M2-03). The in-flow item route it replaces
 * recorded nothing at all while its done screen said otherwise.
 */

describe('the two routes', () => {
  it('takes money through five steps', () => {
    expect(stepsFor('money')).toEqual(['choose', 'amount', 'who', 'pay', 'done'])
  })

  it('takes an earmarked amount through six', () => {
    expect(stepsFor('earmark')).toEqual([
      'choose',
      'item',
      'amount',
      'who',
      'pay',
      'done',
    ])
  })

  it('numbers from one, for "Step N of M"', () => {
    expect(stepNumber('money', 'choose')).toBe(1)
    expect(stepNumber('money', 'done')).toBe(5)
    expect(stepNumber('earmark', 'done')).toBe(6)
  })

  it('walks forwards and stops at the end', () => {
    expect(nextStep('money', 'choose')).toBe('amount')
    expect(nextStep('money', 'pay')).toBe('done')
    expect(nextStep('money', 'done')).toBeNull()
  })

  it('walks backwards and stops at the start', () => {
    expect(previousStep('money', 'amount')).toBe('choose')
    expect(previousStep('money', 'choose')).toBeNull()
  })
})

describe('the pay step', () => {
  const NUMBER = { phone: '0821234567', name: 'N. Dlamini' }

  it('cannot be reached without the organiser’s number, on a ledger-only event', () => {
    // Mode A has no payment rail: this number is the payment path. A blank
    // where it belongs is how somebody pays the wrong account.
    expect(canReachPayStep('ledger_only', { payDetails: null, beneficiary: null })).toBe(
      false,
    )
    expect(
      canReachPayStep('ledger_only', {
        payDetails: { phone: '', name: 'N. Dlamini' },
        beneficiary: null,
      }),
    ).toBe(false)
    expect(
      canReachPayStep('ledger_only', {
        payDetails: { phone: '0821234567', name: '' },
        beneficiary: null,
      }),
    ).toBe(false)
  })

  it('is reachable once both are there', () => {
    expect(
      canReachPayStep('ledger_only', { payDetails: NUMBER, beneficiary: null }),
    ).toBe(true)
  })

  it('cannot be reached without a beneficiary, on a hosted event', () => {
    // A checkout with nowhere to settle takes money and keeps it. That is the
    // ledger-only failure wearing a worse hat: there a contributor pays nobody,
    // here they pay us.
    expect(canReachPayStep('hosted', { payDetails: NUMBER, beneficiary: null })).toBe(
      false,
    )
    expect(canReachPayStep('hosted', { payDetails: NUMBER, beneficiary: '' })).toBe(false)
  })

  it('does not accept the organiser’s number in place of a beneficiary', () => {
    // The two are not interchangeable and the mode decides which is being
    // asked for. A hosted event with a PayShap number and no beneficiary is an
    // event that cannot take money, however complete it looks.
    expect(canReachPayStep('hosted', { payDetails: NUMBER, beneficiary: null })).toBe(
      false,
    )
    expect(
      canReachPayStep('ledger_only', { payDetails: null, beneficiary: 'BEN-1' }),
    ).toBe(false)
  })

  it('is reachable on a hosted event once there is somewhere to settle', () => {
    expect(canReachPayStep('hosted', { payDetails: null, beneficiary: 'BEN-1' })).toBe(
      true,
    )
  })
})

describe('visibility', () => {
  it('starts where the archetype put it', () => {
    // The event carries its own default from creation (M1-07): public on a
    // wedding, names-without-amounts on a funeral.
    expect(defaultVisibility('public')).toBe('public')
    expect(defaultVisibility('name_only')).toBe('name_only')
  })

  it('accepts only the three the schema has', () => {
    expect(isVisibility('public')).toBe(true)
    expect(isVisibility('name_only')).toBe(true)
    expect(isVisibility('anonymous')).toBe(true)
    expect(isVisibility('hidden')).toBe(false)
  })
})

describe('what arrives from a form', () => {
  it.each(['money', 'earmark'])('accepts the route %s', (value) => {
    expect(isRoute(value)).toBe(true)
  })

  /**
   * 'item' is a step, never a route. The route it once named recorded nothing —
   * no claim, no row — so a stale URL or an in-flight form carrying it must
   * land on the default rather than resolve to a path that swallows the act.
   */
  it.each(['', 'cash', 'MONEY', 'donate', 'item'])('refuses %o as a route', (value) => {
    expect(isRoute(value)).toBe(false)
  })

  it.each(['choose', 'amount', 'item', 'who', 'pay', 'done'])(
    'accepts the step %s',
    (value) => {
      expect(isStep(value)).toBe(true)
    },
  )

  it.each(['', 'confirm', 'checkout'])('refuses %o as a step', (value) => {
    expect(isStep(value)).toBe(false)
  })
})
