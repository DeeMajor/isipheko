import { describe, expect, it } from 'vitest'

import {
  canReachPayStep,
  defaultVisibility,
  isRoute,
  isStep,
  isVisibility,
  nextStep,
  previousStep,
  requiresPayment,
  stepNumber,
  stepsFor,
} from '@/domain/contribution'

/**
 * Three routes, not one path of five — exactly as design/contribute.html
 * branches at the first step.
 */

describe('the three routes', () => {
  it('takes money through five steps', () => {
    expect(stepsFor('money')).toEqual(['choose', 'amount', 'who', 'pay', 'done'])
  })

  it('takes an item through four, with no pay step', () => {
    // Nothing is being paid, so there is nothing to pay. A pay step here would
    // be a screen asking somebody to send money for a chair they are bringing.
    expect(stepsFor('item')).toEqual(['choose', 'item', 'who', 'done'])
    expect(requiresPayment('item')).toBe(false)
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
    expect(requiresPayment('earmark')).toBe(true)
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

  it('does not offer an amount step on the item route', () => {
    expect(stepsFor('item')).not.toContain('amount')
    expect(nextStep('item', 'item')).toBe('who')
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
  it.each(['money', 'item', 'earmark'])('accepts the route %s', (value) => {
    expect(isRoute(value)).toBe(true)
  })

  it.each(['', 'cash', 'MONEY', 'donate'])('refuses %o as a route', (value) => {
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
