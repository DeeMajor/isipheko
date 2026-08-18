import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'
import { generateCode } from '@/domain/reference'

/**
 * The link preview, against the running server.
 *
 * The criterion M2-07 cannot meet here is the one that matters most — *"renders
 * correctly in WhatsApp on iOS and Android"* — because WhatsApp's crawler
 * fetches from the internet and this server is on localhost. That check is a
 * device checklist in docs/decisions.md M2-07 and is **still open**.
 *
 * What is checked here is everything a machine can: that the tags exist and are
 * absolute, that the image is a 1200×630 PNG small enough for WhatsApp to
 * bother with, that a card is generated once rather than per request, and that
 * a changed title mints a new URL — which is the only way to make WhatsApp look
 * at a card again.
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

/** Where the local object store writes, until a bucket exists. */
const CACHE_ROOT =
  process.env.OBJECT_STORE_DIR ?? join(process.cwd(), '.cache', 'objects')

async function seedEvent({
  slug,
  status = 'published',
  archetype = 'umngcwabo',
  title = 'Nokuthula Mthembu',
  verified = true,
}: {
  slug: string
  status?: 'draft' | 'published'
  archetype?: 'umngcwabo' | 'umshado'
  title?: string
  /** Since M3-02 a published event cannot exist without one. */
  verified?: boolean
}): Promise<string> {
  const prisma = prismaClient()
  try {
    // A number per fixture: six workers upserting one row race each other, and
    // the loser fails for a reason that has nothing to do with link previews.
    const organiser = await prisma.organiser.create({
      data: {
        phoneE164: `+2782${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
        displayName: 'Nomsa Mthembu',
        ...(verified
          ? {
              idVerificationStatus: 'verified' as const,
              idVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
            }
          : {}),
      },
    })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        archetype,
        archetypeGroup: archetype === 'umngcwabo' ? 'bereavement' : 'union',
        refPrefix: 'TST',
        refCode: generateCode(),
        title,
        subtitle: 'uMaZondi',
        place: 'KwaMashu, KwaZulu-Natal',
        eventDate: new Date('2026-08-15T00:00:00.000Z'),
        status,
        visibilityDefault: archetype === 'umngcwabo' ? 'name_only' : 'public',
      },
      select: { id: true },
    })

    return event.id
  } finally {
    await prisma.$disconnect()
  }
}

async function retitle(eventId: string, title: string): Promise<void> {
  const prisma = prismaClient()
  try {
    await prisma.event.update({ where: { id: eventId }, data: { title } })
  } finally {
    await prisma.$disconnect()
  }
}

/** The PNG header carries its own dimensions. No image library needed. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function cardUrlOn(page: import('@playwright/test').Page, slug: string) {
  await page.goto(`/e/${slug}`)
  const url = await page.locator('meta[property="og:image"]').getAttribute('content')
  expect(url, 'the page carried no og:image').not.toBeNull()

  return url ?? ''
}

test('the page carries the tags WhatsApp reads', async ({ page, baseURL }) => {
  const slug = slugFor('ogt')
  await seedEvent({ slug })

  await page.goto(`/e/${slug}`)

  const content = async (selector: string) =>
    await page.locator(selector).getAttribute('content')

  expect(await content('meta[property="og:title"]')).toBe('Nokuthula Mthembu')
  expect(await content('meta[property="og:type"]')).toBe('website')
  expect(await content('meta[property="og:site_name"]')).toBe('Isipheko')
  expect(await content('meta[property="og:image:type"]')).toBe('image/png')
  expect(await content('meta[property="og:image:width"]')).toBe('1200')
  expect(await content('meta[property="og:image:height"]')).toBe('630')
  expect(await content('meta[name="twitter:card"]')).toBe('summary_large_image')

  // Absolute, or every crawler ignores it.
  const image = (await content('meta[property="og:image"]')) ?? ''
  expect(image.startsWith(baseURL ?? '')).toBe(true)
  expect(await content('meta[property="og:url"]')).toBe(`${baseURL ?? ''}/e/${slug}`)

  // The description is the kind, the day and the place — never a total.
  const description = (await content('meta[property="og:description"]')) ?? ''
  expect(description).toContain('Umngcwabo')
  expect(description).not.toMatch(/R\s?\d/)
})

test('the card is a 1200×630 PNG that WhatsApp will accept', async ({
  page,
  request,
}) => {
  const slug = slugFor('ogi')
  await seedEvent({ slug })

  const url = await cardUrlOn(page, slug)
  const response = await request.get(url)

  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toBe('image/png')
  expect(response.headers()['x-robots-tag']).toContain('noindex')

  const bytes = await response.body()
  expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 })
  // WhatsApp drops a preview whose image is too heavy. Ours is around 50KB.
  expect(bytes.byteLength).toBeLessThan(600 * 1024)
})

test('the card is generated once, not per request', async ({ page, request }) => {
  const slug = slugFor('ogc')
  const eventId = await seedEvent({ slug })

  const url = await cardUrlOn(page, slug)
  const version = /\/og\/([0-9a-f]{16})\.png$/.exec(url)?.[1] ?? ''
  expect(version).not.toBe('')

  const first = await request.get(url)
  expect(first.status()).toBe(200)

  // It landed in the object store rather than being redrawn each time.
  const cached = join(CACHE_ROOT, 'og', eventId, `${version}.png`)
  expect(existsSync(cached), 'the card was not cached').toBe(true)

  /*
   * The definitive check: replace the cached bytes with a marker and ask again.
   * If the second response is the marker, it came from the store — a route
   * that regenerated would answer with a real card and this would fail.
   */
  const marker = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from('cache-hit-marker'),
  ])
  mkdirSync(dirname(cached), { recursive: true })
  writeFileSync(cached, marker)

  const second = await request.get(url)
  expect((await second.body()).toString('binary')).toBe(marker.toString('binary'))

  rmSync(cached, { force: true })
})

test('a changed title mints a new URL, which is how WhatsApp is told to look again', async ({
  page,
  request,
}) => {
  const slug = slugFor('ogv')
  const eventId = await seedEvent({ slug, title: 'Nokuthula Mthembu' })

  const before = await cardUrlOn(page, slug)
  await retitle(eventId, 'Nokuthula Mthembu Zondi')
  const after = await cardUrlOn(page, slug)

  expect(after).not.toBe(before)

  // The old URL still answers — a link already sitting in a chat must not turn
  // into a broken box — but it is not the one cached for a year.
  const stale = await request.get(before)
  expect(stale.status()).toBe(200)
  expect(stale.headers()['cache-control']).not.toContain('immutable')

  const current = await request.get(after)
  expect(current.headers()['cache-control']).toContain('immutable')
})

test('a wedding card carries its accent and a funeral card does not', async ({
  page,
  request,
}) => {
  const funeralSlug = slugFor('ogf')
  const weddingSlug = slugFor('ogw')
  await seedEvent({ slug: funeralSlug, archetype: 'umngcwabo' })
  await seedEvent({ slug: weddingSlug, archetype: 'umshado', title: 'Lindiwe & Sipho' })

  const funeral = await request.get(await cardUrlOn(page, funeralSlug))
  const wedding = await request.get(await cardUrlOn(page, weddingSlug))

  const funeralBytes = await funeral.body()
  const weddingBytes = await wedding.body()

  // Both render; they are not the same picture. The colour itself is asserted
  // in the unit test, where it can be read rather than guessed from pixels.
  expect(pngSize(funeralBytes)).toEqual({ width: 1200, height: 630 })
  expect(pngSize(weddingBytes)).toEqual({ width: 1200, height: 630 })
  expect(funeralBytes.equals(weddingBytes)).toBe(false)
})

test('the badge is on the card, and earning it mints a new URL', async ({
  page,
  request,
}) => {
  // M3-02's done criterion. Two events identical in every fact the card draws
  // except the badge: different version, different URL, different bytes.
  //
  // The tick itself is asserted where it can be read — `og-card.test.tsx`
  // renders the card and looks for it. Here the picture is a PNG, and what this
  // proves is the half a unit test cannot: that the badge reaches the image
  // route, and that a card already sitting in a chat stops being current the
  // moment the organiser is verified (M2-07 §2).
  const plain = slugFor('nob')
  const badged = slugFor('bdg')

  await seedEvent({ slug: plain, verified: false })
  await seedEvent({ slug: badged, verified: true })

  const plainUrl = await cardUrlOn(page, plain)
  const badgedUrl = await cardUrlOn(page, badged)

  const version = (url: string) => url.split('/og/')[1]
  expect(version(badgedUrl)).not.toBe(version(plainUrl))

  const [plainBytes, badgedBytes] = await Promise.all([
    (await request.get(plainUrl)).body(),
    (await request.get(badgedUrl)).body(),
  ])

  expect(pngSize(badgedBytes)).toEqual({ width: 1200, height: 630 })
  expect(badgedBytes.equals(plainBytes)).toBe(false)
})

test('a draft has no card, and neither does a made-up version', async ({
  page,
  request,
}) => {
  const published = slugFor('ogp')
  await seedEvent({ slug: published })
  const url = await cardUrlOn(page, published)
  const version = /\/og\/([0-9a-f]{16})\.png$/.exec(url)?.[1] ?? ''

  const draft = slugFor('ogd')
  await seedEvent({ slug: draft, status: 'draft' })

  // A draft's card would be a preview of a page nobody can open.
  expect((await request.get(`/e/${draft}/og/${version}.png`)).status()).toBe(404)
  expect((await request.get(`/e/aaaaaaaaaaaaaaaa/og/${version}.png`)).status()).toBe(404)
  expect((await request.get(`/e/${published}/og/not-a-version.png`)).status()).toBe(404)
  expect((await request.get(`/e/${published}/og/${version}.jpg`)).status()).toBe(404)
  // A key that tried to walk out of the store never reaches it.
  expect(
    (await request.get(`/e/${published}/og/${version}.png/../../x.png`)).status(),
  ).toBe(404)
})

test('the card ships no font to the browser', async ({ page }) => {
  const slug = slugFor('ogn')
  await seedEvent({ slug })

  const fetched: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'font' || request.resourceType() === 'image') {
      fetched.push(new URL(request.url()).pathname)
    }
  })

  await page.goto(`/e/${slug}`)

  // og:image is for the crawler. A browser that fetched it would be paying for
  // 50KB it never displays, on the page with the 150KB ceiling.
  expect(fetched.filter((path) => path.includes('/og/'))).toEqual([])
  expect(fetched.filter((path) => path.endsWith('.woff'))).toEqual([])
})

test('the two Satori faces are not served to anybody', async ({ request }) => {
  // They live in src/assets/, so there is no route to them at all — which is
  // what keeps M1-05's "exactly two woff2 files ship" true.
  expect(readFileSync('src/assets/fonts/public-sans-latin-400.woff').byteLength).toBe(
    18_488,
  )
  expect((await request.get('/fonts/public-sans-latin-400.woff')).status()).toBe(404)
  expect((await request.get('/assets/fonts/public-sans-latin-400.woff')).status()).toBe(
    404,
  )
})
