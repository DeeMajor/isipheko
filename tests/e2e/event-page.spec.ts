import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'
import { generateCode } from '@/domain/reference'

/**
 * The public event page.
 *
 * It is served as static HTML from a route handler rather than an App Router
 * page, because the page shipped 199KB of first load against a 150KB ceiling —
 * see docs/decisions.md M1-08. Several tests here are about that being *still*
 * true, not about it having been true once.
 *
 * Fixtures are written straight to the database. Walking the six setup steps
 * for every case would test M1-07 again and make this file slow enough that
 * somebody skips it.
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

function slugFor(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}${random}`.padEnd(16, '0').slice(0, 16)
}

/**
 * `verified` defaults to true because since M3-02 a published event cannot
 * exist without a verified organiser — a fixture that left it off would be
 * measuring a page the product can no longer produce.
 *
 * The unverified organiser is a separate person, on their own number, so the
 * two fixtures cannot fight over one row.
 */
async function seedEvent({
  slug,
  status,
  archetype = 'umngcwabo',
  verified = true,
}: {
  slug: string
  status: 'draft' | 'published'
  archetype?: 'umngcwabo' | 'umshado'
  verified?: boolean
}): Promise<void> {
  const prisma = prismaClient()
  try {
    const identity = verified
      ? {
          idVerificationStatus: 'verified' as const,
          idVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
        }
      : { idVerificationStatus: 'unverified' as const, idVerifiedAt: null }

    const phoneE164 = verified ? '+27820000299' : '+27820000298'

    const organiser = await prisma.organiser.upsert({
      where: { phoneE164 },
      update: identity,
      create: { phoneE164, displayName: 'Nomsa Mthembu', ...identity },
    })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        archetype,
        archetypeGroup: archetype === 'umngcwabo' ? 'bereavement' : 'union',
        refPrefix: 'TST',
        refCode: generateCode(),
        title: archetype === 'umngcwabo' ? 'Nokuthula Mthembu' : 'Lindiwe & Sipho',
        subtitle: archetype === 'umngcwabo' ? 'uMaZondi' : null,
        place: 'KwaMashu, KwaZulu-Natal',
        eventDate: new Date('2026-08-15T00:00:00.000Z'),
        status,
        visibilityDefault: archetype === 'umngcwabo' ? 'name_only' : 'public',
      },
      select: { id: true },
    })

    await prisma.needItem.createMany({
      data: [
        { eventId: event.id, label: 'Tent', note: 'Around R1 200 to hire', sortOrder: 0 },
        { eventId: event.id, label: 'Chairs', note: '100 chairs', sortOrder: 1 },
        {
          eventId: event.id,
          label: 'Groceries',
          note: 'Mealie meal, rice, sugar, oil',
          sortOrder: 2,
        },
      ],
    })
  } finally {
    await prisma.$disconnect()
  }
}

test('renders the event, the needs board and the trust panel', async ({ page }) => {
  const slug = slugFor('pub')
  await seedEvent({ slug, status: 'published' })

  await page.goto(`/e/${slug}`)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nokuthula Mthembu')
  await expect(page.getByText('uMaZondi')).toBeVisible()
  await expect(page.getByText('Organised by Nomsa Mthembu')).toBeVisible()

  await expect(page.getByRole('heading', { name: "What's needed" })).toBeVisible()
  await expect(page.getByText('Mealie meal, rice, sugar, oil')).toBeVisible()

  await expect(page.getByRole('heading', { name: 'Is this real?' })).toBeVisible()
  // The verification instruction never points back at the page being verified.
  await expect(page.getByText('Do not use a number on this page')).toBeVisible()
  await expect(page.getByText('isipheko.co.za/check')).toBeVisible()
})

test('carries the badge above the fold, with the date on it', async ({ page }) => {
  const slug = slugFor('bdg')
  await seedEvent({ slug, status: 'published' })

  await page.goto(`/e/${slug}`)

  // Above the fold means inside the header, beside the name it belongs to —
  // not somewhere further down the page a contributor may never reach.
  const badge = page.locator('header .verified')
  await expect(badge).toBeVisible()
  await expect(badge).toContainText('ID verified 12 August')
  await expect(badge).toHaveAttribute(
    'aria-label',
    "Nomsa Mthembu's identity was verified on 12 August",
  )

  // And the trust panel states it in full, with the limit of what it means.
  await expect(
    page.getByText('was checked against the Home Affairs record'),
  ).toBeVisible()
  await expect(
    page.getByText('It confirms who the organiser is. It does not, on its own'),
  ).toBeVisible()

  // The page no longer says nobody has been checked, because somebody has.
  await expect(page.locator('body')).not.toContainText('has not been verified yet')
  await expect(page.locator('body')).not.toContainText('Nothing yet')
})

test('says so plainly where nobody has been verified', async ({ page }) => {
  const slug = slugFor('unv')
  await seedEvent({ slug, status: 'published', verified: false })

  await page.goto(`/e/${slug}`)

  // Unreachable through the product since M3-02 — publishing requires the
  // check — and asserted anyway, because the page reads the live status rather
  // than assuming it. True or absent, never softened (M1-08 §5).
  await expect(page.getByText('has not been verified yet')).toBeVisible()
  await expect(page.locator('header .verified')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('ID verified')

  // And it does not describe a money path that is not built (Mode B, §15).
  await expect(page.locator('body')).not.toContainText('held Isipheko account')
})

test('ships no framework, and only the one small enhancement', async ({ page }) => {
  const slug = slugFor('njs')
  await seedEvent({ slug, status: 'published' })

  const scripts: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url())
  })

  await page.goto(`/e/${slug}`)

  // This route was zero-JS at M1-08, and the reason still holds: an App Router
  // page for the same content pulled 174KB of React and router. M2-04 added one
  // ~1.5KB enhancement for the claim flow, which the board works without —
  // tests/e2e/claim.spec.ts asserts the JavaScript-disabled path.
  //
  // So the assertion is not "no scripts" any more. It is "nothing but that one",
  // which is the thing that would actually regress.
  expect(scripts.map((url) => new URL(url).pathname)).toEqual(['/needs-board.js'])
  expect(await page.locator('script').count()).toBe(1)
})

test('inlines its CSS rather than linking it', async ({ page }) => {
  const slug = slugFor('css')
  await seedEvent({ slug, status: 'published' })

  await page.goto(`/e/${slug}`)

  // One round trip instead of two, on a connection where the round trip is
  // the expensive part.
  expect(await page.locator('link[rel="stylesheet"]').count()).toBe(0)
  expect(await page.locator('head style').count()).toBeGreaterThan(0)
})

test('tells crawlers not to index it, in the header as well as the document', async ({
  page,
}) => {
  const slug = slugFor('rob')
  await seedEvent({ slug, status: 'published' })

  const response = await page.goto(`/e/${slug}`)

  // A death in the family must not be findable on Google (§10). The meta tag
  // is for crawlers that parse the document; the header is for those that do
  // not get that far.
  expect(response?.headers()['x-robots-tag']).toContain('noindex')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('compresses the document', async ({ page }) => {
  const slug = slugFor('gzp')
  await seedEvent({ slug, status: 'published' })

  const response = await page.goto(`/e/${slug}`)
  const headers = response?.headers() ?? {}

  // Next does not compress a raw Response from a route handler, so the handler
  // does it. Ten uncompressed kilobytes is real money on a prepaid bundle.
  expect(headers['content-encoding']).toMatch(/br|gzip/)
  expect(headers['vary']).toContain('accept-encoding')
})

test('a draft answers 404', async ({ page }) => {
  const slug = slugFor('drf')
  await seedEvent({ slug, status: 'draft' })

  const response = await page.goto(`/e/${slug}`)

  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'That page is not here' })).toBeVisible()
  // The 404 says nothing about whether a page exists behind that slug.
  await expect(page.locator('body')).not.toContainText('Nokuthula')
})

test('a slug nobody was issued answers the same 404', async ({ page }) => {
  const response = await page.goto('/e/aaaaaaaaaaaaaaaa')

  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'That page is not here' })).toBeVisible()
})

test('a funeral declares no accent, so the fallback renders', async ({ page }) => {
  const slug = slugFor('ber')
  await seedEvent({ slug, status: 'published', archetype: 'umngcwabo' })

  await page.goto(`/e/${slug}`)

  const themed = page.locator('[data-archetype="umngcwabo"]')
  expect(await themed.getAttribute('style'), 'bereavement set an accent').toBeNull()
})

test('a wedding carries its accent from the config', async ({ page }) => {
  const slug = slugFor('wed')
  await seedEvent({ slug, status: 'published', archetype: 'umshado' })

  await page.goto(`/e/${slug}`)

  const themed = page.locator('[data-archetype="umshado"]')
  expect((await themed.getAttribute('style'))?.replace(/\s/g, '')).toContain(
    '--accent:#8C2F22',
  )
})

test('has no axe violations', async ({ page }) => {
  const slug = slugFor('axe')
  await seedEvent({ slug, status: 'published' })

  await page.goto(`/e/${slug}`)

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

/*
 * LCP on throttled 3G is measured by `pnpm gate:size`, not here.
 *
 * This suite runs against `pnpm dev`, where nothing is minified and every
 * module is compiled on demand — a paint time measured there says nothing about
 * what a contributor waits for. Part G is explicit: measure the production
 * build. The gate does, in the same run that measures the bytes.
 */
