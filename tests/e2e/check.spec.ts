import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'

/**
 * *"Is this real?"* end to end — M3-04's two done-criteria and the route it
 * points at (M3-05, built with it).
 *
 * **The panel is on every event page**, including the contribution flow, which
 * is where somebody is looking at a number they are about to pay.
 *
 * **`/check` is reachable without following a link from the event page** — the
 * entire point of it — so the tests type the address rather than clicking
 * through, which is also what the copy tells a person to do.
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

const slugFor = (tag: string) =>
  `${tag}${Math.random().toString(36).slice(2)}`.padEnd(16, '0').slice(0, 16)

function code(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)] ?? '0',
  ).join('')
}

/** A published funeral with a verified organiser, which is the only publishable kind. */
async function seed({
  slug,
  status = 'published',
}: {
  slug: string
  status?: 'draft' | 'published'
}): Promise<string> {
  const prisma = prismaClient()

  try {
    const organiser = await prisma.organiser.create({
      data: {
        phoneE164: `+2786${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
        displayName: 'Nomsa Mthembu',
        idVerificationStatus: 'verified',
        idVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
      },
    })

    const refCode = code()

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'MTH',
        refCode,
        title: 'Nokuthula Mthembu',
        subtitle: 'uMaZondi',
        place: 'KwaMashu, KwaZulu-Natal',
        eventDate: new Date('2026-08-15T00:00:00.000Z'),
        status,
        visibilityDefault: 'name_only',
      },
      select: { id: true },
    })

    await prisma.needItem.create({
      data: { eventId: event.id, label: 'Tent', note: 'Around R1 200', sortOrder: 0 },
    })

    return `MTH-${refCode}`
  } finally {
    await prisma.$disconnect()
  }
}

async function panelOn(page: Page): Promise<void> {
  await expect(
    page.getByText(
      'Do not use a number on this page. If the page were fake, the number would be too.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'isipheko.co.za/check' })).toBeVisible()
}

test('the panel is on the event page, and says what a check does not cover', async ({
  page,
}) => {
  const slug = slugFor('trust')
  const reference = await seed({ slug })

  await page.goto(`/e/${slug}`)

  await expect(page.getByRole('heading', { name: 'Is this real?' })).toBeVisible()
  await panelOn(page)
  await expect(
    page.getByText('It confirms who the organiser is. It does not, on its own'),
  ).toBeVisible()
  await expect(page.getByText(reference)).toBeVisible()

  // Not an alarm: no alert role anywhere in the panel, on a page where nothing
  // is wrong.
  await expect(page.locator('.trust [role="alert"]')).toHaveCount(0)
})

test('the panel travels into the contribution flow', async ({ page }) => {
  const slug = slugFor('flow')
  await seed({ slug })

  await page.goto(`/e/${slug}/contribute`)
  await expect(page.getByText('Not sure this is real?')).toBeVisible()
  await panelOn(page)

  // And the badge comes with it — this is the screen where it counts.
  await expect(page.getByText('ID verified 12 August')).toBeVisible()
})

test('/check answers a code typed straight into the browser', async ({ page }) => {
  const slug = slugFor('code')
  const reference = await seed({ slug })

  // Typed, not followed. An answer only reachable from the page being checked
  // would be no answer at all.
  await page.goto('/check')
  await expect(page.getByRole('heading', { name: 'Check an umcimbi' })).toBeVisible()

  await page.getByLabel('The code from the page').fill(reference)
  await page.getByRole('button', { name: 'Check it' }).click()

  await expect(page.getByText('This is a real umcimbi on Isipheko')).toBeVisible()
  await expect(page.getByText('Nokuthula Mthembu')).toBeVisible()
  await expect(
    page.getByText('their South African ID was checked against the Home Affairs record'),
  ).toBeVisible()

  // Nothing the public page does not show, and no way through to it.
  await expect(page.locator('body')).not.toContainText('Tent')
  await expect(page.locator('body')).not.toContainText('+2786')
  await expect(page.locator(`a[href*="/e/"]`)).toHaveCount(0)
})

test('/check takes the whole link somebody was sent', async ({ page, baseURL }) => {
  const slug = slugFor('link')
  await seed({ slug })

  await page.goto('/check')
  await page.getByLabel('The code from the page').fill(`${baseURL ?? ''}/e/${slug}`)
  await page.getByRole('button', { name: 'Check it' }).click()

  await expect(page.getByText('This is a real umcimbi on Isipheko')).toBeVisible()
})

test('a wrong code and a page nobody has shared answer the same way', async ({
  page,
}) => {
  const draftSlug = slugFor('draft')
  const draftReference = await seed({ slug: draftSlug, status: 'draft' })

  await page.goto(`/check?code=${encodeURIComponent('MTH-ZZZZZZ')}`)
  await expect(page.getByText('Nothing here matches that')).toBeVisible()

  // The draft is the point: a lookup that said "not published yet" would be the
  // one way to discover a page a family has not shared.
  await page.goto(`/check?code=${encodeURIComponent(draftReference)}`)
  await expect(page.getByText('Nothing here matches that')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Nokuthula')
})

test('/check works with JavaScript disabled', async ({ browser }) => {
  const slug = slugFor('nojs')
  const reference = await seed({ slug })

  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  try {
    await page.goto('/check')
    await page.getByLabel('The code from the page').fill(reference)
    await page.getByRole('button', { name: 'Check it' }).click()

    await expect(page.getByText('This is a real umcimbi on Isipheko')).toBeVisible()
    // A GET, so the answer has a URL somebody can re-open and compare.
    await expect(page).toHaveURL(/\/check\?code=/)
  } finally {
    await context.close()
  }
})

test('/check is not indexed, and not cached by anybody', async ({ request }) => {
  const response = await request.get('/check')

  expect(response.headers()['x-robots-tag']).toContain('noindex')
  expect(response.headers()['cache-control']).toContain('no-store')
})

test('/check has no accessibility violations, asking or answered', async ({ page }) => {
  const slug = slugFor('axe')
  const reference = await seed({ slug })

  await page.goto('/check')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await page.goto(`/check?code=${encodeURIComponent(reference)}`)
  await expect(page.getByText('This is a real umcimbi on Isipheko')).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})
