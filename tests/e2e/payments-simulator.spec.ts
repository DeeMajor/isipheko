import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * The held-balance model, walked end to end over real HTTP.
 *
 * **This is the assertion the task is done by.** The unit tests capture the
 * simulator's POST and hand it back to `verifyWebhook` in-process, which proves
 * the loop closes. This one lets the POST actually leave: the simulator calls
 * `fetch`, Next serves `/api/payments/simulator`, the route reads the raw body,
 * verifies the signature and reaches the handler seam. Nothing is stepped
 * around.
 *
 * A simulator that called a repository directly would leave every one of those
 * untested — and the receiver, the verification and the seam are the three
 * things a payments integration actually gets wrong.
 *
 * Nothing here touches a contribution or the ledger. Crediting anything is
 * M5-03; what exists today is the seam and two implementations of it.
 */

interface SimulatorState {
  payIns: { reference: string; amountCents: string; settled: boolean }[]
  balances: { beneficiary: string; heldCents: string; paidOutCents: string }[]
  withdrawals: { reference: string; amountCents: string; state: string }[]
  events: {
    kind: string
    reference?: string
    beneficiary?: string
    amountCents?: string
  }[]
}

async function state(request: APIRequestContext): Promise<SimulatorState> {
  const response = await request.get('/api/payments/simulator')
  expect(response.status()).toBe(200)
  return (await response.json()) as SimulatorState
}

async function control(
  request: APIRequestContext,
  form: Record<string, string>,
): Promise<void> {
  const response = await request.post('/dev/payments', { form })
  expect(response.status()).toBe(200)
}

/**
 * The store is one process-wide map and the suite runs in parallel, so every
 * test works against references only it uses.
 */
function unique(prefix: string): string {
  return `${prefix}-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`
}

test('money in, held for the organiser, released only when asked', async ({
  request,
}) => {
  const reference = unique('E2E')
  const beneficiary = unique('BEN')

  // ---------------------------------------------------------------------
  // A pay-in is started. Nothing is held: the payer has decided nothing.
  // ---------------------------------------------------------------------
  await control(request, {
    op: 'start-pay-in',
    reference,
    amountCents: '50000',
    beneficiary,
  })

  const started = await state(request)
  expect(started.payIns).toContainEqual({
    reference,
    amountCents: '50000',
    settled: false,
  })
  expect(started.balances).toContainEqual({
    beneficiary,
    heldCents: '0',
    paidOutCents: '0',
  })

  // ---------------------------------------------------------------------
  // The payer pays. The simulator POSTs, over HTTP, to the real receiver.
  // ---------------------------------------------------------------------
  await control(request, { op: 'complete-pay-in', reference })

  const paid = await state(request)
  expect(paid.balances).toContainEqual({
    beneficiary,
    heldCents: '50000',
    paidOutCents: '0',
  })

  // The event reached the handler seam — which means the route verified the
  // signature on a body it received rather than one it was handed.
  expect(paid.events).toContainEqual(
    expect.objectContaining({
      kind: 'pay-in-completed',
      reference,
      amountCents: '50000',
    }),
  )

  // ---------------------------------------------------------------------
  // A withdrawal is requested. Held drops at the request, and the money is
  // not settled — a real settlement is not synchronous and this one is not
  // either, so a caller cannot be written that never handles `pending`.
  // ---------------------------------------------------------------------
  await control(request, { op: 'withdraw', beneficiary, amountCents: '50000', reference })

  const requested = await state(request)
  expect(requested.balances).toContainEqual({
    beneficiary,
    heldCents: '0',
    paidOutCents: '0',
  })

  const withdrawal = requested.withdrawals.find(
    (row) => row.amountCents === '50000' && row.state === 'pending',
  )
  expect(withdrawal).toBeDefined()
  if (withdrawal === undefined) return

  // No second notification yet.
  expect(
    requested.events.filter(
      (event) =>
        event.kind === 'withdrawal-completed' && event.beneficiary === beneficiary,
    ),
  ).toHaveLength(0)

  // ---------------------------------------------------------------------
  // It settles. Second notification, same route, same verification.
  // ---------------------------------------------------------------------
  await control(request, { op: 'complete-withdrawal', reference: withdrawal.reference })

  const settled = await state(request)
  expect(settled.balances).toContainEqual({
    beneficiary,
    heldCents: '0',
    paidOutCents: '50000',
  })
  expect(settled.withdrawals).toContainEqual(
    expect.objectContaining({ reference: withdrawal.reference, state: 'completed' }),
  )
  expect(settled.events).toContainEqual(
    expect.objectContaining({
      kind: 'withdrawal-completed',
      beneficiary,
      amountCents: '50000',
    }),
  )
})

test('the receiver refuses an unsigned notification', async ({ request }) => {
  // The signature check is not a formality the simulator satisfies by accident.
  // Anybody can reach this route; only something holding the secret can be
  // believed by it.
  const response = await request.post('/api/payments/simulator', {
    data: { type: 'pay-in.completed', reference: 'FORGED', providerReference: 'x' },
  })

  expect(response.status()).toBe(400)
  expect(await response.json()).toEqual({ rejected: 'bad-signature' })
})

test('the receiver refuses a notification whose body was changed after signing', async ({
  request,
}) => {
  const reference = unique('E2E-TAMPER')
  const beneficiary = unique('BEN-TAMPER')

  await control(request, {
    op: 'start-pay-in',
    reference,
    amountCents: '10000',
    beneficiary,
  })
  await control(request, { op: 'complete-pay-in', reference })

  // Replay the same shape with the amount raised. Without the secret there is
  // no signature to go with it, so the route answers the same way it would to
  // any other forgery.
  const response = await request.post('/api/payments/simulator', {
    headers: { 'x-isipheko-simulator-signature': 'not-a-signature' },
    data: {
      type: 'pay-in.completed',
      reference,
      providerReference: 'SIMP-forged',
      amountCents: '9999999',
    },
  })

  expect(response.status()).toBe(400)

  const after = await state(request)
  expect(after.balances).toContainEqual({
    beneficiary,
    heldCents: '10000',
    paidOutCents: '0',
  })
})

test('the control surface renders the whole model on one page', async ({ page }) => {
  // Not a design surface — it is `/dev`, like `/dev/tokens`. What matters is
  // that a person can walk the model by hand, which is what it is for.
  await page.goto('/dev/payments')

  await expect(page.getByRole('heading', { name: 'Payment simulator' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Held balances' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Withdrawals' })).toBeVisible()
})
