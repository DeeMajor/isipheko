import { PayFastProvider } from '../src/adapters/payments/payfast-provider.ts'
import { fromCents } from '../src/domain/money/index.ts'

/**
 * Puts our PayFast signature in front of PayFast's own sandbox and reports what
 * it said. `pnpm check:payfast`.
 *
 * ## Why this is a script and not a test
 *
 * It makes a real request to a third party's server. In the unit gate that is a
 * test that fails when the wifi does, and a gate that fails for reasons
 * unrelated to the change is a gate people learn to re-run rather than read
 * (M2-08 §2's reasoning about counters, one layer along). So it is a command,
 * run when the adapter changes and when somebody wants to know the answer is
 * still yes.
 *
 * ## What it settles, and what it does not
 *
 * PayFast publishes **two** reference implementations of the signature, in PHP
 * and JavaScript, and they disagree on `!'()*~` — see
 * `src/adapters/payments/payfast-signature.ts`. Reading the documentation
 * cannot resolve that. Posting a signed form to their server can, and does:
 * a signature they accept mints a payment page, and one they do not gets a
 * 400.
 *
 * **This settles the outgoing direction only.** The incoming direction — an
 * Instant Transaction Notification posted by PayFast to our `notify_url` —
 * needs a publicly reachable URL and a completed sandbox payment, which needs a
 * person. That half stays partially met, the same posture as M2-07's WhatsApp
 * rendering and M4-03b's printer preflight. See docs/decisions.md M5-01 §4.
 *
 * The credentials below are PayFast's own published sandbox ones. Nothing here
 * touches a real account, and no payment is completed — the form is posted and
 * the resulting page is read, which is where this stops.
 */

const SANDBOX = {
  merchantId: '10000100',
  merchantKey: '46f0cd694581a',
  passphrase: 'jt7NOE43FZPn',
  mode: 'sandbox',
} as const

const PROCESS_URL = 'https://sandbox.payfast.co.za/eng/process'

async function postForm(
  body: string,
): Promise<{ status: number; location: string | null }> {
  const response = await fetch(PROCESS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  })

  return { status: response.status, location: response.headers.get('location') }
}

function encode(fields: readonly (readonly [string, string])[]): string {
  return fields.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&')
}

const provider = new PayFastProvider(SANDBOX)

const handle = await provider.startPayIn({
  reference: 'MTH-4K7B2X',
  amount: fromCents(50_000n),
  description: 'Umngcwabo kaMaMkhize',
  beneficiary: null,
  returnUrl: 'https://isipheko.co.za/e/abc/done',
  cancelUrl: 'https://isipheko.co.za/e/abc',
  notifyUrl: 'https://isipheko.co.za/api/payments/payfast',
})

if (handle.redirect.kind !== 'post') {
  process.stderr.write('PayFast should always answer with a form to post.\n')
  process.exit(1)
}

const signed = encode(handle.redirect.fields)
const corrupted = signed.replace(/signature=.*/, `signature=${'0'.repeat(32)}`)

const good = await postForm(signed)
const bad = await postForm(corrupted)

process.stdout.write('\nPayFast sandbox — outgoing signature\n\n')
process.stdout.write(
  `  signed     ${String(good.status)}  ${good.location ?? '(no redirect)'}\n`,
)
process.stdout.write(
  `  corrupted  ${String(bad.status)}  ${bad.location ?? '(no redirect)'}\n\n`,
)

// A signature PayFast accepts mints a payment and redirects to it. One it does
// not gets 400 without minting anything. Both halves are asserted, because a
// server that answered 302 to everything would make the first half meaningless.
const accepted =
  good.status === 302 && (good.location ?? '').includes('/process/payment/')
const refused = bad.status === 400

if (accepted && refused) {
  process.stdout.write(
    '  PayFast accepts our signature and refuses a corrupted one.\n' +
      '  The outgoing encoding question is settled. The ITN direction is not —\n' +
      '  it needs a public notify_url and a completed sandbox payment.\n\n',
  )
  process.exit(0)
}

process.stderr.write(
  `  FAILED — accepted: ${String(accepted)}, refused-corrupted: ${String(refused)}\n` +
    '  If the signed form was refused, the encoder in payfast-signature.ts and\n' +
    "  PayFast's server no longer agree. Do not ship past this.\n\n",
)
process.exit(1)
