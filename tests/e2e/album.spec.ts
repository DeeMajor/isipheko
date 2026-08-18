import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import sharp from 'sharp'

import { PrismaClient } from '@/db/generated/client'
import { appendEntry } from '@/db/repositories/ledger'
import { fromCents } from '@/domain/money'
import { generateCode } from '@/domain/reference'

/**
 * The album, in a browser, **with JavaScript switched off**.
 *
 * Both of M4-02's done-criteria are here: it renders at one entry and at four
 * hundred, and the photos below the fold lazy-load — which needs no script,
 * because `loading="lazy"` is the browser's and the space each image will take
 * is already reserved by its width and height.
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

function freshAddress(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return { 'cf-connecting-ip': `198.20.${String(octet())}.${String(octet())}` }
}

interface Fixture {
  slug: string
  eventId: string
  organiserPhone: string
}

async function seedEvent(): Promise<Fixture> {
  const prisma = prismaClient()
  const slug = `book${Math.random().toString(36).slice(2, 14)}`
    .padEnd(16, '0')
    .slice(0, 16)
  const organiserPhone = `083${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`

  try {
    const organiser = await prisma.organiser.create({
      data: {
        phoneE164: `+27${organiserPhone.slice(1)}`,
        displayName: 'Nomsa Mthembu',
        idVerificationStatus: 'verified',
        idVerifiedAt: new Date(),
      },
    })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        refPrefix: 'BOK',
        refCode: generateCode(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        title: 'Nokuthula Mthembu',
        status: 'published',
        visibilityDefault: 'name_only',
        directPayDetails: { phone: '082 123 4567', name: 'N. Mthembu' },
      },
      select: { id: true },
    })

    return { slug, eventId: event.id, organiserPhone }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Entries straight onto the chain.
 *
 * The full Mode A path is exercised by the first test; four hundred of it would
 * be four hundred browser round-trips to prove something about a render.
 */
async function seedEntries(eventId: string, count: number): Promise<void> {
  const prisma = prismaClient()

  try {
    for (let index = 0; index < count; index += 1) {
      const inKind = index % 4 === 0
      const cents = BigInt(5_000 + index * 900)

      const contribution = await prisma.contribution.create({
        data: {
          eventId,
          contributorName: 'Nomusa Ngcobo',
          type: inKind ? 'in_kind' : 'cash',
          amountCents: inKind ? null : cents,
          visibility: 'name_only',
          verificationSource: 'organiser_confirmed',
          status: 'confirmed',
          confirmedAt: new Date(),
          message: index % 3 === 0 ? 'Sisemuva kwenu.' : null,
        },
        select: { id: true },
      })

      await appendEntry(prisma, {
        chain: { eventId },
        entryType: 'contribution',
        direction: 'credit',
        amountCents: inKind ? null : fromCents(cents),
        inKindDescription: inKind ? 'Chairs × 10' : null,
        referenceId: contribution.id,
        contributionId: contribution.id,
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

/** A photo off a phone, with the family's house inside the file. */
async function phonePhoto(): Promise<Buffer> {
  return sharp({
    create: { width: 1400, height: 900, channels: 3, background: '#4A7C59' },
  })
    .withExif({
      IFD0: { Make: 'Apple' },
      IFD3: {
        GPSLatitudeRef: 'S',
        GPSLatitude: '29/1 51/1 3600/1000',
        GPSLongitudeRef: 'E',
        GPSLongitude: '31/1 1/1 7200/1000',
      },
    })
    .jpeg()
    .toBuffer()
}

async function signInOrganiser(page: Page, phone: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(phone)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  // The code is only in the outbox once the challenge exists; asking earlier
  // reads an empty one and fills the field with nothing.
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()

  const response = await page.request.get(
    `/dev/sms?phone=${encodeURIComponent(`+27${phone.slice(1)}`)}`,
  )
  const { body } = (await response.json()) as { body: string }

  await page.getByLabel('The six-digit code').fill(/\b(\d{6})\b/.exec(body)?.[1] ?? '')
  await page.getByRole('button', { name: 'Sign me in' }).click()
  await expect(page).toHaveURL(/\/account$/)
}

test('a message and a photo reach the album once the family confirms', async ({
  browser,
}) => {
  const fixture = await seedEvent()

  const visitor = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await visitor.newPage()

  await page.goto(`/e/${fixture.slug}/contribute`)
  await page.getByRole('button', { name: 'Stand with them money', exact: true }).click()
  await page.getByLabel('Amount').fill('R450,00')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByLabel('Your name').fill('Thandi Ngcobo')
  await page.getByLabel('A message for the family (optional)').fill('Sisemuva kwenu.')
  await page.setInputFiles('input[name="photo"]', {
    name: 'IMG_4821.jpg',
    mimeType: 'image/jpeg',
    buffer: await phonePhoto(),
  })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: "I've paid" }).click()
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()

  /*
   * The done screen must not claim the record already holds them. It does not:
   * a ledger entry is written when the organiser confirms, and both the strand
   * and the album read the chain.
   */
  await expect(page.getByText('It joins the record when they confirm it.')).toBeVisible()

  // Before confirmation the album holds nothing, and the event page offers no
  // link to it — an empty album is not a thing to invite somebody into.
  const empty = await page.request.get(`/e/${fixture.slug}/album`)
  expect(empty.status()).toBe(200)
  expect(await empty.text()).not.toContain('class="entry"')

  const eventPage = await page.request.get(`/e/${fixture.slug}`)
  expect(await eventPage.text()).not.toContain('The whole record')

  // The organiser, elsewhere, confirming against her own bank notification.
  const organiser = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const organiserPage = await organiser.newPage()
  await signInOrganiser(organiserPage, fixture.organiserPhone)
  await organiserPage.goto(`/manage/${fixture.eventId}`)
  await organiserPage.getByRole('button', { name: "Yes, it's in my account" }).click()
  await expect(organiserPage.getByText('Recorded on the ledger.')).toBeVisible()

  // And now it is in the record.
  await page.goto(`/e/${fixture.slug}/album`)

  // The name is on the cover's bead and on the entry — which is the point of
  // the cover, so the assertion names the entry rather than dodging the pair.
  await expect(page.locator('.entryName')).toHaveText('Thandi Ngcobo')
  await expect(page.locator('.entryMessage')).toHaveText('Sisemuva kwenu.')

  const image = page.locator('img.entryPhoto')
  await expect(image).toHaveAttribute('loading', 'lazy')
  await expect(image).toHaveAttribute('width', /\d+/)
  await expect(image).toHaveAttribute('height', /\d+/)

  const src = await image.getAttribute('src')
  const avif = await page
    .locator('source[type="image/avif"]')
    .first()
    .getAttribute('srcSet')

  expect(src).toContain('-full.webp')
  expect(avif).toContain('-full.avif')

  const served = await page.request.get(avif ?? '')
  expect(served.status()).toBe(200)
  expect(served.headers()['content-type']).toBe('image/avif')

  // The cover's bead points at the entry, on the same page.
  const bead = page.locator('a.beadLink').first()
  const href = await bead.getAttribute('href')
  expect(href).toMatch(/^#entry-/)
  await expect(page.locator(href ?? '')).toBeVisible()

  // And the event page now offers the way in.
  await page.goto(`/e/${fixture.slug}`)
  await expect(page.getByRole('link', { name: 'The whole record' })).toBeVisible()

  await visitor.close()
  await organiser.close()
})

test('renders four hundred entries with no JavaScript, lazily', async ({ browser }) => {
  test.setTimeout(180_000)

  const fixture = await seedEvent()
  await seedEntries(fixture.eventId, 400)

  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()

  await page.goto(`/e/${fixture.slug}/album`)

  await expect(page.locator('li.entry')).toHaveCount(400)
  // Every bead on the cover has somewhere to go, on the page it is already on.
  await expect(page.locator('a.beadLink')).toHaveCount(400)

  // No script anywhere on this route: the album is static markup from a route
  // handler, and the framework runtime M1-08 measured must not come back.
  expect(await page.locator('script').count()).toBe(0)

  // The record, and nothing that counts it.
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  expect(text).not.toMatch(/\b400\b/)
  expect(text).not.toMatch(/R\s?\d/)

  await context.close()
})

test('the album has no accessibility violations, at one entry and at four hundred', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const small = await seedEvent()
  await seedEntries(small.eventId, 1)

  const large = await seedEvent()
  await seedEntries(large.eventId, 400)

  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  for (const fixture of [small, large]) {
    await page.goto(`/e/${fixture.slug}/album`)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  }

  await context.close()
})
