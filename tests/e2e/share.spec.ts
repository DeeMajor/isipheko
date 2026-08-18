import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The share step: the two send buttons, the link, and the chat preview.
 *
 * The organiser is deciding here whether to send this to fifty people, so two
 * things are checked as hard as the mechanics: that nothing on the screen
 * claims a verification that has not happened (M3-01), and that the send
 * buttons are plain links which work with no script at all.
 */

function uniquePhone(): string {
  return `082${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`
}

const e164 = (local: string) => `+27${local.slice(1)}`

async function asFreshClient(page: Page): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  await page.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.51.${String(octet())}.${String(octet())}`,
  })
}

async function signIn(page: Page, request: APIRequestContext): Promise<void> {
  const phone = uniquePhone()

  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(phone)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()

  const response = await request.get(`/dev/sms?phone=${encodeURIComponent(e164(phone))}`)
  const { body } = (await response.json()) as { body: string }
  const code = /\b(\d{6})\b/.exec(body)?.[1] ?? ''

  await page.getByLabel('The six-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign me in' }).click()
  await expect(page).toHaveURL(/\/account$/)
}

/**
 * A valid SA ID with a random date of birth and the sequence block the
 * in-memory verifier answers "verified" to on the first call (M3-01), so this
 * spec does not spend twenty seconds reloading a pending page. The polling path
 * is exercised in `verify.spec.ts`, where it is the subject.
 */
function idNumber(): string {
  const year = String(Math.floor(Math.random() * 100)).padStart(2, '0')
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')
  const first12 = `${year}${month}${day}000008`

  let sum = 0
  let double = true
  for (let index = first12.length - 1; index >= 0; index -= 1) {
    let digit = first12.charCodeAt(index) - 48
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }

  return first12 + String((10 - (sum % 10)) % 10)
}

/** Walks the six steps and publishes, leaving the browser on the share step. */
async function publishFuneral(page: Page): Promise<string> {
  await page.goto('/create?kind=umngcwabo')
  await page.getByRole('button', { name: 'Continue with funeral' }).click()

  await page.getByLabel('Her name, or his name').fill('Nokuthula Mthembu')
  await page.getByLabel('Clan name (optional)').fill('uMaZondi')
  await page.getByLabel('Your name').fill('Nomsa Mthembu')
  await page.getByLabel('Where').fill('KwaMashu, KwaZulu-Natal')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: "What's needed" })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByLabel('Their name').fill('Thandi Ngcobo')
  await page.getByLabel('Their number').fill('0821234567')
  await page.getByRole('button', { name: 'Continue' }).click()

  // The identity check, which since M3-02 is what publishing waits on.
  await expect(
    page.getByRole('heading', { name: 'One check, then you can share it' }),
  ).toBeVisible()
  await page.getByLabel('Your ID number').fill(idNumber())
  await page.getByText('I have read this and I agree to the check').click()
  await page.getByRole('button', { name: 'Run the check' }).click()
  await expect(page.getByText('You are verified').first()).toBeVisible()
  await page.getByRole('button', { name: 'Carry on' }).click()

  await page.getByRole('button', { name: 'Publish and get the link' }).click()

  const link = page.locator('[data-copy-source]')
  await expect(link).toBeVisible()

  return (await link.inputValue()).trim()
}

test('hands over a link, a WhatsApp message and an SMS', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)

  const url = await publishFuneral(page)
  expect(url).toContain('/e/')

  const whatsapp = page.getByRole('link', { name: 'Send on WhatsApp' })
  const sms = page.getByRole('link', { name: 'Send by SMS' })

  // Plain links, so they work with no script and open the app that is there.
  const waHref = (await whatsapp.getAttribute('href')) ?? ''
  expect(waHref.startsWith('https://wa.me/?text=')).toBe(true)

  const text = decodeURIComponent(waHref.split('text=')[1] ?? '')
  // The message is a funeral's, and the link is last so WhatsApp finds it.
  expect(text).toContain('Nokuthula Mthembu')
  expect(text).toContain('stood with them')
  expect(text.endsWith(url)).toBe(true)

  const smsHref = (await sms.getAttribute('href')) ?? ''
  expect(smsHref.startsWith('sms:?body=')).toBe(true)
  expect(decodeURIComponent(smsHref)).toContain(url)
})

test('shows the chat preview, with the badge she earned in it', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  await signIn(page, request)

  await publishFuneral(page)

  await expect(page.getByText('How it will look in the chat')).toBeVisible()
  await expect(page.getByText('Organised by Nomsa Mthembu').first()).toBeVisible()
  await expect(page.getByText('Umngcwabo ·').first()).toBeVisible()

  // She verified two steps ago, so the mock shows the tick the card draws and
  // the intro is the verified wording M1-08 §5 refused when it was not true.
  await expect(
    page.getByText('Organised by Nomsa Mthembu · verified').first(),
  ).toBeVisible()
  await expect(page.locator('main')).toContainText('sees your verified name')
  await expect(page.locator('main')).toContainText('carries your name and the tick')

  // And no card promises money is safe with us, or shows an amount.
  await expect(page.locator('main')).not.toContainText('held Isipheko account')
  await expect(page.locator('main')).not.toHaveText(/R\s?\d/)
})

test('the copy button is wired, and only exists where script can run', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  await signIn(page, request)
  await publishFuneral(page)

  const copy = page.getByRole('button', { name: 'Copy link' })
  await expect(copy).toBeVisible()

  // Wait for the enhancement to arrive rather than assuming it already has.
  // It loads after the page is interactive, which on a busy machine is
  // measurably later than the button appearing — and the page is complete
  // without it in the meantime, which is the whole design.
  await expect
    .poll(async () => await page.locator('script[src*="share.js"]').count())
    .toBeGreaterThan(0)

  await copy.click()

  /*
   * The assertion is the selection, not the clipboard.
   *
   * `/share.js` focuses the field, selects all of it, and then asks the browser
   * to copy — and both copy paths need a **focused document**, which a headless
   * Chromium sharing a machine with five other workers frequently is not. The
   * clipboard would therefore be a test of the runner's window management. The
   * selection is not: it proves the delegated handler ran on the right element
   * and got as far as asking.
   *
   * That the copy itself works is on the device checklist in
   * docs/decisions.md M2-07 §12, with the WhatsApp preview.
   */
  const selection = await page.locator('[data-copy-source]').evaluate((node) => {
    const input = node as HTMLInputElement
    return { start: input.selectionStart, end: input.selectionEnd, value: input.value }
  })

  expect(selection.start).toBe(0)
  expect(selection.end).toBe(selection.value.length)
  expect(selection.value).toContain('/e/')
})

test('the link is still there with JavaScript disabled', async ({ browser, request }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await asFreshClient(page)
  await signIn(page, request)
  const url = await publishFuneral(page)

  // No dead button: the <noscript> stylesheet hides the copy control exactly
  // where it could not work, and the URL is readable and selectable either way.
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeHidden()
  await expect(page.locator('[data-copy-source]')).toHaveValue(url)
  await expect(page.getByRole('link', { name: 'Send on WhatsApp' })).toBeVisible()

  await context.close()
})

test('has no axe violations at 375px', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)
  await page.setViewportSize({ width: 375, height: 800 })
  await publishFuneral(page)

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})
