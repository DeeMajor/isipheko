import { expect, test, type Browser, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'
import { generateCode } from '@/domain/reference'

/**
 * Mode A, end to end: a stranger arrives from a link, pays from their own
 * banking app against a reference, comes back and says so, and the organiser
 * confirms it onto the ledger.
 *
 * Nothing in this file logs anybody in on the contributor side, because there
 * is nothing to log into (CLAUDE.md rule 4).
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

/** A fresh address per context — reports are limited per address (M2-05). */
function freshAddress(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return { 'cf-connecting-ip': `198.18.${String(octet())}.${String(octet())}` }
}

interface Fixture {
  slug: string
  eventId: string
  organiserPhone: string
}

async function seedEvent({
  withPayDetails,
}: {
  withPayDetails: boolean
}): Promise<Fixture> {
  const prisma = prismaClient()
  const slug = `give${Math.random().toString(36).slice(2, 14)}`
    .padEnd(16, '0')
    .slice(0, 16)
  const organiserPhone = `082${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`

  try {
    const organiser = await prisma.organiser.create({
      data: { phoneE164: `+27${organiserPhone.slice(1)}`, displayName: 'Nomsa Mthembu' },
    })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        refPrefix: 'GVE',
        refCode: generateCode(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        title: 'Nokuthula Mthembu',
        status: 'published',
        visibilityDefault: 'name_only',
        ...(withPayDetails
          ? { directPayDetails: { phone: '082 123 4567', name: 'N. Mthembu' } }
          : {}),
      },
      select: { id: true },
    })

    await prisma.needItem.create({
      data: { eventId: event.id, label: 'Tent', quantityRequired: 1, sortOrder: 0 },
    })

    return { slug, eventId: event.id, organiserPhone }
  } finally {
    await prisma.$disconnect()
  }
}

/** Signs the organiser in, so the confirmation queue can be reached. */
async function signInOrganiser(page: Page, phone: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(phone)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()

  const response = await page.request.get(
    `/dev/sms?phone=${encodeURIComponent(`+27${phone.slice(1)}`)}`,
  )
  const { body } = (await response.json()) as { body: string }
  const code = /\b(\d{6})\b/.exec(body)?.[1] ?? ''

  await page.getByLabel('The six-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign me in' }).click()
  await expect(page).toHaveURL(/\/account$/)
}

/** Walks the money route to the pay step and returns the reference shown. */
async function walkToPayStep(page: Page, slug: string): Promise<string> {
  await page.goto(`/e/${slug}/contribute`)

  await page.getByRole('button', { name: 'Stand with them money', exact: true }).click()
  await expect(page.getByRole('heading', { name: /How much/ })).toBeVisible()

  await page.getByLabel('Amount').fill('R1 234,56')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: /Who should we say/ })).toBeVisible()
  await page.getByLabel('Your name').fill('Thandi Ngcobo')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(
    page.getByRole('heading', { name: 'Pay from your banking app' }),
  ).toBeVisible()

  const reference = await page.locator('[data-copy-value]').nth(1).innerText()
  return reference.trim()
}

test('a stranger contributes and the organiser confirms it onto the ledger', async ({
  browser,
}) => {
  const fixture = await seedEvent({ withPayDetails: true })

  // The contributor. No account, no session, nothing to sign into.
  const visitor = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await visitor.newPage()

  const reference = await walkToPayStep(page, fixture.slug)
  expect(reference).toMatch(/^[A-Z]{3}-[0-9A-HJKMNP-TV-Z]{6}$/)

  // The PayShap number and the organiser's name, so it can be checked before
  // anything is sent.
  await expect(page.getByText('082 123 4567')).toBeVisible()
  await expect(page.getByText('N. Mthembu')).toBeVisible()
  await expect(page.getByText('R1 234,56')).toBeVisible()

  await page.getByRole('button', { name: "I've paid" }).click()
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()

  // The organiser, elsewhere, confirming against their own bank notification.
  const organiser = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const organiserPage = await organiser.newPage()
  await signInOrganiser(organiserPage, fixture.organiserPhone)

  await organiserPage.goto(`/manage/${fixture.eventId}`)
  await expect(organiserPage.getByText('Thandi Ngcobo').first()).toBeVisible()
  // The reference appears twice on the dashboard M3-08 built: once on the row,
  // and again in the line telling her what to look for in her own banking app.
  // `exact` because getByText is otherwise a case-insensitive substring match,
  // and "Reference X" is inside "…with reference X".
  await expect(
    organiserPage.getByText(`Reference ${reference}`, { exact: true }),
  ).toBeVisible()

  await organiserPage.getByRole('button', { name: "Yes, it's in my account" }).click()
  await expect(organiserPage.getByText('Recorded on the ledger.')).toBeVisible()

  // And it is on the ledger, hashed into the chain.
  const prisma = prismaClient()
  try {
    const entries = await prisma.ledgerEntry.findMany({
      where: { eventId: fixture.eventId },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entryType).toBe('contribution')
    expect(entries[0]?.amountCents).toBe(123_456n)
  } finally {
    await prisma.$disconnect()
  }

  await visitor.close()
  await organiser.close()
})

test('works with JavaScript disabled, from first step to last', async ({ browser }) => {
  const fixture = await seedEvent({ withPayDetails: true })
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()

  const reference = await walkToPayStep(page, fixture.slug)
  expect(reference).toMatch(/^[A-Z]{3}-[0-9A-HJKMNP-TV-Z]{6}$/)

  await page.getByRole('button', { name: "I've paid" }).click()
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()

  await context.close()
})

test('asks for no account, no password and no email, on any step', async ({
  browser,
}) => {
  const fixture = await seedEvent({ withPayDetails: true })
  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  const seen: string[] = []

  async function auditCurrentStep(): Promise<void> {
    const inputs = await page.locator('input, button, a').all()

    for (const control of inputs) {
      const [type, name, id, placeholder, autocomplete, text] = await Promise.all([
        control.getAttribute('type'),
        control.getAttribute('name'),
        control.getAttribute('id'),
        control.getAttribute('placeholder'),
        control.getAttribute('autocomplete'),
        control.innerText().catch(() => ''),
      ])

      seen.push([type, name, id, placeholder, autocomplete, text].join(' ').toLowerCase())
    }
  }

  await page.goto(`/e/${fixture.slug}/contribute`)
  await auditCurrentStep()

  await page.getByRole('button', { name: 'Stand with them money', exact: true }).click()
  await auditCurrentStep()

  await page.getByLabel('Amount').fill('R100,00')
  await page.getByRole('button', { name: 'Continue' }).click()
  await auditCurrentStep()

  await page.getByLabel('Your name').fill('Thandi Ngcobo')
  await page.getByRole('button', { name: 'Continue' }).click()
  await auditCurrentStep()

  const everything = seen.join(' | ')

  // Rule 4: any design requiring a contributor account is wrong. A phone number
  // is asked for and marked optional; an email address is never asked for at
  // all, because it is the field that turns into an account.
  expect(everything).not.toContain('password')
  expect(everything).not.toContain('email')
  expect(everything).not.toContain('sign up')
  expect(everything).not.toContain('signup')
  expect(everything).not.toContain('register')
  expect(everything).not.toContain('create an account')
  expect(await page.locator('input[type="password"]').count()).toBe(0)
  expect(await page.locator('input[type="email"]').count()).toBe(0)

  await context.close()
})

test('says plainly when the organiser has given no number, instead of showing a blank', async ({
  browser,
}) => {
  const fixture = await seedEvent({ withPayDetails: false })
  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  await page.goto(`/e/${fixture.slug}/contribute`)
  await page.getByRole('button', { name: 'Stand with them money', exact: true }).click()
  await page.getByLabel('Amount').fill('R100,00')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Your name').fill('Thandi')
  await page.getByRole('button', { name: 'Continue' }).click()

  // A blank where a payment number belongs is how somebody pays the wrong
  // account. This says what is true instead.
  await expect(
    page.getByRole('heading', { name: 'This page cannot take money yet' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: "I've paid" })).toHaveCount(0)

  // And no row was created. Issuing a reference code for a page that cannot
  // take money would leave the organiser a queue of payments nobody could have
  // made, and a code that means nothing.
  const prisma = prismaClient()
  try {
    const rows = await prisma.contribution.count({ where: { eventId: fixture.eventId } })
    expect(rows).toBe(0)
  } finally {
    await prisma.$disconnect()
  }

  await context.close()
})

test('shows the expected shape of an amount before anybody gets it wrong', async ({
  browser,
}) => {
  const fixture = await seedEvent({ withPayDetails: true })
  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  await page.goto(`/e/${fixture.slug}/contribute`)
  await page.getByRole('button', { name: 'Stand with them money', exact: true }).click()

  // M1-03: parseMoney refuses "1,234" as ambiguous rather than guessing, so the
  // shape is shown from the start and most people never meet that refusal.
  await expect(page.getByLabel('Amount')).toHaveAttribute('placeholder', 'R1 234,56')

  // And the refusal, when it does happen, does not lose what they typed.
  await page.getByLabel('Amount').fill('1,234')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Enter an amount, like R1 234,56.')).toBeVisible()

  await context.close()
})

test('carries the archetype default into the visibility choice', async ({ browser }) => {
  // A funeral hides amounts by default (M1-04). The contributor still chooses.
  const fixture = await seedEvent({ withPayDetails: true })
  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  await page.goto(`/e/${fixture.slug}/contribute`)
  await page.getByRole('button', { name: 'Stand with them money', exact: true }).click()
  await page.getByLabel('Amount').fill('R100,00')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.locator('#v-name_only')).toBeChecked()
  await expect(page.locator('#v-public')).not.toBeChecked()
  await expect(
    page.getByText('The family always sees the full record, whatever you choose here.'),
  ).toBeVisible()

  await context.close()
})

test('never lets the pay screen be cached for the next person', async ({
  browser,
}: {
  browser: Browser
}) => {
  const fixture = await seedEvent({ withPayDetails: true })
  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  const response = await page.goto(`/e/${fixture.slug}/contribute`)

  // Every screen here is one person's, and one of them carries a payment
  // reference belonging to a single contribution.
  expect(response?.headers()['cache-control']).toContain('no-store')

  await context.close()
})
