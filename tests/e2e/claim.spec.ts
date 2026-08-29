import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'
import { generateCode } from '@/domain/reference'

/**
 * Claiming, both ways.
 *
 * The path that must never break is the one with **no JavaScript at all** — the
 * public page is a route handler with no client runtime (M1-08), and CLAUDE.md
 * rule 5 has required a working `<form method="post">` since long before that.
 * The enhancement is checked separately, and there is a test asserting the
 * no-JS path still passes with the enhancement present, so enhancement cannot
 * quietly become dependency.
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

interface Board {
  slug: string
  tentId: string
  chairsId: string
}

/**
 * A fresh client address per browser context.
 *
 * Claiming is limited per address (M2-04), and every test in this file
 * otherwise looks like the same person: the suite trips its own limit after
 * twenty claims and later tests fail for a reason that has nothing to do with
 * what they are checking. The same trap as M1-06 §5 — `cf-connecting-ip` is
 * what the application trusts first, because Cloudflare sets it and strips any
 * copy the client sent.
 */
function freshAddress(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return { 'cf-connecting-ip': `203.0.${String(octet())}.${String(octet())}` }
}

/** A published funeral with one indivisible item and one divisible one. */
async function seedBoard(): Promise<Board> {
  const prisma = prismaClient()
  const slug = `claim${Math.random().toString(36).slice(2, 13)}`
    .padEnd(16, '0')
    .slice(0, 16)

  try {
    const organiser = await prisma.organiser.upsert({
      where: { phoneE164: '+27820000399' },
      update: {},
      create: { phoneE164: '+27820000399', displayName: 'Nomsa Mthembu' },
    })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        refPrefix: 'CLM',
        refCode: generateCode(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        title: 'Nokuthula Mthembu',
        status: 'published',
        visibilityDefault: 'name_only',
      },
      select: { id: true },
    })

    const tent = await prisma.needItem.create({
      data: {
        eventId: event.id,
        label: 'Tent',
        note: 'Around R1 200 to hire',
        quantityRequired: 1,
        sortOrder: 0,
      },
      select: { id: true },
    })

    const chairs = await prisma.needItem.create({
      data: {
        eventId: event.id,
        label: 'Chairs',
        note: '100 chairs',
        quantityRequired: 100,
        sortOrder: 1,
      },
      select: { id: true },
    })

    return { slug, tentId: tent.id, chairsId: chairs.id }
  } finally {
    await prisma.$disconnect()
  }
}

async function claimTent(page: Page, board: Board, name: string): Promise<void> {
  await page.setExtraHTTPHeaders(freshAddress())
  await page.goto(`/e/${board.slug}`)
  await page.locator(`[data-item="${board.tentId}"] input[name="name"]`).fill(name)
  await page.locator(`[data-item="${board.tentId}"] [data-claim-button]`).click()
}

test('claims with JavaScript disabled', async ({ browser }) => {
  // The path a borrowed phone with a broken script takes, and the one rule 5
  // has always required.
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()
  const board = await seedBoard()

  await claimTent(page, board, 'Thandi Ngcobo')

  await expect(page.getByText("You've claimed the tent")).toBeVisible()
  await expect(page).toHaveURL(/claim=claimed/)

  // And the board now says so to everybody else.
  const other = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const onlooker = await other.newPage()
  await onlooker.goto(`/e/${board.slug}`)
  await expect(
    onlooker.locator(`[data-item="${board.tentId}"]`).getByText('All of this is taken'),
  ).toBeVisible()

  await context.close()
  await other.close()
})

test('claims with the enhancement, and the enhancement is present', async ({ page }) => {
  const board = await seedBoard()
  await page.setExtraHTTPHeaders(freshAddress())

  await page.goto(`/e/${board.slug}`)
  // The enhancement announces itself, so this test cannot pass by accident on a
  // page where the script failed to load.
  await expect(page.locator('html')).toHaveAttribute('data-enhanced', 'needs-board')

  await page.locator(`[data-item="${board.tentId}"] input[name="name"]`).fill('Thandi')
  await page.locator(`[data-item="${board.tentId}"] [data-claim-button]`).click()

  await expect(page.getByText("You've claimed the tent")).toBeVisible()
})

test('the no-JS path still works with the enhancement shipped', async ({ browser }) => {
  // The assertion that stops enhancement becoming dependency. If the board ever
  // starts needing the script, this is what fails.
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()
  const board = await seedBoard()

  await page.goto(`/e/${board.slug}`)
  await expect(page.locator('script[src="/needs-board.js"]')).toHaveCount(1)

  await claimTent(page, board, 'Sipho')
  await expect(page.getByText("You've claimed the tent")).toBeVisible()

  await context.close()
})

test('a second claimant sees the conflict branch, not a false success', async ({
  browser,
}) => {
  const board = await seedBoard()

  const first = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const second = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const pageOne = await first.newPage()
  const pageTwo = await second.newPage()

  await pageOne.goto(`/e/${board.slug}`)
  await pageTwo.goto(`/e/${board.slug}`)

  // Both have the form open. Both submit.
  await pageOne.locator(`[data-item="${board.tentId}"] input[name="name"]`).fill('Thandi')
  await pageTwo.locator(`[data-item="${board.tentId}"] input[name="name"]`).fill('Sipho')

  await Promise.all([
    pageOne.locator(`[data-item="${board.tentId}"] [data-claim-button]`).click(),
    pageTwo.locator(`[data-item="${board.tentId}"] [data-claim-button]`).click(),
  ])

  // Both land on the event page carrying their outcome. Waiting for that
  // rather than polling visibility: a click resolves when it is dispatched,
  // not when the answer has come back, and asserting in between would test the
  // timing of the test rather than the behaviour of the board.
  await Promise.all([pageOne.waitForURL(/claim=/), pageTwo.waitForURL(/claim=/)])

  const urls = [pageOne.url(), pageTwo.url()]
  const successes = urls.filter((url) => url.includes('claim=claimed')).length
  const conflicts = urls.filter((url) => url.includes('claim=conflict')).length

  // And the page says the same thing the URL does.
  const winner = urls[0]?.includes('claim=claimed') ? pageOne : pageTwo
  const loser = winner === pageOne ? pageTwo : pageOne
  await expect(winner.getByText("You've claimed the tent")).toBeVisible()
  await expect(loser.getByText('Somebody else got the tent first')).toBeVisible()

  // Exactly one tent, exactly one winner. Rule 5.
  expect(successes).toBe(1)
  expect(conflicts).toBe(1)

  await first.close()
  await second.close()
})

test('the API answers 409 to the caller that asked for JSON', async ({ request }) => {
  const board = await seedBoard()

  const form = () => {
    const body = new URLSearchParams()
    body.set('slug', board.slug)
    body.set('item', board.tentId)
    body.set('quantity', '1')
    body.set('name', 'Thandi')
    return body.toString()
  }

  const headers = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    'sec-fetch-site': 'same-origin',
    ...freshAddress(),
  }

  const first = await request.post('/api/claim', { headers, data: form() })
  expect(first.status()).toBe(200)

  // Part C.5: 409 drives the conflict branch. That is the JSON path; a browser
  // form post gets a 303 so a refresh cannot claim a second tent.
  const second = await request.post('/api/claim', { headers, data: form() })
  expect(second.status()).toBe(409)
})

test('a browser form post is redirected, so refreshing does not claim twice', async ({
  request,
}) => {
  const board = await seedBoard()

  const response = await request.post('/api/claim', {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
      ...freshAddress(),
    },
    data: new URLSearchParams({
      slug: board.slug,
      item: board.tentId,
      quantity: '1',
      name: 'Thandi',
    }).toString(),
    maxRedirects: 0,
  })

  expect(response.status()).toBe(303)
  expect(response.headers()['location']).toContain(`/e/${board.slug}?claim=claimed`)
})

test('refuses a claim posted from another site', async ({ request }) => {
  const board = await seedBoard()

  // No session and no token on this endpoint, so this check is what stops a
  // stranger's page holding a chair on somebody's funeral.
  const response = await request.post('/api/claim', {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'cross-site',
      accept: 'application/json',
      ...freshAddress(),
    },
    data: new URLSearchParams({
      slug: board.slug,
      item: board.tentId,
      quantity: '1',
      name: 'Somebody else',
    }).toString(),
  })

  expect(response.status()).toBe(403)
})

test('undoes within the window, and only for the browser that claimed', async ({
  browser,
}) => {
  const board = await seedBoard()
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()

  await claimTent(page, board, 'Thandi')
  await expect(page.getByText("You've claimed the tent")).toBeVisible()

  // Somebody else's browser is offered nothing, even on the same URL.
  const stranger = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const strangerPage = await stranger.newPage()
  await strangerPage.goto(page.url())
  await expect(strangerPage.getByRole('button', { name: /Undo/ })).toHaveCount(0)

  await page.getByRole('button', { name: /Undo/ }).click()
  await expect(page.getByText('Put back on the list')).toBeVisible()

  // And the tent is available again.
  await page.goto(`/e/${board.slug}`)
  await expect(
    page.locator(`[data-item="${board.tentId}"] [data-claim-button]`),
  ).toBeVisible()

  await context.close()
  await stranger.close()
})

test('a claim confirmation is never cached for the next visitor', async ({ browser }) => {
  const board = await seedBoard()
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()

  await claimTent(page, board, 'Thandi')

  const response = await page.goto(page.url())
  expect(response?.headers()['cache-control']).toContain('no-store')

  // The same browser keeps getting no-store while it still holds an undo
  // capability — the board it sees has a button nobody else has.
  const stillPersonal = await page.goto(`/e/${board.slug}`)
  expect(stillPersonal?.headers()['cache-control']).toContain('no-store')

  // A browser that claimed nothing gets the ordinary cacheable page.
  const onlooker = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const onlookerPage = await onlooker.newPage()
  const plain = await onlookerPage.goto(`/e/${board.slug}`)
  expect(plain?.headers()['cache-control']).toContain('s-maxage')
  await onlooker.close()
})

test('is reachable and operable from the keyboard alone', async ({ page }) => {
  const board = await seedBoard()
  await page.setExtraHTTPHeaders(freshAddress())
  await page.goto(`/e/${board.slug}`)

  const name = page.locator(`[data-item="${board.tentId}"] input[name="name"]`)
  await name.focus()
  await page.keyboard.type('Thandi Ngcobo')

  /*
   * Tab to the button and press it. No pointer anywhere in this test.
   *
   * **Tabs until it arrives rather than a fixed number of times.** M4-02b added
   * a message field and a photograph between the name and the button, and a
   * one-press version of this failed — correctly, but for a reason that was
   * about the count and not about the keyboard. What matters is that the button
   * is reachable from the name without touching anything, however many fields
   * are between them; a bound of ten is what catches a focus trap.
   */
  let focused: string | null = null

  for (let press = 0; press < 10 && focused === null; press += 1) {
    await page.keyboard.press('Tab')
    focused = await page.evaluate(
      () => document.activeElement?.getAttribute('data-claim-button') ?? null,
    )
  }

  expect(focused, 'the claim button was not reachable by tabbing').not.toBeNull()

  await page.keyboard.press('Enter')
  await expect(page.getByText("You've claimed the tent")).toBeVisible()
})

test('takes part of a divisible item and leaves the rest', async ({ page }) => {
  const board = await seedBoard()
  await page.setExtraHTTPHeaders(freshAddress())
  await page.goto(`/e/${board.slug}`)

  const chairs = page.locator(`[data-item="${board.chairsId}"]`)
  await chairs.locator('input[name="quantity"]').fill('40')
  await chairs.locator('input[name="name"]').fill('Thandi')
  await chairs.locator('[data-claim-button]').click()

  await expect(page.getByText("You've claimed the chairs")).toBeVisible()

  await page.goto(`/e/${board.slug}`)
  await expect(
    page.locator(`[data-item="${board.chairsId}"]`).getByText('60 of 100 still needed'),
  ).toBeVisible()
})

test('has no axe violations with the board on the page', async ({ page }) => {
  const board = await seedBoard()
  await page.goto(`/e/${board.slug}`)

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test('the enhancement stays small', async ({ page }) => {
  const board = await seedBoard()
  await page.goto(`/e/${board.slug}`)

  // The criterion is ≤20KB added to the page. This is the whole of it.
  const source = readFileSync('public/needs-board.js')
  const transferred = gzipSync(source).byteLength

  expect(transferred).toBeLessThan(20 * 1024)
  // And it is nowhere near a framework, which is the point.
  expect(transferred).toBeLessThan(4 * 1024)
})
