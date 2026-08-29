import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'
import {
  generateSessionToken,
  hashSessionToken,
  sessionCookieName,
  sessionExpiresAt,
} from '@/domain/auth'

/**
 * The review queue end to end (M3-07) — the screen a person works from.
 *
 * Three things it has to prove, and only one of them is about the screen:
 *
 * 1. **The door.** A signed-in organiser who is not on the allowlist gets
 *    nothing, and the refusal is a row in the audit log.
 * 2. **The work.** A reviewer sees the queue, opens a report, and closes it —
 *    all of it inside `<form method="post">`, so it works with JavaScript
 *    disabled.
 * 3. **The standing rule.** The reported page is unchanged afterwards. That is
 *    asserted against the live page rather than the row, because what a family
 *    experiences is the page.
 *
 * The allowlist is set on the dev server in `playwright.config.ts`. It is an
 * environment variable and not a column deliberately — the application role
 * holds UPDATE on `organisers`, so a flag the app can set on itself is not a
 * privilege boundary.
 */

/**
 * The numbers `playwright.config.ts` puts on the allowlist.
 *
 * One per test rather than one shared, so no test is waiting on another's row.
 */
const ADMIN_NUMBERS = [
  '+27820000901',
  '+27820000902',
  '+27820000903',
  '+27820000904',
  '+27820000905',
  '+27820000906',
]

function uniquePhone(): string {
  const suffix = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')
  return `083${suffix}`
}

const e164 = (local: string) => `+27${local.slice(1)}`

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

function refCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)] ?? '0',
  ).join('')
}

async function asFreshClient(page: Page): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  await page.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.51.${String(octet())}.${String(octet())}`,
  })
}

/** A published umcimbi with one report already filed against it. */
async function seedReportedEvent(title: string): Promise<{ slug: string }> {
  const prisma = prismaClient()
  const slug = slugFor('rev')

  try {
    const organiser = await prisma.organiser.create({
      data: {
        phoneE164: e164(uniquePhone()),
        displayName: 'Nomsa Mthembu',
        idVerificationStatus: 'verified',
        idVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
      },
    })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        archetype: 'umshado',
        archetypeGroup: 'union',
        refPrefix: 'ISP',
        refCode: refCode(),
        title,
        status: 'published',
      },
    })

    await prisma.witness.create({
      data: { eventId: event.id, name: 'MaDlamini', phoneE164: e164(uniquePhone()) },
    })

    return { slug }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Signs somebody in by writing the session row and setting the cookie.
 *
 * **Not through the OTP screens, deliberately.** `sign-in.spec.ts` is what
 * proves signing in works; going through it here would spend one of the three
 * codes an hour a number is allowed, and this file's numbers are a fixed pool
 * rather than random ones — so a second run inside the hour would fail on the
 * rate limit rather than on anything this file is about. The cookie is 32 random
 * bytes and the row holds their SHA-256, exactly as `startSession` writes it.
 */
async function signInAs(page: Page, phoneE164: string): Promise<void> {
  const prisma = prismaClient()
  const token = generateSessionToken()
  const now = new Date()

  try {
    const organiser = await prisma.organiser.upsert({
      where: { phoneE164 },
      update: {},
      create: { phoneE164, displayName: 'A reviewer' },
    })

    await prisma.session.create({
      data: {
        organiserId: organiser.id,
        tokenHash: hashSessionToken(token),
        expiresAt: sessionExpiresAt(now),
        authenticatedAt: now,
        lastSeenAt: now,
        createdIpHash: null,
        userAgentHash: null,
      },
    })
  } finally {
    await prisma.$disconnect()
  }

  await page.context().addCookies([
    {
      // The development name: `__Host-` requires `Secure`, which plain http
      // refuses, so the prefix and the flag move together (M1-06).
      name: sessionCookieName(false),
      value: token,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

/** Files a report through the real form, so the record is one a person made. */
async function fileReportAbout(page: Page, slug: string, words: string): Promise<void> {
  await page.goto(`/report?e=${slug}`)
  await page
    .getByRole('radio', { name: 'The umcimbi is not real, or is not happening' })
    .check()
  await page.getByLabel('Anything you want to add').fill(words)
  await page.getByRole('button', { name: 'Send this report' }).click()
  await expect(page.getByRole('heading', { name: 'We have it' })).toBeVisible()
}

/**
 * Open a report from the queue, paging to reach it if it is not on this screen.
 *
 * **The queue is paginated (M3-07b)** and every other test in this suite files
 * into the same one, so a freshly-filed report sorts last — by deadline — and
 * is on the final page rather than the first as soon as more than fifty are
 * open. That is the pagination working, and it is also how these two tests
 * started failing against a local database with fifty-nine open reports.
 *
 * Following the links is what a reviewer does, so the tests do it too.
 */
async function openReport(page: Page, title: string): Promise<void> {
  const link = page.getByRole('link', { name: new RegExp(title) })

  for (let hop = 0; hop < 20; hop += 1) {
    if ((await link.count()) > 0) break

    const next = page.getByRole('link', { name: /The next/ })
    if ((await next.count()) === 0) break

    await next.first().click()
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
  }

  await link.first().click()
}

test('a signed-in organiser who is not a reviewer gets nothing', async ({ page }) => {
  await asFreshClient(page)
  await signInAs(page, e164(uniquePhone()))

  await page.goto('/review')

  // Redirected rather than told what it is. The screen does not confirm to
  // somebody who may not know it exists that it does.
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { name: 'Reports' })).toHaveCount(0)
})

test('somebody with no session is sent to sign in', async ({ page }) => {
  await asFreshClient(page)
  await page.goto('/review')

  await expect(page).toHaveURL(/\/sign-in/)
})

test('a reviewer works the queue, and the page is unchanged afterwards', async ({
  page,
}) => {
  await asFreshClient(page)

  const title = `Zanele no Sipho ${Math.random().toString(36).slice(2, 7)}`
  const { slug } = await seedReportedEvent(title)

  await fileReportAbout(page, slug, 'The name on this page is not the family I know.')

  // What a contributor sees before anybody reviews anything.
  await page.goto(`/e/${slug}`)
  const before = await page.content()

  await signInAs(page, ADMIN_NUMBERS[0] ?? '')
  await page.goto('/review')

  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()

  // The standing rule is on the screen, not only in a comment.
  await expect(page.getByText('Nothing here changes a page')).toBeVisible()

  // By title, not by position: the queue is one queue and every other test in
  // the suite has filed into it — and paginated since M3-07b, so this pages to
  // reach it the way a reviewer would.
  await openReport(page, title)

  await expect(
    page.getByText('The name on this page is not the family I know.'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What it is about' })).toBeVisible()
  await expect(page.getByText(title)).toBeVisible()

  // They left no number, and the screen says so rather than describing a
  // message somebody would wait for.
  await expect(page.getByText('They left no number')).toBeVisible()

  // The trail is the audit log — this event was published, which is a row.
  await expect(
    page.getByRole('heading', { name: 'What has happened to this umcimbi' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'I have decided this' }).click()
  await expect(page).toHaveURL(/\/review\?done=1$/)

  // **The rule.** Deciding a report records that somebody read it. It does not
  // take a page down, and a family who are being reported must not find their
  // page changed under them by somebody else's accusation.
  await page.goto(`/e/${slug}`)
  expect(await page.content()).toBe(before)
})

test('a reviewer can reach a report that does not fit on the first page', async ({
  page,
}) => {
  /*
   * M3-07b, and the done-criterion in one test: **a reviewer can reach every
   * open report.**
   *
   * `reviewQueue` took a hundred and the screen said nothing about it, so
   * somebody who scrolled to the bottom of a silently capped list believed they
   * had seen everything. The SLA failed invisibly on the screen built to
   * guarantee it, and what fell off were the newest reports — the ones whose
   * deadline had not yet passed and which still had time to save.
   *
   * The report this test looks for is given a **later deadline than every other
   * report in the database**, which puts it last in the queue by construction.
   * If the list still ended silently, it would be unreachable.
   */
  test.slow()
  await asFreshClient(page)

  const prisma = prismaClient()
  // The queue renders each report's reference, not its free text — a list read
  // at a glance carries no detail (M3-07 §5). So the reference is the marker.
  const marker = `RPT-${refCode()}`

  try {
    const open = await prisma.report.count({
      where: { status: { in: ['received', 'reviewing'] } },
    })

    // Enough to guarantee a second page, whatever is already in there.
    const filler = Math.max(0, 50 - open) + 5
    const far = new Date('2027-12-31T09:00:00.000Z')

    for (let index = 0; index < filler; index += 1) {
      await prisma.report.create({
        data: {
          refPrefix: 'RPT',
          refCode: refCode(),
          reason: 'something_else',
          aboutTyped: `queue filler ${String(index)}`,
          respondBy: new Date('2027-12-30T09:00:00.000Z'),
        },
      })
    }

    await prisma.report.create({
      data: {
        refPrefix: 'RPT',
        refCode: marker.slice(4),
        reason: 'something_else',
        aboutTyped: 'the last one in the queue',
        // Latest deadline of all, so it sorts last.
        respondBy: far,
      },
    })

    await signInAs(page, ADMIN_NUMBERS[4] ?? '')
    await page.goto('/review')

    // The list says where it ends and whether that is the end.
    await expect(page.getByText(/Showing 1 to \d+ of \d+ open reports/)).toBeVisible()

    // Not on the first page, by construction.
    await expect(page.getByText(marker)).toHaveCount(0)

    // Plain links, so this works with JavaScript off like the rest of the
    // product. Follow them until the last report is on screen.
    for (let hop = 0; hop < 20; hop += 1) {
      const next = page.getByRole('link', { name: /The next/ })
      if ((await next.count()) === 0) break
      await next.first().click()
      await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
      if ((await page.getByText(marker).count()) > 0) break
    }

    await expect(page.getByText(marker)).toBeVisible()
  } finally {
    /*
     * Closed, never deleted. The application role holds UPDATE on `reports` and
     * **`REVOKE DELETE, TRUNCATE`** (the reports migration) — a report is a
     * record of somebody's accusation and the product cannot make one vanish.
     * Closing is what takes a report out of the open queue, and it is what a
     * reviewer does, so the fixtures leave the way real ones do.
     *
     * Found by writing `deleteMany` and getting `permission denied for table
     * reports` — the grant working, on a test rather than on a person.
     */
    await prisma.report.updateMany({
      where: { refPrefix: 'RPT' },
      data: { status: 'closed', closedAt: new Date() },
    })
    await prisma.$disconnect()
  }
})

test('the queue and the report screen have no accessibility violations', async ({
  page,
}) => {
  await asFreshClient(page)

  const title = `Nokuthula Mthembu ${Math.random().toString(36).slice(2, 7)}`
  const { slug } = await seedReportedEvent(title)
  await fileReportAbout(page, slug, 'Somebody asked me for an OTP.')

  await signInAs(page, ADMIN_NUMBERS[1] ?? '')
  await page.goto('/review')

  const queue = await new AxeBuilder({ page }).analyze()
  expect(queue.violations).toEqual([])

  await openReport(page, title)

  const detail = await new AxeBuilder({ page }).analyze()
  expect(detail.violations).toEqual([])
})
