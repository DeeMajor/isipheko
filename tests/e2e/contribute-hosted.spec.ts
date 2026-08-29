import { expect, test, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'
import { generateCode } from '@/domain/reference'

/**
 * The hosted flow, end to end: a stranger arrives from a link, pays **on the
 * page**, and comes back to a done screen that tells the truth about where the
 * payment got to.
 *
 * The provider is the simulator, so the checkout is `/dev/payments` — that page
 * stands in for a provider's own hosted payment screen, which is where the
 * contributor genuinely leaves our origin. Everything either side of it is the
 * real flow.
 *
 * Nothing here logs the contributor into anything, because there is nothing to
 * log into (CLAUDE.md rule 4).
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

/** A fresh address per context — starting a payment is rate-limited (M2-05). */
function freshAddress(): Record<string, string> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return { 'cf-connecting-ip': `198.19.${String(octet())}.${String(octet())}` }
}

interface Fixture {
  slug: string
  eventId: string
  organiserId: string
  organiserPhone: string
}

/**
 * `mode: 'hosted'` is set here rather than through a screen, because no screen
 * sets it — M5-02's stand-in, recorded in docs/decisions.md M5-02 §1. A fixture
 * setting fixture state is not a bypass in the product; it is the same door
 * M2-10 §10's size-gate fixture uses.
 *
 * **The "nowhere to settle" case is not reachable from here**, and deliberately
 * not faked. The beneficiary stand-in is the organiser's id, so every hosted
 * event has one; the refusal is asserted in
 * `tests/unit/contribution-hosted.test.tsx`, where a beneficiary can actually
 * be withheld. An E2E that seeded a broken row to reach it would be testing the
 * fixture.
 */
async function seedHostedEvent(): Promise<Fixture> {
  const prisma = prismaClient()
  const slug = `host${Math.random().toString(36).slice(2, 14)}`
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
        refPrefix: 'HST',
        refCode: generateCode(),
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        title: 'Nokuthula Mthembu',
        status: 'published',
        visibilityDefault: 'name_only',
        mode: 'hosted',
      },
      select: { id: true },
    })

    return { slug, eventId: event.id, organiserId: organiser.id, organiserPhone }
  } finally {
    await prisma.$disconnect()
  }
}

/** Signs the organiser in, so the dashboard can be reached. */
async function signInOrganiser(page: Page, phone: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(phone)
  await page.getByRole('button', { name: 'Send me a code' }).click()

  // Waiting for the code screen before reading /dev/sms: the request would
  // otherwise race the action that sends it.
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

/** Everything before the pay step is identical in both modes. */
async function walkToPayStep(page: Page, slug: string): Promise<void> {
  await page.goto(`/e/${slug}/contribute`)

  await page.getByRole('button', { name: 'Stand with them money', exact: true }).click()
  await page.getByLabel('Amount').fill('R1 234,56')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByLabel('Your name').fill('Thandi Ngcobo')
  await page.getByRole('button', { name: 'Continue' }).click()
}

test('a stranger pays on the page and comes back to the done step', async ({
  browser,
}) => {
  const fixture = await seedHostedEvent()

  const visitor = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await visitor.newPage()

  await walkToPayStep(page, fixture.slug)

  // The hosted pay step: what is about to be sent, and one button.
  await expect(
    page.getByRole('heading', { name: 'Send your contribution' }),
  ).toBeVisible()
  await expect(page.getByText('R1 234,56')).toBeVisible()

  // None of Mode A's furniture. There is nothing to copy and nowhere to type it.
  await expect(page.getByText('Nothing is taken from you here')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Copy the reference' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Send my contribution' }).click()

  // Off our origin, as far as this flow is concerned: the provider's own page.
  await expect(page).toHaveURL(/\/dev\/payments/)
  await page.getByRole('button', { name: 'Pay now', exact: true }).click()

  // And back, on the done step.
  await expect(page).toHaveURL(new RegExp(`/e/${fixture.slug}/contribute\\?.*step=done`))
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()

  /*
   * **The payment confirmed itself** (M5-03). The notification reached the
   * receiver while the contributor was being redirected back, the handler
   * confirmed the contribution and appended the ledger entry, and the done step
   * reads the row rather than assuming — so it says the true thing.
   */
  await expect(page.getByText('Your payment went through')).toBeVisible()

  // The record moved: a bead on the strand, on the page anybody with the link
  // can read. Read from the ledger, like everything else on it (M2-06 §5).
  await page.goto(`/e/${fixture.slug}`)
  await expect(page.getByText('Thandi Ngcobo')).toBeVisible()

  // And the organiser's balance, computed from the chain (M3-08 §4).
  const organiser = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const organiserPage = await organiser.newPage()
  await signInOrganiser(organiserPage, fixture.organiserPhone)
  await organiserPage.goto(`/manage/${fixture.eventId}`)

  await expect(organiserPage.getByText('R1 234,56').first()).toBeVisible()

  // Where the money is, said correctly for this mode. The ledger-only sentence
  // would be telling her she already has money she does not have (M3-08 §1).
  await expect(organiserPage.getByText('not yet in your bank account')).toBeVisible()
  await expect(organiserPage.getByText('already in your own account')).toHaveCount(0)

  // Nothing waits for her: a hosted payment never enters the confirmation
  // queue, because a row she can confirm when it is already confirmed is a row
  // she can be wrong about.
  await expect(
    organiserPage.getByRole('button', { name: "Yes, it's in my account" }),
  ).toHaveCount(0)

  // One entry on the chain, whatever the provider retried.
  const prisma = prismaClient()
  try {
    const entries = await prisma.ledgerEntry.findMany({
      where: { eventId: fixture.eventId },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.amountCents).toBe(123_456n)
  } finally {
    await prisma.$disconnect()
  }

  await organiser.close()
  await visitor.close()
})

test('the whole hosted path works with JavaScript disabled', async ({ browser }) => {
  // A form post, a redirect, a form post, a redirect. Nothing on it needs a
  // script, and the one place that would have — an auto-submitting form to a
  // provider — is refused rather than built (M5-02 §4).
  const fixture = await seedHostedEvent()
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: freshAddress(),
  })
  const page = await context.newPage()

  await walkToPayStep(page, fixture.slug)
  await page.getByRole('button', { name: 'Send my contribution' }).click()
  await page.getByRole('button', { name: 'Pay now', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()

  await context.close()
})

test('somebody who changes their mind at the checkout keeps what they typed', async ({
  browser,
}) => {
  const fixture = await seedHostedEvent()
  const context = await browser.newContext({ extraHTTPHeaders: freshAddress() })
  const page = await context.newPage()

  await walkToPayStep(page, fixture.slug)
  await page.getByRole('button', { name: 'Send my contribution' }).click()
  await page.getByRole('button', { name: 'Cancel payment', exact: true }).click()

  // Back on the pay step, not at the start. Hesitating is not a mistake, and
  // making somebody retype their amount and their name is a punishment for it.
  await expect(
    page.getByRole('heading', { name: 'Send your contribution' }),
  ).toBeVisible()
  await expect(page.getByText('R1 234,56')).toBeVisible()

  await context.close()
})
