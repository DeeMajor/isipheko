/**
 * The contribution flow, as rules.
 *
 * Two routes through this flow, and a third way to help that deliberately is
 * not one:
 *
 *   money            choose → amount → who → pay → done
 *   money toward one choose → item   → amount → who → pay → done
 *   bring something  → the needs board on the event page (M2-04)
 *
 * **"Bring something" is not a route here.** It once was — `choose → item →
 * who → done` — and that path called nothing: no claim, no row, no ledger
 * entry, while its done screen said the family would confirm it. M2-05 §2's
 * decision was that bringing something reserves through the claim path M2-04
 * built, because two code paths reserving the same chair is how the last chair
 * gets taken twice (M2-03). So the choose step links to the board, which is
 * the one place a reservation happens — and the board's claim form already
 * takes the message and the photograph (M4-02b).
 *
 * Pure: no I/O, no framework, no Prisma types.
 */

export type ContributionRoute = 'money' | 'earmark'

export type ContributionStep = 'choose' | 'amount' | 'item' | 'who' | 'pay' | 'done'

export type Visibility = 'public' | 'name_only' | 'anonymous'

const STEPS: Record<ContributionRoute, readonly ContributionStep[]> = {
  money: ['choose', 'amount', 'who', 'pay', 'done'],
  earmark: ['choose', 'item', 'amount', 'who', 'pay', 'done'],
}

export function stepsFor(route: ContributionRoute): readonly ContributionStep[] {
  return STEPS[route]
}

export function stepNumber(route: ContributionRoute, step: ContributionStep): number {
  return STEPS[route].indexOf(step) + 1
}

export function nextStep(
  route: ContributionRoute,
  step: ContributionStep,
): ContributionStep | null {
  const steps = STEPS[route]
  const index = steps.indexOf(step)

  return index === -1 || index === steps.length - 1 ? null : (steps[index + 1] ?? null)
}

export function previousStep(
  route: ContributionRoute,
  step: ContributionStep,
): ContributionStep | null {
  const steps = STEPS[route]
  const index = steps.indexOf(step)

  return index <= 0 ? null : (steps[index - 1] ?? null)
}

export function isRoute(value: string): value is ContributionRoute {
  // 'item' is deliberately not a route (see the module comment). A stale URL
  // or an in-flight form carrying it lands on the default rather than on a
  // path that records nothing.
  return value === 'money' || value === 'earmark'
}

export function isStep(value: string): value is ContributionStep {
  return ['choose', 'amount', 'item', 'who', 'pay', 'done'].includes(value)
}

/**
 * What the visibility control starts on.
 *
 * The event carries its own default, set from the archetype at creation
 * (M1-07): public on a wedding, names-without-amounts on a funeral. This is
 * only ever a starting point — the contributor chooses, and the family sees the
 * full record either way.
 */
export function defaultVisibility(eventDefault: Visibility): Visibility {
  return eventDefault
}

export function isVisibility(value: string): value is Visibility {
  return value === 'public' || value === 'name_only' || value === 'anonymous'
}

/**
 * How an event takes money. `events.mode`, and today it finally decides
 * something (M5-02).
 *
 * `ledger_only` is Mode A: the contributor pays the organiser directly from
 * their own banking app and comes back to say so. `hosted` is a checkout on
 * the page, settled to the organiser through a provider.
 */
export type PaymentMode = 'ledger_only' | 'hosted'

export function isPaymentMode(value: string): value is PaymentMode {
  return value === 'ledger_only' || value === 'hosted'
}

/**
 * Whether the pay step has anything to show, and the answer differs by mode.
 *
 * **Ledger-only** needs the organiser's number. Without it there is nothing to
 * show, and a blank where a payment number belongs is how somebody pays the
 * wrong account.
 *
 * **Hosted** needs a beneficiary — somewhere for the provider to settle to.
 * Without one the checkout would take money with nowhere to send it, which is
 * the same failure wearing a worse hat: in Mode A a contributor pays nobody, in
 * hosted mode they pay us.
 *
 * Neither answer is "show a broken screen". The refusal has copy of its own,
 * per mode, because *"the family has not added their number"* and *"this page
 * cannot take card payments yet"* are different facts with different remedies.
 */
export function canReachPayStep(
  mode: PaymentMode,
  destination: {
    payDetails: { phone: string; name: string } | null
    beneficiary: string | null
  },
): boolean {
  if (mode === 'hosted') {
    return destination.beneficiary !== null && destination.beneficiary !== ''
  }

  const details = destination.payDetails
  return details !== null && details.phone !== '' && details.name !== ''
}
