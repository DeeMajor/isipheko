import { notFound } from 'next/navigation'
import type { NextRequest } from 'next/server'

import {
  SimulatedPaymentProvider,
  paymentProvider,
  simulatorState,
} from '@/adapters/payments'
import { fromCents } from '@/domain/money'
import { env } from '@/lib/env'

/**
 * The simulator's control surface. Development and test only — **404 in
 * production**, like `/dev/sms` and `/dev/tokens`.
 *
 * A real provider has a checkout page where a payer decides, and a settlement
 * run that happens without anybody watching. The simulator has neither, so this
 * route stands in for both: it is where a person — or a test — says *this payer
 * paid*, *this one walked away*, *release this balance*, *the money landed*.
 *
 * It is deliberately separate from `/api/payments/simulator`. That route is the
 * **receiver**, shaped exactly as a production one, and the tests must exercise
 * it as such. This one is a set of controls that no production deployment has
 * an equivalent of, and mixing the two would mean the receiver carrying an
 * argument that only a test ever sends.
 *
 * Nothing here reaches a repository, a contribution or the ledger. Crediting
 * anything is M5-03.
 */

/** `HeldBalanceProvider` has no controls on it. Only the simulator does. */
function simulator(): SimulatedPaymentProvider {
  const provider = paymentProvider(env.NODE_ENV)

  if (!(provider instanceof SimulatedPaymentProvider)) {
    // Unreachable while `paymentProvider` returns the simulator or throws, and
    // the assertion is here so that the day it returns something else, this
    // route stops rather than silently doing nothing.
    throw new Error('/dev/payments is only meaningful against the simulator')
  }

  return provider
}

const NOTIFY_URL = `${env.NEXT_PUBLIC_APP_URL}/api/payments/simulator`

/** `FormDataEntryValue` is `string | File`, and a `File` stringifies to junk. */
function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function page(): string {
  const state = simulatorState()

  const rows = state.payIns
    .map(
      (payIn) => `<tr>
        <td><code>${payIn.reference}</code></td>
        <td>${payIn.amountCents}c</td>
        <td>${payIn.settled ? 'settled' : 'waiting'}</td>
        <td>
          <form method="post"><input type="hidden" name="op" value="complete-pay-in">
          <input type="hidden" name="reference" value="${payIn.reference}">
          <button ${payIn.settled ? 'disabled' : ''}>Pay</button></form>
          <form method="post"><input type="hidden" name="op" value="cancel-pay-in">
          <input type="hidden" name="reference" value="${payIn.reference}">
          <button ${payIn.settled ? 'disabled' : ''}>Cancel</button></form>
        </td>
      </tr>`,
    )
    .join('')

  const balances = state.balances
    .map(
      (balance) => `<tr>
        <td><code>${balance.beneficiary}</code></td>
        <td>${balance.heldCents}c held</td>
        <td>${balance.paidOutCents}c paid out</td>
        <td>
          <form method="post"><input type="hidden" name="op" value="withdraw">
          <input type="hidden" name="beneficiary" value="${balance.beneficiary}">
          <input name="amountCents" value="${balance.heldCents}" size="10">
          <button>Withdraw</button></form>
        </td>
      </tr>`,
    )
    .join('')

  const withdrawals = state.withdrawals
    .map(
      (withdrawal) => `<tr>
        <td><code>${withdrawal.reference}</code></td>
        <td>${withdrawal.amountCents}c</td>
        <td>${withdrawal.state}</td>
        <td>
          <form method="post"><input type="hidden" name="op" value="complete-withdrawal">
          <input type="hidden" name="reference" value="${withdrawal.reference}">
          <button ${withdrawal.state === 'pending' ? '' : 'disabled'}>Settle</button></form>
        </td>
      </tr>`,
    )
    .join('')

  return `<!doctype html><meta charset="utf-8"><title>Payment simulator</title>
<h1>Payment simulator</h1>
<p>Development only. Nothing here touches a contribution or the ledger.</p>
<h2>Start a pay-in</h2>
<form method="post">
  <input type="hidden" name="op" value="start-pay-in">
  <label>reference <input name="reference" value="DEV-0001"></label>
  <label>cents <input name="amountCents" value="50000"></label>
  <label>beneficiary <input name="beneficiary" value="BEN-1"></label>
  <button>Start</button>
</form>
<h2>Pay-ins</h2><table>${rows}</table>
<h2>Held balances</h2><table>${balances}</table>
<h2>Withdrawals</h2><table>${withdrawals}</table>`
}

export function GET(): Response {
  if (process.env.NODE_ENV === 'production') notFound()

  return new Response(page(), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  if (process.env.NODE_ENV === 'production') notFound()

  const form = await request.formData()
  const op = text(form.get('op'))
  const reference = text(form.get('reference'))
  const provider = simulator()

  switch (op) {
    case 'start-pay-in': {
      const beneficiary = text(form.get('beneficiary'))

      await provider.startPayIn({
        reference,
        amount: fromCents(BigInt(text(form.get('amountCents')) || '0')),
        description: 'Development pay-in',
        beneficiary: beneficiary === '' ? null : beneficiary,
        returnUrl: `${env.NEXT_PUBLIC_APP_URL}/dev/payments`,
        cancelUrl: `${env.NEXT_PUBLIC_APP_URL}/dev/payments`,
        notifyUrl: NOTIFY_URL,
      })
      break
    }

    case 'complete-pay-in':
      await provider.completePayIn(reference)
      break

    case 'cancel-pay-in':
      await provider.cancelPayIn(reference)
      break

    case 'withdraw':
      await provider.requestWithdrawal({
        beneficiary: text(form.get('beneficiary')),
        amount: fromCents(BigInt(text(form.get('amountCents')) || '0')),
        // A fresh nonce per click. A test proving the idempotency rule sends
        // the same one twice, which it cannot do through this form — and that
        // is the right split: the form is for walking the model, the test is
        // for pinning the rule.
        nonce: `dev-${reference}-${String(Date.now())}`,
      })
      break

    case 'complete-withdrawal':
      await provider.completeWithdrawal(reference)
      break

    default:
      return new Response('unknown op', { status: 400 })
  }

  // POST-redirect-GET, so a refresh does not pay twice.
  return new Response(null, { status: 303, headers: { location: '/dev/payments' } })
}
