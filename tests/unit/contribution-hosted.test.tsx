import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { contributeCopy } from '@/copy/contribute'
import { ARCHETYPES } from '@/domain/archetype'
import type { PaymentMode } from '@/domain/contribution'
import { fromCents } from '@/domain/money'
import { ContributePage } from '@/ui/contribute-page'

/**
 * The hosted pay step and done step (M5-02).
 *
 * What is asserted here is mostly **what is absent**: no PayShap number, no
 * reference to copy, and none of the Mode A sentences that stop being true the
 * moment a payment confirms itself. The copy discipline in this codebase is
 * that a string is removed the moment it is untrue, and a screen keyed by mode
 * is the one place that can quietly go wrong.
 */

function payStep({
  mode,
  beneficiary,
  payDetails = { phone: '082 123 4567', name: 'N. Mthembu' },
}: {
  mode: PaymentMode
  beneficiary: string | null
  payDetails?: { phone: string; name: string } | null
}): string {
  return renderToStaticMarkup(
    <ContributePage
      slug="AbCdEf0123456789"
      eventTitle="Nokuthula Mthembu"
      organiserName="Nomsa Mthembu"
      archetype={ARCHETYPES.umngcwabo}
      route="money"
      step="pay"
      amountsPublic={false}
      carried={{ contribution: 'c-1' }}
      needs={[]}
      amount={fromCents(123_456n)}
      reference="MTH-4K7B2X"
      payDetails={payDetails}
      mode={mode}
      beneficiary={beneficiary}
      defaultVisibility="name_only"
    />,
  )
}

function doneStep({
  mode,
  paymentConfirmed,
}: {
  mode: PaymentMode
  paymentConfirmed?: boolean
}): string {
  return renderToStaticMarkup(
    <ContributePage
      slug="AbCdEf0123456789"
      eventTitle="Nokuthula Mthembu"
      organiserName="Nomsa Mthembu"
      archetype={ARCHETYPES.umngcwabo}
      route="money"
      step="done"
      amountsPublic={false}
      carried={{}}
      needs={[]}
      mode={mode}
      paymentConfirmed={paymentConfirmed}
      defaultVisibility="name_only"
    />,
  )
}

describe('the hosted pay step', () => {
  const hosted = payStep({ mode: 'hosted', beneficiary: 'BEN-1' })

  it('offers one button, and it keeps the name the action had', () => {
    // "Send my contribution" is the Voice table's own example. The same words
    // come back on the done screen: an action keeps its name through the flow.
    expect(hosted).toContain(contributeCopy.pay.hostedSubmit)
    expect(hosted).toContain('Send my contribution')
  })

  it('shows what is about to be sent', () => {
    expect(hosted).toContain('R1 234,56')
  })

  it('shows no payment number and no reference to copy', () => {
    // Both belong to Mode A, where the contributor types them into a banking
    // app. Here nobody types anything, and a code on screen with no use invites
    // somebody to think they have to do something with it.
    expect(hosted).not.toContain('082 123 4567')
    expect(hosted).not.toContain('MTH-4K7B2X')
    expect(hosted).not.toContain(contributeCopy.pay.copyNumber)
    expect(hosted).not.toContain(contributeCopy.pay.copyReference)
  })

  it('does not claim nothing is being taken here', () => {
    // `pay.foot` — "Nothing is taken from you here. You send it yourself, from
    // your own app." True in Mode A, flatly false on a page that is about to
    // take a card.
    expect(hosted).not.toContain('Nothing is taken from you here')
    expect(hosted).toContain(contributeCopy.pay.hostedFoot)
  })

  it('names no provider', () => {
    // CLAUDE.md rule 10. Which company moves the money is ours to change and
    // none of a contributor's business.
    expect(hosted).not.toMatch(/payfast|paystack|stitch|ozow|snapscan/i)
  })

  it('is a form post, so it works with JavaScript off', () => {
    expect(hosted).toContain('method="post"')
    expect(hosted).toContain('type="submit"')
  })

  it('carries the contribution forward, so the server knows what is being paid', () => {
    expect(hosted).toContain('value="c-1"')
  })
})

describe('when there is nowhere for the money to go', () => {
  it('says so, per mode, rather than showing a broken screen', () => {
    const noBeneficiary = payStep({ mode: 'hosted', beneficiary: null })
    const noNumber = payStep({
      mode: 'ledger_only',
      beneficiary: null,
      payDetails: null,
    })

    expect(noBeneficiary).toContain(contributeCopy.pay.noBeneficiaryBody)
    expect(noNumber).toContain(contributeCopy.pay.noNumberBody)

    // Two different facts with two different remedies, and neither screen
    // offers a button that would take money nowhere.
    expect(noBeneficiary).not.toContain(contributeCopy.pay.hostedSubmit)
    expect(noNumber).not.toContain(contributeCopy.pay.submit)
  })

  it('does not accept the organiser’s number as somewhere to settle', () => {
    // A hosted event with a PayShap number and no beneficiary cannot take
    // money, however complete it looks.
    expect(payStep({ mode: 'hosted', beneficiary: null })).toContain(
      contributeCopy.pay.noBeneficiaryTitle,
    )
  })
})

describe('the hosted done step', () => {
  it('does not promise a confirmation nobody is going to make', () => {
    const done = doneStep({ mode: 'hosted', paymentConfirmed: true })

    // Mode A's two sentences describe the organiser checking her own bank
    // message. On a hosted contribution that step does not happen.
    expect(done).not.toContain(contributeCopy.done.pending)
    expect(done).not.toContain('It joins the record when they confirm it')
  })

  it('says it is on the record only once it is', () => {
    const confirmed = doneStep({ mode: 'hosted', paymentConfirmed: true })
    const clearing = doneStep({ mode: 'hosted', paymentConfirmed: false })

    expect(confirmed).toContain(contributeCopy.done.hostedConfirmed)
    expect(clearing).toContain(contributeCopy.done.hostedClearing)

    // The one that matters: before the notification lands, the screen must not
    // say the record already holds them (M4-02 §4).
    expect(clearing).not.toContain(contributeCopy.done.hostedConfirmed)
  })

  it('leaves the ledger-only wording exactly as it was', () => {
    const modeA = doneStep({ mode: 'ledger_only' })

    expect(modeA).toContain(contributeCopy.done.body)
    expect(modeA).toContain(contributeCopy.done.pending)
    expect(modeA).toContain(contributeCopy.done.foot)
  })

  it('drops the clause about somebody confirming, and keeps the sentence before it', () => {
    // `hostedBody` is the opening of `body` without its tail — the same words
    // where they are still true, and none where they are not. Asserted on the
    // tail rather than as a not-contains, because a prefix would satisfy that
    // by accident.
    const hosted = doneStep({ mode: 'hosted', paymentConfirmed: true })

    expect(contributeCopy.done.body.startsWith(contributeCopy.done.hostedBody)).toBe(true)
    expect(hosted).toContain(contributeCopy.done.hostedBody)
    expect(hosted).not.toContain('when they confirm it')
    expect(hosted).not.toContain('their own bank notification')
  })
})
