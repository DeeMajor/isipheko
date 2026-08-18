import { expect, test, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import sharp from 'sharp'

import { PrismaClient } from '@/db/generated/client'
import { findGpsFix, scanImageMetadata } from '@/domain/media'
import { generateCode } from '@/domain/reference'

/**
 * A photo attached to a contribution, in a browser, **with JavaScript off**.
 *
 * There is no upload widget and nothing that fails separately: the file travels
 * in the same plain form submit as the name, because a contributor may be on a
 * borrowed phone with a script bundle that never arrived.
 *
 * The fixture is a JPEG with a real GPS fix in it, and the assertions run over
 * the bytes the server actually serves back.
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
  return { 'cf-connecting-ip': `198.19.${String(octet())}.${String(octet())}` }
}

async function seedEvent(): Promise<{ slug: string; eventId: string }> {
  const prisma = prismaClient()
  const slug = `snap${Math.random().toString(36).slice(2, 14)}`
    .padEnd(16, '0')
    .slice(0, 16)

  try {
    const organiser = await prisma.organiser.create({
      data: {
        phoneE164: `+2782${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
        displayName: 'Nomsa Mthembu',
      },
    })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        refPrefix: 'SNP',
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

    return { slug, eventId: event.id }
  } finally {
    await prisma.$disconnect()
  }
}

/** A photo off a phone: the family's house is inside the file. */
async function phonePhoto(): Promise<Buffer> {
  return sharp({
    create: { width: 1400, height: 900, channels: 3, background: '#4A7C59' },
  })
    .withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 13' },
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

/** Money route as far as the who step. */
async function walkToWhoStep(page: Page, slug: string): Promise<void> {
  await page.goto(`/e/${slug}/contribute`)
  await page.getByRole('button', { name: 'Stand with them money', exact: true }).click()
  await page.getByLabel('Amount').fill('R450,00')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: /Who should we say/ })).toBeVisible()
}

test('a photo travels with the contribution and arrives without the address', async ({
  browser,
}) => {
  const { slug } = await seedEvent()
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()

  await walkToWhoStep(page, slug)

  // What the page tells somebody before they attach anything: what is taken
  // out, and what that protects.
  await expect(page.getByText(/Phones save the place a photo was taken/)).toBeVisible()

  await page.getByLabel('Your name').fill('Thandi Ngcobo')
  await page.setInputFiles('input[name="photo"]', {
    name: 'IMG_4821.jpg',
    mimeType: 'image/jpeg',
    buffer: await phonePhoto(),
  })
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(
    page.getByRole('heading', { name: 'Pay from your banking app' }),
  ).toBeVisible()

  await page.getByRole('button', { name: "I've paid" }).click()
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()
  await expect(page.getByText('Your photo is on the record.')).toBeVisible()

  /*
   * AVIF with a WebP fallback, chosen by the markup. Each URL names exactly one
   * representation, so nothing depends on a cache understanding `Vary`.
   */
  const avifUrl = await page.locator('source[type="image/avif"]').getAttribute('srcset')
  const webpUrl = await page.locator('picture img').getAttribute('src')

  expect(avifUrl).toMatch(/^\/e\/.+\/photo\/[0-9a-f]{32}-thumb\.avif$/)
  expect(webpUrl).toMatch(/^\/e\/.+\/photo\/[0-9a-f]{32}-thumb\.webp$/)

  const avif = await page.request.get(avifUrl ?? '')
  const webp = await page.request.get(webpUrl ?? '')

  expect(avif.status()).toBe(200)
  expect(avif.headers()['content-type']).toBe('image/avif')
  expect(avif.headers()['cache-control']).toContain('immutable')
  expect(webp.status()).toBe(200)
  expect(webp.headers()['content-type']).toBe('image/webp')

  const avifBytes = new Uint8Array(await avif.body())
  const webpBytes = new Uint8Array(await webp.body())

  // Really those formats, not a JPEG with a new name.
  expect(Buffer.from(avifBytes.slice(4, 12)).toString('latin1')).toBe('ftypavif')
  expect(Buffer.from(webpBytes.slice(0, 4)).toString('latin1')).toBe('RIFF')
  expect(Buffer.from(webpBytes.slice(8, 12)).toString('latin1')).toBe('WEBP')

  // And neither of them knows where it was taken.
  for (const bytes of [avifBytes, webpBytes]) {
    expect(scanImageMetadata(bytes)).toEqual([])
    expect(findGpsFix(bytes)).toBeNull()
  }

  // The full size is served too, and is just as clean.
  const full = await page.request.get((avifUrl ?? '').replace('-thumb.', '-full.'))
  expect(full.status()).toBe(200)
  expect(scanImageMetadata(new Uint8Array(await full.body()))).toEqual([])

  await context.close()
})

test('a file that is not a photo is refused however it is named', async ({ browser }) => {
  const { slug } = await seedEvent()
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()

  await walkToWhoStep(page, slug)
  await page.getByLabel('Your name').fill('Thandi Ngcobo')
  await page.setInputFiles('input[name="photo"]', {
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
  })
  await page.getByRole('button', { name: 'Continue' }).click()

  // Still on the who step, told what works — and holding onto what was typed,
  // because losing a name over a photo would be its own small insult.
  await expect(page.getByRole('heading', { name: /Who should we say/ })).toBeVisible()
  await expect(page.getByText('JPEG, PNG and WebP work.')).toBeVisible()
  await expect(page.getByLabel('Your name')).toHaveValue('Thandi Ngcobo')
})

test('an oversized photo is refused and the rest of the flow survives it', async ({
  browser,
}) => {
  const { slug } = await seedEvent()
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()

  await walkToWhoStep(page, slug)
  await page.getByLabel('Your name').fill('Thandi Ngcobo')
  await page.getByLabel('A message for the family (optional)').fill('Sisemuva kwenu.')

  const oversized = Buffer.alloc(9 * 1024 * 1024)
  oversized.set([0xff, 0xd8, 0xff])

  await page.setInputFiles('input[name="photo"]', {
    name: 'IMG_4822.jpg',
    mimeType: 'image/jpeg',
    buffer: oversized,
  })
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText(/That photo is over 8MB/)).toBeVisible()
  await expect(page.getByLabel('Your name')).toHaveValue('Thandi Ngcobo')
  await expect(page.getByLabel('A message for the family (optional)')).toHaveValue(
    'Sisemuva kwenu.',
  )

  // And they can carry on without it, which is what the message says.
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { name: 'Pay from your banking app' }),
  ).toBeVisible()
})

test('a body past the ceiling is refused without being read', async ({ browser }) => {
  const { slug } = await seedEvent()
  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  /*
   * Above the body ceiling there is nothing worth preserving, so the request is
   * refused on its `content-length` before a byte of it is buffered. Between
   * this and the 8MB photo cap is where a genuinely large photo lands, and that
   * case keeps the whole flow's state — the test above.
   */
  const response = await page.request.post(`/e/${slug}/contribute`, {
    headers: { referer: `http://localhost:3100/e/${slug}/contribute` },
    multipart: {
      route: 'money',
      step: 'who',
      name: 'Thandi Ngcobo',
      photo: {
        name: 'huge.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.alloc(25 * 1024 * 1024),
      },
    },
  })

  expect(response.status()).toBe(413)
  expect(await response.text()).toContain('That was too large to send')
})
