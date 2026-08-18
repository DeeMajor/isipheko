/**
 * The contribution flow, as rules.
 *
 * Three routes rather than one path, exactly as `design/contribute.html`
 * branches at the first step:
 *
 *   money            choose → amount → who → pay → done
 *   bring something  choose → item   → who →       done
 *   money toward one choose → item   → amount → who → pay → done
 *
 * **"Bring something" has no pay step** because nothing is being paid, and it
 * reserves through the claim path M2-04 already built rather than growing a
 * second one. Two code paths reserving the same chair is how the last chair
 * gets taken twice.
 *
 * Pure: no I/O, no framework, no Prisma types.
 */

export type ContributionRoute = 'money' | 'item' | 'earmark'

export type ContributionStep = 'choose' | 'amount' | 'item' | 'who' | 'pay' | 'done'

export type Visibility = 'public' | 'name_only' | 'anonymous'

const STEPS: Record<ContributionRoute, readonly ContributionStep[]> = {
  money: ['choose', 'amount', 'who', 'pay', 'done'],
  item: ['choose', 'item', 'who', 'done'],
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

/** Whether this route ever reaches a payment. */
export function requiresPayment(route: ContributionRoute): boolean {
  return route !== 'item'
}

export function isRoute(value: string): value is ContributionRoute {
  return value === 'money' || value === 'item' || value === 'earmark'
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
 * Whether the pay step can be shown at all.
 *
 * Mode A means the contributor pays the organiser directly, so without the
 * organiser's number there is nothing to show — and a blank where a payment
 * number should be is how somebody pays the wrong account.
 */
export function canReachPayStep(
  payDetails: { phone: string; name: string } | null,
): boolean {
  return payDetails !== null && payDetails.phone !== '' && payDetails.name !== ''
}
