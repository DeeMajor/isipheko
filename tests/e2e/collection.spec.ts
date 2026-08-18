import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'

/**
 * Collections, end to end — the three things M2-10 is done when.
 *
 * **An unverified organiser cannot generate a share link.** She can start a
 * collection, see who joined, and ask for the link; the answer is no, and no
 * slug is written. That is rule 13 doing the only work it can do: we never hold
 * the money, so the link is the only leverage there is.
 *
 * **Members join without accounts.** No password, no email, no signup input on
 * any step of the flow.
 *
 * **The trust panel says who holds the money** — in her name, in the words
 * `design/collection.html` uses, above anything that asks anybody to give.
 */

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

/** Starts a collection through the real screens and returns its id. */
async function startCollection(page: Page): Promise<string> {
  await page.goto('/collections/new')
  await page.getByLabel('What the group is called').fill('The Ngcobo cousins')
  await page.getByLabel('Who it is for').fill('The Mthembu family')
  await page
    .getByLabel('Where people should send it')
    .fill("Nomsa's Capitec, ending 4471")
  await page.getByRole('button', { name: 'Start it' }).click()

  await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/)

  return page.url().split('/collections/')[1] ?? ''
}

/**
 * Verifies an organiser and shares a collection **directly in the database**.
 *
 * There is no application path to either, deliberately: M3-01 is what sets a
 * verification status, and no flag bypasses the gate (M2-09). The tests set the
 * state the same way `scripts/size-gate.ts` seeds its fixtures — not by adding
 * a door to the product.
 */
async function verifyAndShare(collectionId: string, phoneE164: string): Promise<string> {
  const prisma = prismaClient()

  try {
    await prisma.organiser.update({
      where: { phoneE164 },
      data: {
        idVerificationStatus: 'verified',
        idVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
        displayName: 'Nomsa Mthembu',
      },
    })

    const slug = `col${Math.random().toString(36).slice(2, 13)}`
      .padEnd(16, '0')
      .slice(0, 16)
    await prisma.collection.update({ where: { id: collectionId }, data: { slug } })

    return slug
  } finally {
    await prisma.$disconnect()
  }
}

test('an unverified organiser cannot generate a share link', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  await signIn(page, request)
  const id = await startCollection(page)

  // The screen says why rather than hiding the button: the check is not
  // switched on, and pretending otherwise would be the dishonest thing.
  await expect(page.getByText('This cannot be shared yet')).toBeVisible()

  await page.getByRole('button', { name: 'Try to get the link' }).click()

  await expect(page).toHaveURL(/blocked=not-verified/)
  await expect(page.getByText('cannot be shared yet').first()).toBeVisible()
  // And a way through it, which is what M3-01 added — a refusal with no route
  // out of it was the gap M2-10 §10 left open only because nothing verified.
  await expect(page.getByRole('button', { name: 'Confirm it is you' })).toBeVisible()
  // No link anywhere on the page.
  await expect(page.locator('main')).not.toContainText('/c/')

  const prisma = prismaClient()
  try {
    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.slug).toBeNull()
  } finally {
    await prisma.$disconnect()
  }
})

test('the page says who holds the money, before it asks for any', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  const phone = await signIn(page, request)
  const id = await startCollection(page)
  const slug = await verifyAndShare(id, phone)

  await page.goto(`/c/${slug}`)

  // Rule 16 and Part D2.6, in her name and in full.
  await expect(
    page.getByText('Nomsa Mthembu holds this money, not Isipheko.'),
  ).toBeVisible()
  await expect(
    page.getByText(
      'You are trusting her, the way you would if she collected it in an envelope.',
    ),
  ).toBeVisible()

  // Two questions, answered separately.
  await expect(
    page.getByRole('heading', { name: 'Is this real, and who holds the money?' }),
  ).toBeVisible()
  await expect(
    page.getByText('Isipheko never receives it, never holds it, and cannot refund it.'),
  ).toBeVisible()

  // And nothing anywhere claims we are keeping it safe.
  await expect(page.locator('body')).not.toContainText('held safely')
  await expect(page.locator('body')).not.toContainText('we hold')
})

test('a member joins with no account of any kind', async ({ page, request, browser }) => {
  await asFreshClient(page)
  const phone = await signIn(page, request)
  const id = await startCollection(page)
  const slug = await verifyAndShare(id, phone)

  // A different person entirely: no session, nothing to sign into.
  const visitor = await browser.newContext()
  const member = await visitor.newPage()
  await asFreshClient(member)

  const fields: string[] = []

  await member.goto(`/c/${slug}`)
  await member.getByRole('button', { name: 'Join this collection' }).click()

  await expect(member.getByLabel('How much are you putting in')).toBeVisible()
  fields.push(await member.locator('main').innerHTML())
  await member.getByLabel('How much are you putting in').fill('R250')
  await member.getByRole('button', { name: 'Continue' }).click()

  await member.getByLabel('Your name').fill('Xolani Cele')
  fields.push(await member.locator('main').innerHTML())
  await member.getByRole('button', { name: 'Continue' }).click()

  // Where to send it: her own account, in her own words.
  await expect(member.getByText("Nomsa's Capitec, ending 4471")).toBeVisible()
  fields.push(await member.locator('main').innerHTML())
  await member.getByRole('button', { name: "I've sent it" }).click()

  await expect(member.getByRole('heading', { name: 'You are on the list' })).toBeVisible()

  // Rule 4, on every step that was actually rendered.
  for (const markup of fields) {
    expect(markup).not.toContain('type="password"')
    expect(markup).not.toContain('type="email"')
    expect(markup.toLowerCase()).not.toContain('sign up')
    expect(markup.toLowerCase()).not.toContain('create an account')
  }

  // And they are on the roster, marked as not yet marked off — the organiser
  // is the one who knows whether the money reached her.
  await member.goto(`/c/${slug}`)
  await expect(member.getByText('Xolani Cele')).toBeVisible()
  await expect(member.getByText('Not marked off yet')).toBeVisible()

  await visitor.close()
})

test('the organiser marks somebody off and the total follows', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  const phone = await signIn(page, request)
  const id = await startCollection(page)
  const slug = await verifyAndShare(id, phone)

  const prisma = prismaClient()
  try {
    await prisma.collectionMember.create({
      data: { collectionId: id, name: 'Sanele Mthembu', amountCents: 70_000n },
    })
  } finally {
    await prisma.$disconnect()
  }

  // Nothing counts until she says it reached her: the roster lists them, the
  // total does not include them, and the page says which.
  await page.goto(`/c/${slug}`)
  await expect(page.getByText('Not marked off yet')).toBeVisible()
  await expect(page.locator('.totalAmount')).toHaveText('R0')

  await page.goto(`/collections/${id}`)
  await page.getByRole('button', { name: 'It arrived' }).click()
  // Wait for the action's redirect: without it the next navigation can beat
  // the update, and the page is then correct about a database that has not
  // caught up.
  await page.waitForURL(/confirmed=1/)

  await page.goto(`/c/${slug}`)
  await expect(page.locator('.totalAmount')).toHaveText('R700')
  await expect(page.getByText('Not marked off yet')).toHaveCount(0)
})

test('the collection page ships no framework, and is axe clean at 375px', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  const phone = await signIn(page, request)
  const id = await startCollection(page)
  const slug = await verifyAndShare(id, phone)

  const scripts: string[] = []
  page.on('request', (each) => {
    if (each.resourceType() === 'script') scripts.push(new URL(each.url()).pathname)
  })

  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto(`/c/${slug}`)

  // A public contributor path, so the same rule as /e/[slug]: no framework
  // runtime, and nothing here needs an enhancement.
  expect(scripts).toEqual([])

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('a collection nobody could share is not reachable', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)
  await startCollection(page)

  // No slug, no page — and a made-up one answers the same way.
  const response = await page.goto('/c/aaaaaaaaaaaaaaaa')
  expect(response?.status()).toBe(404)
})
