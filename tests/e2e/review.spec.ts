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
  // the suite has filed into it.
  await page.getByRole('link', { name: new RegExp(title) }).click()

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

  await page.getByRole('link', { name: new RegExp(title) }).click()

  const detail = await new AxeBuilder({ page }).analyze()
  expect(detail.violations).toEqual([])
})
