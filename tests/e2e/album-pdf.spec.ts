import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { expect, test, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { albumCopy } from '@/copy/album'
import { PrismaClient } from '@/db/generated/client'
import { appendEntry } from '@/db/repositories/ledger'
import { fromCents } from '@/domain/money'
import { generateCode } from '@/domain/reference'

/**
 * The printed album, end to end: the organiser asks, the scheduled job builds
 * it, and a real PDF comes back.
 *
 * **`pnpm render` is run for real**, not called in-process. The done-criterion
 * is that generation is queued rather than synchronous, and the thing that
 * makes that true is a separate entry point somebody puts in a crontab — so the
 * entry point is what the test drives.
 */

const run = promisify(execFile)

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
  return { 'cf-connecting-ip': `198.21.${String(octet())}.${String(octet())}` }
}

interface Fixture {
  slug: string
  eventId: string
  organiserPhone: string
}

async function seedEvent(entries: number): Promise<Fixture> {
  const prisma = prismaClient()
  const slug = `print${Math.random().toString(36).slice(2, 13)}`
    .padEnd(16, '0')
    .slice(0, 16)
  const organiserPhone = `084${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`

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
        refPrefix: 'PRN',
        refCode: generateCode(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        title: 'Nokuthula Mthembu',
        status: 'published',
        visibilityDefault: 'name_only',
      },
      select: { id: true },
    })

    for (let index = 0; index < entries; index += 1) {
      const cents = BigInt(5_000 + index * 900)

      const contribution = await prisma.contribution.create({
        data: {
          eventId: event.id,
          contributorName: 'Nomusa Ngcobo',
          type: 'cash',
          amountCents: cents,
          visibility: 'name_only',
          verificationSource: 'organiser_confirmed',
          status: 'confirmed',
          confirmedAt: new Date(),
          message: index % 2 === 0 ? 'Sisemuva kwenu.' : null,
        },
        select: { id: true },
      })

      await appendEntry(prisma, {
        chain: { eventId: event.id },
        entryType: 'contribution',
        direction: 'credit',
        amountCents: fromCents(cents),
        referenceId: contribution.id,
        contributionId: contribution.id,
      })
    }

    return { slug, eventId: event.id, organiserPhone }
  } finally {
    await prisma.$disconnect()
  }
}

async function signInOrganiser(page: Page, phone: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(phone)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()

  const response = await page.request.get(
    `/dev/sms?phone=${encodeURIComponent(`+27${phone.slice(1)}`)}`,
  )
  const { body } = (await response.json()) as { body: string }

  await page.getByLabel('The six-digit code').fill(/\b(\d{6})\b/.exec(body)?.[1] ?? '')
  await page.getByRole('button', { name: 'Sign me in' }).click()
  await expect(page).toHaveURL(/\/account$/)
}

test('an organiser asks for a printable album and the job builds it', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const fixture = await seedEvent(12)

  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  await signInOrganiser(page, fixture.organiserPhone)
  await page.goto(`/manage/${fixture.eventId}`)

  await expect(page.getByText(albumCopy.print.heading)).toBeVisible()
  await page.getByRole('button', { name: albumCopy.print.request }).click()

  /*
   * **The wait is stated, not spun.**
   *
   * There is no queue daemon: the render waits for the next run of a scheduled
   * job. A spinner here would be a lie with a moving part, so the copy names
   * the hour instead.
   */
  await expect(page.getByText(/It is made by a job that runs every hour/)).toBeVisible()
  await expect(page.getByRole('link', { name: albumCopy.print.ready })).toHaveCount(0)

  // Nothing is downloadable before the job has run — not a half-written file
  // and not a 200 with an empty body.
  const version = await currentVersion(fixture.eventId)
  const early = await page.request.get(`/e/${fixture.slug}/album/${version}.pdf`)
  expect(early.status()).toBe(404)

  // The scheduled job, run for real.
  const { stdout } = await run('pnpm', ['render'], { cwd: process.cwd() })
  expect(stdout).toContain('rendered')

  await page.reload()

  const download = page.getByRole('link', { name: albumCopy.print.ready })
  await expect(download).toBeVisible()
  // What a print shop needs to know before they open it.
  await expect(page.getByText(/A5, 3mm bleed, RGB/)).toBeVisible()

  const href = await download.getAttribute('href')
  const pdf = await page.request.get(href ?? '')

  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toBe('application/pdf')
  expect(pdf.headers()['cache-control']).toContain('immutable')
  // Named for the family rather than for a hash, because that is what somebody
  // reads off a counter.
  expect(pdf.headers()['content-disposition']).toContain('Nokuthula-Mthembu')

  const body = await pdf.body()
  expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(body.byteLength).toBeGreaterThan(2_000)

  await context.close()
})

test('the album pdf is not reachable at a version nobody rendered', async ({
  browser,
}) => {
  const fixture = await seedEvent(1)

  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  // A well-formed version that was never asked for, a malformed one, and a
  // path that is not a PDF at all. All the same answer.
  for (const file of ['0123456789abcdef.pdf', 'nonsense.pdf', 'something.png']) {
    const response = await page.request.get(`/e/${fixture.slug}/album/${file}`)
    expect(response.status()).toBe(404)
  }

  await context.close()
})

/** The version the dashboard would have requested, read straight from the row. */
async function currentVersion(eventId: string): Promise<string> {
  const prisma = prismaClient()

  try {
    const row = await prisma.albumRender.findFirst({
      where: { eventId },
      orderBy: { requestedAt: 'desc' },
      select: { version: true },
    })

    return row?.version ?? '0'.repeat(16)
  } finally {
    await prisma.$disconnect()
  }
}
