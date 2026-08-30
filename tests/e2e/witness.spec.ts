import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
/**
 * Abakhaphi, end to end (M3-03) — the three things the task is done when.
 *
 * **Invite and acceptance work end to end.** The organiser asks, gets a link,
 * and the person opens it on what is effectively a different phone: a browser
 * context with no session, no cookie and nothing of hers.
 *
 * **They render on the public page** — only those who agreed, by name.
 *
 * **Nothing is sent before they agree**, and nothing anywhere claims it was.
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

/** A valid SA ID the in-memory verifier answers immediately (M3-01). */
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

async function signIn(page: Page, request: APIRequestContext): Promise<void> {
  const phone = uniquePhone()

  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(phone)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()

  const response = await request.get(`/dev/sms?phone=${encodeURIComponent(e164(phone))}`)
  const { body } = (await response.json()) as { body: string }

  await page.getByLabel('The six-digit code').fill(/\b(\d{6})\b/.exec(body)?.[1] ?? '')
  await page.getByRole('button', { name: 'Sign me in' }).click()
  await expect(page).toHaveURL(/\/account$/)
}

/**
 * Walks the setup flow to the witnesses step, naming `people`, and stops there.
 * Returns the draft id.
 */
async function setUpTo(
  page: Page,
  people: readonly { name: string; phone: string }[],
): Promise<string> {
  await page.goto('/create?kind=umngcwabo')
  await page.getByRole('button', { name: 'Continue with funeral' }).click()
  await page.getByLabel('Her name, or his name').fill('Nokuthula Mthembu')
  await page.getByLabel('Your name').fill('Nomsa Mthembu')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: "What's needed" })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Who stands with you?' })).toBeVisible()

  for (const [index, person] of people.entries()) {
    if (index > 0) {
      await page
        .getByRole('button', {
          name: index === 1 ? 'Ask someone else too' : 'Ask a third person',
        })
        .click()
    }

    await page.getByLabel('Their name').nth(index).fill(person.name)
    await page.getByLabel('Their number').nth(index).fill(person.phone)
  }

  const id = page.url().split('/create/')[1]?.split('/')[0] ?? ''

  // Save the list before returning. Every caller needs it saved, and doing it
  // here means the wait for the navigation is in one place rather than five.
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(new RegExp(`/create/${id}/verify`))
  await page.goto(`/create/${id}/witnesses`)

  return id
}

/** Opens a link the way the person it was sent to would: a browser with nothing in it. */
async function asStranger(page: Page, url: string): Promise<Page> {
  const context = await page.context().browser()?.newContext()
  if (context === undefined) throw new Error('no browser')

  const fresh = await context.newPage()
  await fresh.goto(url)

  return fresh
}

test('an umkhaphi is asked, agrees, and appears on the page', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  await signIn(page, request)

  const eventId = await setUpTo(page, [{ name: 'Thandi Ngcobo', phone: '0821234567' }])

  await expect(page.getByText('Not answered yet')).toBeVisible()

  await page.getByRole('button', { name: 'Get a link for Thandi' }).click()

  const link = await page.locator('main').getByText(/\/k\//).innerText()
  expect(link).toContain('/k/')

  // She opens it on her own phone: a context with none of the organiser's
  // session, because an umkhaphi has no account and never will (rule 4).
  const her = await asStranger(page, link.trim())

  await expect(her.getByText('You have been asked')).toBeVisible()
  await expect(
    her.getByText('has asked you to stand with them as umkhaphi. Will you?'),
  ).toBeVisible()
  await expect(her.getByText('nothing to sign up for')).toBeVisible()
  await expect(her.locator('input[type=password]')).toHaveCount(0)
  await expect(her.locator('input[type=email]')).toHaveCount(0)

  await her.getByRole('button', { name: 'Yes, I will stand with them' }).click()
  await expect(her.getByText('You are standing with them')).toBeVisible()

  // Reading it again shows her own answer rather than an error — she did
  // nothing wrong, and "already used" would read as a fault.
  await her.reload()
  await expect(her.getByText('You are standing with them')).toBeVisible()
  await her.close()

  // Back to the organiser, who can see it.
  await page.goto(`/create/${eventId}/witnesses`)
  await expect(page.getByText('Said yes', { exact: true })).toBeVisible()

  // Publish, and the name is on the page beside hers.
  await page.goto(`/create/${eventId}/verify`)
  await page.getByLabel('Your ID number').fill(idNumber())
  await page.getByText('I have read this and I agree to the check').click()
  await page.getByRole('button', { name: 'Run the check' }).click()
  await expect(page.getByText('You are verified').first()).toBeVisible()
  await page.getByRole('button', { name: 'Carry on' }).click()
  await page.getByRole('button', { name: 'Publish and get the link' }).click()

  const url = (await page.locator('[data-copy-source]').inputValue()).trim()
  await page.goto(url)

  await expect(page.locator('header .witnesses')).toHaveText(
    'Standing with them: Thandi Ngcobo',
  )
})

test('somebody who says no is not named, and is not argued with', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  await signIn(page, request)

  const eventId = await setUpTo(page, [{ name: 'Sipho Mthembu', phone: '0821234568' }])
  await page.getByRole('button', { name: 'Get a link for Sipho' }).click()

  const link = (await page.locator('main').getByText(/\/k\//).innerText()).trim()
  const him = await asStranger(page, link)

  // Declining is the same size as accepting. A page that makes "no" small is
  // collecting agreements rather than asking a question.
  await him.getByRole('button', { name: 'No, not this time' }).click()
  await expect(him.getByText('You have said no')).toBeVisible()
  await expect(him.getByText('That is a complete answer')).toBeVisible()
  await expect(him.locator('body')).not.toContainText('Are you sure')
  await him.close()

  await page.goto(`/create/${eventId}/witnesses`)
  await expect(page.getByText('Said no', { exact: true })).toBeVisible()

  // Publishing still works with nobody having agreed, and the page names
  // nobody rather than naming him.
  await page.goto(`/create/${eventId}/verify`)
  await page.getByLabel('Your ID number').fill(idNumber())
  await page.getByText('I have read this and I agree to the check').click()
  await page.getByRole('button', { name: 'Run the check' }).click()
  await expect(page.getByText('You are verified').first()).toBeVisible()
  await page.getByRole('button', { name: 'Carry on' }).click()
  await page.getByRole('button', { name: 'Publish and get the link' }).click()

  const url = (await page.locator('[data-copy-source]').inputValue()).trim()
  await page.goto(url)

  await expect(page.locator('header .witnesses')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('Sipho Mthembu')
})

test('the whole answer works with JavaScript disabled', async ({
  page,
  request,
  browser,
}) => {
  await asFreshClient(page)
  await signIn(page, request)

  await setUpTo(page, [{ name: 'Thandi Ngcobo', phone: '0821234569' }])
  await page.getByRole('button', { name: 'Get a link for Thandi' }).click()

  const link = (await page.locator('main').getByText(/\/k\//).innerText()).trim()

  // The phone this product keeps meeting: borrowed, old, and not running our
  // script.
  const context = await browser.newContext({ javaScriptEnabled: false })
  const her = await context.newPage()

  await her.goto(link)
  await her.getByRole('button', { name: 'Yes, I will stand with them' }).click()
  await expect(her.getByText('You are standing with them')).toBeVisible()

  await context.close()
})

test('a link that is dead, forged or spent says so and shows nothing', async ({
  page,
}) => {
  const made = await page.goto('/k/not-a-real-token-at-all')
  expect(made?.status()).toBe(404)

  await expect(page.getByText('That link is not one of ours')).toBeVisible()
  // Nothing about any family reaches somebody holding a link we did not issue.
  await expect(page.locator('body')).not.toContainText('Nokuthula')
  await expect(page.locator('body')).not.toContainText('umkhaphi. Will you?')
})

test('nothing anywhere claims a message was sent', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)

  await setUpTo(page, [{ name: 'Thandi Ngcobo', phone: '0821234570' }])

  // The step that names them, before and after asking.
  const body = page.locator('main')
  await expect(body).toContainText('Nothing goes out from us')
  await expect(body).not.toContainText('We send them one message')

  await page.getByRole('button', { name: 'Get a link for Thandi' }).click()

  await expect(body).not.toContainText('has been sent')
  await expect(body).not.toContainText('Sent')
  await expect(body).toContainText('Send it to them however you normally would')

  // And the dev SMS store — the only sender that exists — has nothing for her.
  const sent = await request.get(`/dev/sms?phone=${encodeURIComponent('+27821234570')}`)
  expect(sent.status()).toBe(404)
})

test('the invite page has no accessibility violations', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)

  await setUpTo(page, [{ name: 'Thandi Ngcobo', phone: '0821234571' }])
  await page.getByRole('button', { name: 'Get a link for Thandi' }).click()

  const link = (await page.locator('main').getByText(/\/k\//).innerText()).trim()
  const her = await asStranger(page, link)

  expect((await new AxeBuilder({ page: her }).analyze()).violations).toEqual([])
  await her.close()
})
