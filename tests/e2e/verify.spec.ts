import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'

/**
 * The identity check, end to end (M3-01).
 *
 * **The whole flow works with JavaScript disabled**, including the wait. The
 * pending page reloads itself with a `<meta http-equiv="refresh">` and no
 * script, which is what a borrowed phone on a prepaid bundle gets.
 *
 * **The ID number never appears in a URL.** Errors come back as codes (M1-06
 * §10), so there is no branch that could put thirteen digits into an address
 * bar, browser history, or a `Referer` header on a shared phone.
 *
 * **The check is what finally opens the collection share gate**, which has
 * refused everybody since M2-09 §8.
 */

/**
 * Digits 7–10 pick the sandbox behaviour; see the in-memory verifier. The date
 * of birth is random and the check digit follows it, because **one identity
 * means one account** and this suite runs against a development database that
 * outlives the run — a fixed number would verify once and then be a duplicate
 * for every run afterwards.
 */
const ORDINARY = '5800' // pending, then verified
const NO_MATCH = '0002'

function checkDigit(first12: string): string {
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

  return String((10 - (sum % 10)) % 10)
}

function idNumber(sequence: string): string {
  const year = String(Math.floor(Math.random() * 100)).padStart(2, '0')
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')
  const first12 = `${year}${month}${day}${sequence}08`

  return first12 + checkDigit(first12)
}

/** The check digit does not add up, so nothing is ever asked of a provider. */
const MISTYPED = '5306075800081'

function prismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://isipheko_app:isipheko_local_dev@localhost:5433/isipheko',
    }),
  })
}

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

async function signIn(page: Page, request: APIRequestContext): Promise<string> {
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

  return e164(phone)
}

async function submit(page: Page, idNumber: string): Promise<void> {
  const name = page.getByLabel('Your name, as Home Affairs has it')
  if (await name.isVisible()) await name.fill('Nomsa Mthembu')

  await page.getByLabel('Your ID number').fill(idNumber)
  await page.getByText('I have read this and I agree to the check').click()
  await page.getByRole('button', { name: /Run the check|Try again/ }).click()
}

/**
 * The check settles on a reload, so this is the wait for it.
 *
 * It waits for a **terminal** screen rather than for the pending one to go away.
 * Those are not the same thing: the submission navigates, and a reload issued
 * while that navigation is in flight lands back on the form, which is also "not
 * pending" — a wait written the other way round passes instantly on the wrong
 * page and then fails on the assertion after it.
 */
async function settle(page: Page): Promise<void> {
  await expect(async () => {
    await page.reload()
    await expect(
      page.getByText(/You are verified|That check did not pass/).first(),
    ).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 25_000 })
}

test('an organiser verifies, and the record holds no ID number', async ({
  page,
  request,
}) => {
  const identity = idNumber(ORDINARY)

  await asFreshClient(page)
  const phoneE164 = await signIn(page, request)

  await page.goto('/verify')
  await expect(page.getByRole('heading', { name: 'Confirm it is you' })).toBeVisible()

  // The words that get hashed into the consent record are on screen, in full,
  // above the box that agrees to them.
  await expect(page.getByText('It is not stored, it is never shown')).toBeVisible()

  await submit(page, identity)

  // Never blocked on: the submission returns to a page that says it is waiting.
  await expect(
    page.getByRole('heading', { name: 'Checking with Home Affairs' }),
  ).toBeVisible()
  // And the page reloads itself, with no script involved.
  await expect(page.locator('meta[http-equiv="refresh"]')).toHaveCount(1)

  await settle(page)
  await expect(page.getByRole('heading', { name: 'You are verified' })).toBeVisible()
  await expect(page.getByText('was not kept')).toBeVisible()

  // Nowhere in the address bar, at any point.
  expect(page.url()).not.toContain(identity)

  const prisma = prismaClient()
  try {
    const organiser = await prisma.organiser.findUniqueOrThrow({
      where: { phoneE164 },
      include: { identityChecks: true, identityConsents: true },
    })

    expect(organiser.idVerificationStatus).toBe('verified')
    expect(organiser.idVerifiedAt).not.toBeNull()

    // Consent was captured, and it says what was agreed to.
    expect(organiser.identityConsents).toHaveLength(1)
    expect(organiser.identityConsents[0]?.copyKey).toBe('identity.consent')

    // The done criterion, against rows a real submission wrote.
    const dump = JSON.stringify(organiser)
    expect(dump).not.toContain(identity)
    expect(dump).not.toMatch(/photo|image|selfie/i)
  } finally {
    await prisma.$disconnect()
  }
})

test('the whole flow works with JavaScript disabled', async ({ browser, request }) => {
  const identity = idNumber(ORDINARY)
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  try {
    await asFreshClient(page)
    await signIn(page, request)

    await page.goto('/verify')
    await submit(page, identity)

    // The wait itself is what needs no script: a meta refresh, not a poller.
    await expect(page.locator('meta[http-equiv="refresh"]')).toHaveCount(1)

    await settle(page)
    await expect(page.getByRole('heading', { name: 'You are verified' })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('a mistyped number is refused before anything is checked', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  const phoneE164 = await signIn(page, request)

  await page.goto('/verify')
  await submit(page, MISTYPED)

  await expect(page.getByText('the last digit is a check on the others')).toBeVisible()
  // A code, not the number (rule 8).
  expect(page.url()).toContain('id=check-digit')
  expect(page.url()).not.toContain('5306075800081')

  // And no attempt was opened, so nobody was billed for a typo.
  const prisma = prismaClient()
  try {
    const organiser = await prisma.organiser.findUniqueOrThrow({
      where: { phoneE164 },
      include: { identityChecks: true },
    })

    expect(organiser.identityChecks).toHaveLength(0)
    expect(organiser.idVerificationStatus).toBe('unverified')
  } finally {
    await prisma.$disconnect()
  }
})

test('a check cannot run without consent', async ({ page, request }) => {
  await asFreshClient(page)
  const phoneE164 = await signIn(page, request)

  await page.goto('/verify')
  await page.getByLabel('Your name, as Home Affairs has it').fill('Nomsa Mthembu')
  await page.getByLabel('Your ID number').fill(idNumber(ORDINARY))

  // The checkbox is `required`, so the browser refuses to submit it at all.
  await page.getByRole('button', { name: 'Run the check' }).click()

  const prisma = prismaClient()
  try {
    const organiser = await prisma.organiser.findUniqueOrThrow({
      where: { phoneE164 },
      include: { identityChecks: true, identityConsents: true },
    })

    expect(organiser.identityConsents).toHaveLength(0)
    expect(organiser.identityChecks).toHaveLength(0)
  } finally {
    await prisma.$disconnect()
  }
})

test('a failed check says what happened and offers another go', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  await signIn(page, request)

  await page.goto('/verify')
  await submit(page, idNumber(NO_MATCH))
  await settle(page)

  await expect(page.getByText('does not match the name on this account')).toBeVisible()
  // No report channel is promised, because M3-06 has not built one.
  await expect(page.locator('main')).toContainText('nowhere on Isipheko to report')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('verifying opens the collection share gate', async ({ page, request }) => {
  const identity = idNumber(ORDINARY)

  await asFreshClient(page)
  await signIn(page, request)

  await page.goto('/collections/new')
  await page.getByLabel('What the group is called').fill('The Ngcobo cousins')
  await page.getByLabel('Who it is for').fill('The Mthembu family')
  await page
    .getByLabel('Where people should send it')
    .fill("Nomsa's Capitec, ending 4471")
  await page.getByRole('button', { name: 'Start it' }).click()
  await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/)

  const collectionUrl = page.url()

  // The way out of the refusal, which is what M3-01 added to this screen.
  await page.getByRole('button', { name: 'Confirm it is you' }).click()
  await expect(page).toHaveURL(/\/verify\?returnTo=/)

  await submit(page, identity)
  await settle(page)
  await page.getByRole('button', { name: 'Carry on' }).click()
  await expect(page).toHaveURL(collectionUrl)

  await page.getByRole('button', { name: 'Try to get the link' }).click()
  await expect(page.locator('main')).toContainText('/c/')
})

test('the check asks for no account and no email', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)
  await page.goto('/verify')

  // Same assertion as the contribution flow (M2-05 §8). An organiser has an
  // account already, but the identity screen must not grow a second one.
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.locator('input[type=email]')).toHaveCount(0)
})

test('the check page has no accessibility violations', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)
  await page.goto('/verify')

  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(violations).toEqual([])
})
