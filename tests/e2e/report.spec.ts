import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'

/**
 * The report channel end to end (M3-06).
 *
 * **A report creates a reviewable record and an acknowledgement**, which is the
 * done-criterion — and the acknowledgement that arrives today is the reference
 * on screen, because no BSP exists to send the other one.
 *
 * The three entry points are all here: an event page, a collection page's
 * sibling, and `/check` when nothing matched. The last is the most valuable
 * report there is.
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

async function seed(slug: string): Promise<string> {
  const prisma = prismaClient()

  try {
    const organiser = await prisma.organiser.create({
      data: {
        phoneE164: `+2788${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
        displayName: 'Nomsa Mthembu',
        idVerificationStatus: 'verified',
        idVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
      },
    })

    const code = refCode()

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'MTH',
        refCode: code,
        title: 'Nokuthula Mthembu',
        place: 'KwaMashu',
        status: 'published',
        visibilityDefault: 'name_only',
      },
      select: { id: true },
    })

    await prisma.needItem.create({
      data: { eventId: event.id, label: 'Tent', note: 'Around R1 200', sortOrder: 0 },
    })

    return event.id
  } finally {
    await prisma.$disconnect()
  }
}

async function fileFrom(page: Page, url: string): Promise<string> {
  await page.goto(url)
  await page.getByRole('heading', { name: 'Tell us something is wrong' }).waitFor()

  await page.getByText('The umcimbi is not real, or is not happening').click()
  await page
    .getByLabel('Anything you want to add')
    .fill('Somebody sent me this and the family says they know nothing about it.')
  await page.getByRole('button', { name: 'Send this report' }).click()

  await expect(page.getByRole('heading', { name: 'We have it' })).toBeVisible()

  const reference = await page.getByText(/REP-[0-9A-Z]{6}/).innerText()

  return /REP-[0-9A-Z]{6}/.exec(reference)?.[0] ?? ''
}

test('a report from an event page creates a record and an acknowledgement', async ({
  page,
}) => {
  await asFreshClient(page)
  const slug = slugFor('rep')
  const eventId = await seed(slug)

  // The panel points here, under the instruction to type it (M3-04 §2).
  await page.goto(`/e/${slug}`)
  await expect(
    page.getByText('type isipheko.co.za/report into your browser'),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'isipheko.co.za/report' })).toBeVisible()

  const reference = await fileFrom(page, `/report?e=${slug}`)
  expect(reference).toMatch(/^REP-[0-9A-Z]{6}$/)

  // The acknowledgement that arrives: a reference, now, with the window on it.
  await expect(page.getByText('A person will have looked at this by')).toBeVisible()
  await expect(page.getByText('Write it down or take a picture')).toBeVisible()
  // And the truth about what a report does, so nobody goes back expecting a
  // changed page and concludes nothing happened.
  await expect(
    page.getByText('Nothing changes on the page because of this'),
  ).toBeVisible()

  const prisma = prismaClient()
  try {
    const report = await prisma.report.findFirstOrThrow({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    })

    expect(report.status).toBe('received')
    expect(report.reason).toBe('never_happened')
    expect(report.respondBy.getTime()).toBeGreaterThan(Date.now())

    // The event is untouched — the standing rule, seen from outside.
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } })
    expect(event.status).toBe('published')
  } finally {
    await prisma.$disconnect()
  }

  // And the page is exactly as it was.
  const response = await page.goto(`/e/${slug}`)
  expect(response?.status()).toBe(200)
})

test('somebody who leaves a number is told they will hear, and one who does not is told they will not', async ({
  page,
}) => {
  await asFreshClient(page)

  await page.goto('/report')
  await page.getByText('Something else').click()
  await page
    .getByLabel('The link or code you were sent')
    .fill('a link a stranger sent me')
  await page.getByRole('button', { name: 'Send this report' }).click()

  await expect(
    page.getByText('this screen is the whole of what you will hear'),
  ).toBeVisible()

  await asFreshClient(page)
  await page.goto('/report')
  await page.getByText('Something else').click()
  await page.getByLabel('The link or code you were sent').fill('another link')
  await page
    .getByLabel('Your number, if you want us to come back to you')
    .fill('0821234567')
  await page.getByRole('button', { name: 'Send this report' }).click()

  await expect(page.getByText('We have your number and will use it once')).toBeVisible()

  // The acknowledgement is in the outbox, queued rather than sent — no BSP
  // exists, which is correct.
  const prisma = prismaClient()
  try {
    const queued = await prisma.notification.findFirst({
      where: { kind: 'report_received', toPhoneE164: '+27821234567' },
      orderBy: { createdAt: 'desc' },
    })

    expect(queued?.status).toBe('pending')
    expect(queued?.sentAt).toBeNull()
  } finally {
    await prisma.$disconnect()
  }
})

test('a report about a link that resolves to nothing is reachable from /check', async ({
  page,
}) => {
  await asFreshClient(page)

  await page.goto(`/check?code=${encodeURIComponent('MTH-ZZZZZZ')}`)
  await expect(page.getByText('Nothing here matches that')).toBeVisible()
  await expect(
    page.getByText('If you were sent a link and nothing here matches'),
  ).toBeVisible()

  const reference = await fileFrom(page, '/report')
  expect(reference).toMatch(/^REP-/)
})

test('an empty form is refused, and says what to do', async ({ page }) => {
  await asFreshClient(page)

  await page.goto('/report')
  await page.getByRole('button', { name: 'Send this report' }).click()

  await expect(page.getByText('Choose what is wrong, and send it again')).toBeVisible()

  await page.getByText('Something else').click()
  await page.getByRole('button', { name: 'Send this report' }).click()

  await expect(page.getByText('Tell us something about it')).toBeVisible()
})

/**
 * UX-06. The reason radios have no default and no `required` — deliberately,
 * so nothing is pre-chosen for somebody upset — which makes forgetting one
 * the ordinary miss. The refusal must hand back every word they typed: a
 * wiped paragraph on this form is the 57% problem produced by our own hand.
 */
test('a refusal hands back everything that was typed', async ({ page }) => {
  await asFreshClient(page)

  await page.goto('/report')
  await page
    .getByLabel('The link or code you were sent')
    .fill('https://isipheko.co.za/e/notrealnotreal11')
  await page
    .getByLabel('Anything you want to add')
    .fill('My aunt sent money and the family never got it. The page looked real.')
  await page
    .getByLabel('Your number, if you want us to come back to you')
    .fill('0821234567')

  // No reason chosen — the ordinary miss.
  await page.getByRole('button', { name: 'Send this report' }).click()
  await expect(page.getByText('Choose what is wrong, and send it again')).toBeVisible()

  await expect(page.getByLabel('Anything you want to add')).toHaveValue(
    'My aunt sent money and the family never got it. The page looked real.',
  )
  await expect(page.getByLabel('The link or code you were sent')).toHaveValue(
    'https://isipheko.co.za/e/notrealnotreal11',
  )
  await expect(
    page.getByLabel('Your number, if you want us to come back to you'),
  ).toHaveValue('0821234567')

  // Choosing the reason is now the only thing left to do.
  await page.getByText('I gave money and the family never got it').click()
  await page.getByRole('button', { name: 'Send this report' }).click()
  await expect(page.getByText(/Your reference is/)).toBeVisible()
})

test('the form works with JavaScript disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  try {
    await asFreshClient(page)
    const reference = await fileFrom(page, '/report')

    expect(reference).toMatch(/^REP-[0-9A-Z]{6}$/)
  } finally {
    await context.close()
  }
})

test('the form asks for no account and no email', async ({ page }) => {
  await asFreshClient(page)
  await page.goto('/report')

  // Rule 4, on the screen most likely to be reached by somebody who has never
  // heard of us.
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.locator('input[type=email]')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('Sign up')
  await expect(page.getByText('you do not need an account')).toBeVisible()
})

test('/report is not indexed and not cached', async ({ request }) => {
  const response = await request.get('/report')

  expect(response.headers()['x-robots-tag']).toContain('noindex')
  expect(response.headers()['cache-control']).toContain('no-store')
})

test('/report has no accessibility violations, asking or filed', async ({ page }) => {
  await asFreshClient(page)

  await page.goto('/report')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await fileFrom(page, '/report')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})
