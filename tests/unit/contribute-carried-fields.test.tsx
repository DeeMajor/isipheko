import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ARCHETYPES } from '@/domain/archetype'
import type { ContributionRoute, ContributionStep } from '@/domain/contribution'
import { ContributePage } from '@/ui/contribute-page'

/**
 * The hidden/visible field collision, on the two steps that had it (UX-02).
 *
 * A field rendered hidden *and* visible on one form is sent twice, and
 * `FormData.get` returns the first — so the stale hidden copy outranks every
 * edit. M4-01 §10 found and fixed this on the who step; the amount and item
 * steps had the same shape. On the amount step it was worse than a dropped
 * edit: the first invalid amount travelled forward as a hidden field that
 * outranked every corrected one, so the step became an error loop that no
 * typing could leave.
 */

function step({
  route,
  step,
  carried,
}: {
  route: ContributionRoute
  step: ContributionStep
  carried: Record<string, string>
}): string {
  return renderToStaticMarkup(
    <ContributePage
      slug="AbCdEf0123456789"
      eventTitle="Nokuthula Mthembu"
      organiserName="Nomsa Mthembu"
      archetype={ARCHETYPES.umngcwabo}
      route={route}
      step={step}
      amountsPublic={false}
      carried={carried}
      needs={[{ id: 'need-tent', label: 'Tent', remaining: 1 }]}
      payDetails={{ phone: '082 123 4567', name: 'Nomsa Mthembu' }}
      mode="ledger_only"
      defaultVisibility="name_only"
    />,
  )
}

describe('the amount step', () => {
  it('repopulates the typed amount rather than carrying a stale hidden copy', () => {
    const markup = step({
      route: 'money',
      step: 'amount',
      carried: { amount: 'not-money', name: 'Thandi Ngcobo' },
    })

    // The mechanism: no hidden `amount` to outrank the input, and the input
    // shows what was typed so nothing is lost either.
    expect(markup).not.toContain('<input type="hidden" name="amount"')
    expect(markup).toContain('value="not-money"')

    // The rest of the flow's state still travels.
    expect(markup).toContain('<input type="hidden" name="name" value="Thandi Ngcobo"/>')
  })
})

describe('the item step', () => {
  it('lets a different item be chosen rather than resending the carried one', () => {
    const markup = step({
      route: 'earmark',
      step: 'item',
      carried: { item: 'stale-item-id' },
    })

    // Each button carries its own item; a carried copy rendered before it
    // would win, so it must not render at all.
    expect(markup).not.toContain('value="stale-item-id"')
    expect(markup).toContain('<input type="hidden" name="item" value="need-tent"/>')
  })
})
