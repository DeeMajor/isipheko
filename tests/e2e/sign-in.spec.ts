import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Signing in, end to end.
 *
 * The code is read from `/dev/sms` — the in-memory sender's window, which 404s
 * in production. It is never printed anywhere, so there is no log for this test
 * to scrape and no log for anybody else to find.
 */

/** A fresh number per test: the hourly limit is per number, and rows persist. */
function uniquePhone(): string {
  const suffix = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')
  return `082${suffix}`
}

/**
 * A fresh client address per test.
 *
 * There is a second limit on the requester, and without this every test in the
 * file looks like the same person: the suite trips its own IP limit after a
 * dozen requests and later tests fail for a reason that has nothing to do with
 * what they are checking. `cf-connecting-ip` is what the application trusts
 * first, because Cloudflare sets it and strips any copy the client sent.
 */
function asFreshClient(page: Page): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return page.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.51.${String(octet())}.${String(octet())}`,
  })
}

const e164 = (local: string) => `+27${local.slice(1)}`

async function codeSentTo(request: APIRequestContext, local: string): Promise<string> {
  const response = await request.get(`/dev/sms?phone=${encodeURIComponent(e164(local))}`)
  expect(response.status(), 'no SMS was held for that number').toBe(200)

  const { body } = (await response.json()) as { body: string }
  const match = /\b(\d{6})\b/.exec(body)

  expect(match, `no six-digit code in: ${body}`).not.toBeNull()
  return match?.[1] ?? ''
}

async function requestCode(page: Page, local: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(local)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()
}

test('signs in, stays signed in, and signs out', async ({ page, request }) => {
  await asFreshClient(page)
  const phone = uniquePhone()

  await requestCode(page, phone)

  const code = await codeSentTo(request, phone)
  await page.getByLabel('The six-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign me in' }).click()

  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible()

  // The session survives a reload — it is a cookie and a row, not page state.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible()

  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in$/)

  // And the session is gone rather than merely forgotten by the page.
  await page.goto('/account')
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('the SMS never says the code is a secret we would ask for', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  const phone = uniquePhone()
  await requestCode(page, phone)

  const response = await request.get(`/dev/sms?phone=${encodeURIComponent(e164(phone))}`)
  const { body } = (await response.json()) as { body: string }

  // Architecture §10: every outbound message says we never ask for it.
  expect(body).toContain('never phone or message you to ask for it')
})

test('a wrong code is refused, and says so without saying why', async ({ page }) => {
  await asFreshClient(page)
  await requestCode(page, uniquePhone())

  await page.getByLabel('The six-digit code').fill('000000')
  await page.getByRole('button', { name: 'Sign me in' }).click()

  // Scoped to the field: Next's route announcer is also role="alert".
  const error = page.locator('#code-error')
  await expect(error).toBeVisible()
  await expect(error).toContainText('wrong or has expired')

  // Wrong, expired and never-existed all read the same. Three messages would
  // map which numbers are real.
  await expect(error).not.toContainText('registered')
  await expect(error).not.toContainText('exist')
})

test('an unknown number reaches the code step exactly like a known one', async ({
  page,
}) => {
  // Nothing on the page distinguishes a number we have never seen from one we
  // have, which is the whole point.
  await asFreshClient(page)
  await requestCode(page, uniquePhone())

  await expect(page.getByText('If we can reach that number')).toBeVisible()
})

test('the fourth code in an hour is not sent', async ({ page, request }) => {
  // One client, one number, four requests — so the limit under test is the
  // per-number one and not the per-address one.
  await asFreshClient(page)
  const phone = uniquePhone()

  await requestCode(page, phone)
  const first = await codeSentTo(request, phone)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await requestCode(page, phone)
  }

  const third = await codeSentTo(request, phone)
  expect(third).not.toBe(first)

  // The fourth request inside the hour. The page says exactly what it said the
  // first three times — and no new SMS goes out.
  await requestCode(page, phone)
  await expect(page.getByText('If we can reach that number')).toBeVisible()

  const fourth = await codeSentTo(request, phone)
  expect(fourth, 'a fourth code was sent inside the hour').toBe(third)
})

test('works with JavaScript disabled', async ({ browser, request }) => {
  // The forms post to server actions and the page is server-rendered, so the
  // whole flow degrades to plain HTML. Somebody on a borrowed phone with a
  // browser that lost its script is still able to sign in.
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await asFreshClient(page)
  const phone = uniquePhone()

  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(phone)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()

  const code = await codeSentTo(request, phone)
  await page.getByLabel('The six-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign me in' }).click()

  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible()

  await context.close()
})

test('has no axe violations on either step', async ({ page }) => {
  await asFreshClient(page)
  await page.goto('/sign-in')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await requestCode(page, uniquePhone())
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

/**
 * The resend (UX-14). The only recovery from a lost SMS used to be "Use a
 * different number" — a restart wearing the wrong name — while the wrong-code
 * error said "ask for a new one", naming a button that did not exist. The new
 * code is the one that works; only the newest challenge is ever checked
 * (M1-06 §8), so the old one stops working by construction.
 */
test('a new code can be sent to the same number, and the old one stops working', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  const phone = uniquePhone()

  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(phone)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()

  const first = await codeSentTo(request, phone)

  await page.getByRole('button', { name: 'Send a new code' }).click()
  await expect(page.getByText('The old one stops working.')).toBeVisible()

  const second = await codeSentTo(request, phone)
  expect(second).not.toBe(first)

  // The old code is refused — the newest challenge is the only one checked.
  await page.getByLabel('The six-digit code').fill(first)
  await page.getByRole('button', { name: 'Sign me in' }).click()
  await expect(page.getByText('That code is wrong or has expired')).toBeVisible()

  await page.getByLabel('The six-digit code').fill(second)
  await page.getByRole('button', { name: 'Sign me in' }).click()
  await expect(page).toHaveURL(/\/account$/)
})
