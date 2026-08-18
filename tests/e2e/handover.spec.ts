import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'

/**
 * The handover, end to end — **M2-11's done-criterion**.
 *
 * The organiser asks somebody in the group to confirm it. That person opens the
 * link on their own phone, in a browser with no session and nothing signed in,
 * and taps once. The record closes with their name on it, the incwadi says so,
 * and **the family does nothing at any point** (rule 15, Part D2.4).
 *
 * The link is passed by hand here because nothing sends it: no BSP is
 * configured (M2-08), so the organiser's screen shows it and she forwards it
 * the way she already talks to these people.
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
 * Verifies the organiser, shares the collection and adds a confirmed member —
 * **directly in the database**.
 *
 * Verification is M3-01's and no application path sets it (M2-09), and joining
 * through the public flow is M2-10's test rather than this one's. Fixture state
 * set by a fixture, not a door added to the product.
 */
async function seedGroup(
  collectionId: string,
  phoneE164: string,
): Promise<{ slug: string; memberName: string }> {
  const prisma = prismaClient()

  try {
    await prisma.organiser.update({
      where: { phoneE164 },
      data: {
        displayName: 'Nomsa Mthembu',
        idVerificationStatus: 'verified',
        idVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
      },
    })

    const slug = `hnd${Math.random().toString(36).slice(2, 13)}`
      .padEnd(16, '0')
      .slice(0, 16)
    await prisma.collection.update({ where: { id: collectionId }, data: { slug } })

    await prisma.collectionMember.create({
      data: {
        collectionId,
        name: 'Thandi Ngcobo',
        amountCents: 80_000n,
        status: 'confirmed',
      },
    })

    return { slug, memberName: 'Thandi Ngcobo' }
  } finally {
    await prisma.$disconnect()
  }
}

test('a witness closes the record from their own phone, and the family does nothing', async ({
  page,
  request,
  browser,
}) => {
  await asFreshClient(page)
  const phone = await signIn(page, request)
  const id = await startCollection(page)
  const { slug } = await seedGroup(id, phone)

  // The organiser asks whoever will be standing there.
  await page.goto(`/collections/${id}`)
  await expect(page.getByText('Not the family')).toBeVisible()
  await page.getByRole('button', { name: 'Ask Thandi to confirm on the day' }).click()

  const link = await page.locator('main p', { hasText: '/w/' }).innerText()
  const path = link.trim().replace(/^https?:\/\/[^/]+/, '')
  expect(path).toMatch(/^\/w\/[A-Za-z0-9_-]{43}$/)

  // A different person entirely: a different browser, no session, nothing to
  // sign into (rule 4).
  const witnessContext = await browser.newContext()
  const witness = await witnessContext.newPage()
  await asFreshClient(witness)

  await witness.goto(path)
  await expect(
    witness.getByRole('heading', { name: 'Were you there when it was handed over?' }),
  ).toBeVisible()
  // Nothing moves because of this tap.
  await expect(witness.getByText('Nothing moves because of this tap')).toBeVisible()

  await witness.getByRole('button', { name: 'Yes, I was there' }).click()
  await expect(witness.getByText('Thank you. The record is closed.')).toBeVisible()

  // One entry on the chain, and the family has still not been asked for
  // anything — no page of theirs was opened and nothing waited on them.
  const prisma = prismaClient()
  try {
    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.status).toBe('handed_over')
    expect(collection.handoverStatus).toBe('witness_confirmed')
    expect(collection.hostAcknowledgedAt).toBeNull()

    const entries = await prisma.ledgerEntry.count({ where: { collectionId: id } })
    expect(entries).toBe(1)
  } finally {
    await prisma.$disconnect()
  }

  // And the paper the family keeps says who confirmed it.
  await witness.goto(`/c/${slug}/incwadi`)
  await expect(
    witness.getByText('Handed over and witnessed by Thandi Ngcobo.'),
  ).toBeVisible()

  await witnessContext.close()
})

test('the same link cannot be tapped twice', async ({ page, request, browser }) => {
  await asFreshClient(page)
  const phone = await signIn(page, request)
  const id = await startCollection(page)
  await seedGroup(id, phone)

  await page.goto(`/collections/${id}`)
  await page.getByRole('button', { name: 'Ask Thandi to confirm on the day' }).click()
  const link = await page.locator('main p', { hasText: '/w/' }).innerText()
  const path = link.trim().replace(/^https?:\/\/[^/]+/, '')

  const first = await browser.newContext()
  const firstPage = await first.newPage()
  await firstPage.goto(path)
  await firstPage.getByRole('button', { name: 'Yes, I was there' }).click()
  await expect(firstPage.getByText('Thank you. The record is closed.')).toBeVisible()

  // Forwarded into the group chat, opened by somebody else: the link is spent.
  const second = await browser.newContext()
  const secondPage = await second.newPage()
  await secondPage.goto(path)
  await expect(secondPage.getByText('That link has already been used')).toBeVisible()
  await expect(secondPage.getByRole('button', { name: 'Yes, I was there' })).toHaveCount(
    0,
  )

  await first.close()
  await second.close()
})

test('the organiser can close it herself, and the record says whose word it was', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  const phone = await signIn(page, request)
  const id = await startCollection(page)
  const { slug } = await seedGroup(id, phone)

  await page.goto(`/collections/${id}`)
  // Phones die and signal fails at gravesides.
  await expect(page.getByText('If nobody can tap it there')).toBeVisible()
  await page.getByRole('button', { name: 'Mark it myself' }).click()

  await expect(page.getByText('Closed on your word')).toBeVisible()
  await expect(page.getByText('worth less than a witness')).toBeVisible()

  await page.goto(`/c/${slug}/incwadi`)
  await expect(page.getByText('on her own word')).toBeVisible()
  await expect(page.getByText('witnessed by')).toHaveCount(0)
})

test('the family can acknowledge it, and nothing waited on them', async ({
  page,
  request,
  browser,
}) => {
  await asFreshClient(page)
  const phone = await signIn(page, request)
  const id = await startCollection(page)
  await seedGroup(id, phone)

  await page.goto(`/collections/${id}`)
  await page.getByRole('button', { name: 'Mark it myself' }).click()
  await expect(page.getByText('Closed on your word')).toBeVisible()

  // Offered only after the record is already closed.
  await page.getByRole('button', { name: 'Get a link for the family' }).click()
  const link = await page.locator('main p', { hasText: '/h/' }).innerText()
  const path = link.trim().replace(/^https?:\/\/[^/]+/, '')

  const host = await browser.newContext()
  const hostPage = await host.newPage()
  await hostPage.goto(path)

  await expect(hostPage.getByText('nothing depends on it')).toBeVisible()
  await hostPage.getByRole('button', { name: 'Yes, it reached us' }).click()
  await expect(hostPage.getByText('never required')).toBeVisible()

  const prisma = prismaClient()
  try {
    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    // The account of who closed it is unchanged, and there is still one entry.
    expect(collection.handoverStatus).toBe('organiser_evidenced')
    expect(collection.hostAcknowledgedAt).not.toBeNull()
    expect(await prisma.ledgerEntry.count({ where: { collectionId: id } })).toBe(1)
  } finally {
    await prisma.$disconnect()
  }

  await host.close()
})

test('the witness page and the incwadi ship no framework and are axe clean', async ({
  page,
  request,
  browser,
}) => {
  await asFreshClient(page)
  const phone = await signIn(page, request)
  const id = await startCollection(page)
  const { slug } = await seedGroup(id, phone)

  await page.goto(`/collections/${id}`)
  await page.getByRole('button', { name: 'Ask Thandi to confirm on the day' }).click()
  const link = await page.locator('main p', { hasText: '/w/' }).innerText()
  const path = link.trim().replace(/^https?:\/\/[^/]+/, '')

  const visitor = await browser.newContext()
  const witness = await visitor.newPage()

  const scripts: string[] = []
  witness.on('request', (each) => {
    if (each.resourceType() === 'script') scripts.push(new URL(each.url()).pathname)
  })

  await witness.setViewportSize({ width: 375, height: 800 })
  await witness.goto(path)

  // A page somebody opens at a graveside on a prepaid bundle.
  expect(scripts).toEqual([])
  expect((await new AxeBuilder({ page: witness }).analyze()).violations).toEqual([])

  await witness.goto(`/c/${slug}/incwadi`)
  expect((await new AxeBuilder({ page: witness }).analyze()).violations).toEqual([])

  await visitor.close()
})
