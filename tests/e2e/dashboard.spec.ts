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
 * The organiser's dashboard end to end (M3-08).
 *
 * Three things it has to prove:
 *
 * 1. **Confirm and mark-delivered are the two easiest actions on the page** —
 *    one queue at the top, both actions in it, and both working with
 *    JavaScript switched off.
 * 2. **Every unmet condition shows a concrete next step**, on the real screen
 *    rather than in a render test.
 * 3. **Nothing offers a payout**, because there is none to offer.
 *
 * The session is written directly rather than driven through the OTP screens,
 * for the reason `review.spec.ts` gives: `sign-in.spec.ts` is what proves
 * signing in works, and spending a one-time code here would make this file fail
 * on a rate limit rather than on anything it is about.
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

const uniquePhone = () =>
  `+2784${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`

async function asFreshClient(page: Page): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  await page.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.51.${String(octet())}.${String(octet())}`,
  })
}

interface Seeded {
  readonly eventId: string
  readonly organiserId: string
  readonly token: string
}

/**
 * A published umcimbi with everything the dashboard reads: a payment somebody
 * has reported, a claimed-not-delivered item, an untaken item, a suggestion,
 * and a confirmed contribution old enough to be past the hold.
 */
async function seedEvent({
  archetype = 'umngcwabo',
  archetypeGroup = 'bereavement',
  verified = true,
}: {
  archetype?: string
  archetypeGroup?: string
  verified?: boolean
} = {}): Promise<Seeded> {
  const prisma = prismaClient()
  const token = generateSessionToken()
  const now = new Date()

  try {
    const organiser = await prisma.organiser.create({
      data: {
        phoneE164: uniquePhone(),
        displayName: 'Nomsa Mthembu',
        idVerificationStatus: verified ? 'verified' : 'unverified',
        idVerifiedAt: verified ? new Date('2026-07-12T00:00:00.000Z') : null,
      },
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

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug: slugFor('dsh'),
        archetype: archetype as never,
        archetypeGroup: archetypeGroup as never,
        refPrefix: 'MTH',
        refCode: refCode(),
        title: 'Nokuthula Mthembu',
        place: 'KwaMashu',
        eventDate: new Date('2026-08-15T00:00:00.000Z'),
        status: 'published',
        directPayDetails: { phone: '0821234567', name: 'N Mthembu' },
      },
    })

    await prisma.witness.create({
      data: { eventId: event.id, name: 'Sipho Mthembu', phoneE164: uniquePhone() },
    })

    // Somebody has said they paid, and is waiting to be believed.
    await prisma.contribution.create({
      data: {
        eventId: event.id,
        contributorName: 'Thandi Ngcobo',
        type: 'cash',
        amountCents: 500_00n,
        refPrefix: 'MTH',
        refCode: refCode(),
        status: 'pending',
        selfReportedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        verificationSource: 'organiser_confirmed',
      },
    })

    const [tent, transport] = await prisma.$transaction([
      prisma.needItem.create({
        data: { eventId: event.id, label: 'Tent', quantityRequired: 1, sortOrder: 1 },
      }),
      prisma.needItem.create({
        data: {
          eventId: event.id,
          label: 'Transport from Johannesburg',
          quantityRequired: 1,
          sortOrder: 2,
        },
      }),
    ])

    // Claimed and not here yet — invisible on the public board, and exactly the
    // thing that does not arrive.
    await prisma.needItem.update({
      where: { id: tent.id },
      data: { quantityClaimed: 1 },
    })
    await prisma.needClaim.create({
      data: {
        needItemId: tent.id,
        quantity: 1,
        claimantName: 'Musa Khumalo',
        status: 'claimed',
      },
    })

    // Something the family forgot, which nothing could show until this screen.
    await prisma.needItem.create({
      data: {
        eventId: event.id,
        label: 'Ice',
        note: 'For the drinks',
        quantityRequired: 1,
        sortOrder: 999,
        status: 'suggested',
        suggestedByName: 'MaDlamini',
      },
    })

    expect(transport.label).toContain('Transport')

    return { eventId: event.id, organiserId: organiser.id, token }
  } finally {
    await prisma.$disconnect()
  }
}

async function signIn(page: Page, token: string): Promise<void> {
  await page.context().addCookies([
    {
      name: sessionCookieName(false),
      value: token,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

test('the queue leads the page and both actions are one tap', async ({ page }) => {
  await asFreshClient(page)
  const seeded = await seedEvent()
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)

  await expect(page.getByRole('heading', { name: 'Waiting for you' })).toBeVisible()

  // Leading the page: the queue's heading comes before every other section's.
  const headings = await page.getByRole('heading', { level: 2 }).allTextContents()
  expect(headings[0]).toBe('Waiting for you')

  // Both kinds in one list.
  await expect(page.getByText('Thandi Ngcobo says they sent R500,00')).toBeVisible()
  await expect(page.getByText('Musa Khumalo is bringing the tent')).toBeVisible()

  // And what to check it against in her own banking app.
  await expect(page.getByText('T NGCOBO')).toBeVisible()

  await expect(
    page.getByRole('button', { name: "Yes, it's in my account" }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'It has arrived' })).toBeVisible()
})

test('confirming and marking delivered both work with JavaScript disabled', async ({
  browser,
}) => {
  // Rule 5's posture on the organiser side. These are the two actions of her
  // day, and a phone with a failed script bundle must not lose them.
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  try {
    await asFreshClient(page)
    const seeded = await seedEvent()
    await signIn(page, seeded.token)

    await page.goto(`/manage/${seeded.eventId}`)

    await page.getByRole('button', { name: "Yes, it's in my account" }).click()
    await expect(page.getByText('Recorded on the ledger.')).toBeVisible()

    await page.getByRole('button', { name: 'It has arrived' }).first().click()
    await expect(page.getByText('Recorded on the ledger.')).toBeVisible()

    // Both are off the queue, and the record now has two beads on it.
    await expect(
      page.getByRole('heading', { name: 'Nothing is waiting for you' }),
    ).toBeVisible()
    await expect(page.getByText('put the phone down')).toBeVisible()
  } finally {
    await context.close()
  }
})

test('the board separates what is promised from what nobody has taken', async ({
  page,
}) => {
  await asFreshClient(page)
  const seeded = await seedEvent()
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)

  await expect(page.getByText('Nobody has taken this', { exact: true })).toBeVisible()
  await expect(page.getByText('Promised, not yet here')).toBeVisible()
  await expect(page.getByText('Promised by Musa Khumalo')).toBeVisible()
  await expect(page.getByText('Transport from Johannesburg')).toBeVisible()
})

test('a suggestion is visible, and answering it works with no script', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  try {
    await asFreshClient(page)
    const seeded = await seedEvent()
    await signIn(page, seeded.token)

    await page.goto(`/manage/${seeded.eventId}`)

    await expect(page.getByText('Someone suggested this')).toBeVisible()
    await expect(page.getByText('Suggested by MaDlamini')).toBeVisible()

    await page.getByRole('button', { name: 'Add it to the list' }).click()
    await expect(page.getByText('Your list has been updated.')).toBeVisible()

    // It is on her list now, and no longer a suggestion.
    await expect(page.getByText('Someone suggested this')).toHaveCount(0)
    await expect(page.getByText('Ice')).toBeVisible()
  } finally {
    await context.close()
  }
})

test('the money is never presented as a balance we hold', async ({ page }) => {
  await asFreshClient(page)
  const seeded = await seedEvent()
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)

  await expect(page.getByText('already in your own account')).toBeVisible()

  const body = (await page.textContent('body')) ?? ''
  expect(body).not.toContain('Ready to pay out')
  expect(body.toLowerCase()).not.toContain('request r')

  // Nothing on the page requests a payout, at any state.
  await expect(page.getByRole('button', { name: /request/i })).toHaveCount(0)
})

test('every unmet condition shows a concrete next step', async ({ page }) => {
  await asFreshClient(page)
  // Unverified, so the one condition with a real action is the one unmet.
  const seeded = await seedEvent({ verified: false })
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)

  await expect(page.getByText('Your name needs verifying')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Verify my name' })).toBeVisible()

  // Bank: Part F's wording, and the honest half — she cannot do it yet.
  await expect(page.getByText('Your bank account needs verifying')).toBeVisible()
  await expect(
    page.getByText('check it against your verified name with your bank'),
  ).toBeVisible()
  await expect(page.getByText('the check is not connected')).toBeVisible()

  // The R1 test deposit from the design file is nowhere on the page.
  const body = (await page.textContent('body')) ?? ''
  expect(body).not.toMatch(/\bR1\b/)
})

test('a funeral dashboard carries no countdown and no accent', async ({ page }) => {
  /*
   * `design/dashboard.html` sets *"in 4 days"* on its bereavement variant, which
   * rule 1 forbids. And rule 2: bereavement declares no accent, so the theme
   * wrapper sets nothing and every `var(--accent, #16233D)` resolves to indigo
   * on its own.
   */
  await asFreshClient(page)
  const seeded = await seedEvent()
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)

  const body = (await page.textContent('body')) ?? ''
  expect(body).not.toMatch(/\bin \d+ (days?|weeks?)\b/)
  expect(body).toContain('Saturday, 15 August')
  expect(body).toContain('KwaMashu')

  const themed = page.locator('[data-archetype="umngcwabo"]')
  await expect(themed).toHaveAttribute('data-archetype', 'umngcwabo')
  expect(await themed.evaluate((node) => node.getAttribute('style'))).toBeNull()
})

test('a wedding dashboard takes its accent from the config', async ({ page }) => {
  // The control. Without it, "no accent on bereavement" would also pass on a
  // page where the theme wrapper was never rendered at all.
  await asFreshClient(page)
  const seeded = await seedEvent({ archetype: 'umshado', archetypeGroup: 'union' })
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)

  const themed = page.locator('[data-archetype="umshado"]')
  expect(await themed.evaluate((node) => node.getAttribute('style'))).toContain('#8C2F22')
})

test('the dashboard has no accessibility violations', async ({ page }) => {
  await asFreshClient(page)
  const seeded = await seedEvent()
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

/**
 * The way back (UX-04). `/account` used to list nothing, so the confirmation
 * queue — the only screen where Mode A money is confirmed — was reachable
 * solely from a bookmark. This is the ordinary return visit: sign in, find the
 * umcimbi, open it, and from there reach the page itself.
 */
test('a returning organiser reaches her umcimbi from the account screen', async ({
  page,
}) => {
  await asFreshClient(page)
  const seeded = await seedEvent()
  await signIn(page, seeded.token)

  await page.goto('/account')

  await expect(page.getByRole('heading', { name: 'Your imicimbi' })).toBeVisible()
  await expect(page.getByText('Nokuthula Mthembu')).toBeVisible()
  await page.getByRole('link', { name: 'Open it' }).click()

  // The dashboard, with its queue — and the way out to the page itself.
  await expect(page).toHaveURL(new RegExp(`/manage/${seeded.eventId}$`))
  await expect(page.getByRole('heading', { name: 'Waiting for you' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open the public page' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Send the link again' })).toBeVisible()
})

/**
 * The release (UX-05). `needsCopy.tooLateBody` has told contributors since
 * M2-04 to "ask the family to release it" — and no screen could. The only
 * exits from a claim that would never arrive were the seven-day lapse, or
 * marking a tent arrived that was not, which writes a false in-kind entry
 * onto the append-only chain.
 */
test('a claim that is no longer coming can be released back to the list', async ({
  page,
}) => {
  await asFreshClient(page)
  const seeded = await seedEvent()
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)

  // Musa holds the tent, and the quiet action beside "Mark as arrived".
  await expect(page.getByText('Promised by Musa Khumalo')).toBeVisible()
  await page.getByRole('button', { name: 'Release it back to the list' }).click()

  await expect(
    page.getByText('Put back on the list. Somebody else can take it now.'),
  ).toBeVisible()

  // The tent is a gap again, held by nobody, and no false arrival was written.
  await expect(page.getByText('Promised by Musa Khumalo')).not.toBeVisible()
  const board = page.locator('section, div').filter({ hasText: 'Where things stand' })
  expect(await board.count()).toBeGreaterThan(0)
  await expect(page.getByText('Nobody has taken this yet').first()).toBeVisible()
})

/**
 * The edit the setup flow always promised (UX-07). "Three things, and you can
 * change any of them later" shipped with no screen behind it, so a misspelled
 * name of the deceased on a published funeral page was uncorrectable — the
 * exact fix M2-07 §2's card versioning was built to survive and then waited
 * four milestones to receive.
 */
test('the details of a published umcimbi can be corrected', async ({ page }) => {
  await asFreshClient(page)
  const seeded = await seedEvent()
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)
  await page.getByRole('link', { name: 'Change the details' }).click()

  // Prefilled with what stands, so a correction is an edit rather than a
  // retype.
  const title = page.getByLabel('Her name, or his name')
  await expect(title).toHaveValue('Nokuthula Mthembu')
  await title.fill('Nokuthula MaZondi Mthembu')
  await page.getByRole('button', { name: 'Save the changes' }).click()

  // Back where she came from, told it took.
  await expect(page).toHaveURL(new RegExp(`/manage/${seeded.eventId}\\?details=1$`))
  await expect(page.getByText('Saved. The page shows it now.')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Nokuthula MaZondi Mthembu' }),
  ).toBeVisible()

  // And the public page says it too.
  const prisma = prismaClient()
  try {
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: seeded.eventId },
      select: { slug: true },
    })
    await page.goto(`/e/${event.slug}`)
    await expect(
      page.getByRole('heading', { name: 'Nokuthula MaZondi Mthembu' }),
    ).toBeVisible()
  } finally {
    await prisma.$disconnect()
  }
})

/**
 * The payment path is validated and read back (UX-13). This field is what
 * every contributor is told to pay — Mode A has no rail — and nothing checked
 * it: any string at all became the number on the pay screen, and a typo was
 * money to a stranger (M2-05 §1's unrecoverable failure).
 */
test('a pay number nobody could pay is refused, and a saved one is read back', async ({
  page,
}) => {
  await asFreshClient(page)
  const seeded = await seedEvent()
  await signIn(page, seeded.token)

  await page.goto(`/manage/${seeded.eventId}`)

  // Garbage is refused, and the message says the old number still shows.
  await page.getByLabel('Your PayShap number or cellphone number').fill('not a number')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByText('does not look like a South African cellphone number'),
  ).toBeVisible()

  // A real number saves, and the confirmation reads it back with the one
  // check that matters: her own banking app.
  await page.getByLabel('Your PayShap number or cellphone number').fill('083 555 1234')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByText('Contributors will be told to pay 083 555 1234'),
  ).toBeVisible()
})

/**
 * The suggestion pipe, end to end at last (UX-19).
 *
 * `suggestItem` was built and tested in M2-04 with no screen anywhere. M3-08
 * found the organiser's half unreachable and built the board group that
 * answers suggestions — and the contributor's half stayed unbuilt, so the
 * group could never populate through the product. This walks the whole pipe:
 * a stranger asks, the family answers, the list grows.
 */
test('a contributor suggests something, and the family puts it on the list', async ({
  browser,
  page,
}) => {
  await asFreshClient(page)
  const seeded = await seedEvent()

  const prisma = prismaClient()
  let slug = ''
  try {
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: seeded.eventId },
      select: { slug: true },
    })
    slug = event.slug
  } finally {
    await prisma.$disconnect()
  }

  // A stranger, no session, on the public page.
  const visitorContext = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: {
      'cf-connecting-ip': `198.51.${String(Math.floor(Math.random() * 254) + 1)}.${String(Math.floor(Math.random() * 254) + 1)}`,
    },
  })
  const visitor = await visitorContext.newPage()
  await visitor.goto(`/e/${slug}`)

  await expect(visitor.getByText('Is something missing?')).toBeVisible()
  await visitor.getByLabel('What is missing').fill('Firewood')
  await visitor.getByLabel('Your name', { exact: true }).last().fill('Bongani Zulu')
  await visitor.getByRole('button', { name: 'Suggest it' }).click()

  // Told the truth about what happens next: nothing, until the family says.
  await expect(visitor.getByText('The family has it')).toBeVisible()
  await expect(visitor.getByText('not on the list until they say so')).toBeVisible()

  // Invisible to the next stranger.
  const onlooker = await browser.newPage()
  await onlooker.goto(`/e/${slug}`)
  await expect(onlooker.getByText('Firewood')).not.toBeVisible()
  await onlooker.close()

  // The organiser sees it, with the name, and puts it on the list.
  await signIn(page, seeded.token)
  await page.goto(`/manage/${seeded.eventId}`)
  await expect(page.getByText('Suggested by Bongani Zulu')).toBeVisible()

  const firewood = page
    .locator('li')
    .filter({ hasText: 'Firewood' })
    .filter({ hasText: 'Bongani Zulu' })
  await firewood.getByRole('button', { name: 'Add it to the list' }).click()
  await expect(page.getByText('Your list has been updated.')).toBeVisible()

  // And now the world can see it and claim it.
  await visitor.goto(`/e/${slug}`)
  await expect(visitor.getByText('Firewood', { exact: true })).toBeVisible()
  await expect(
    visitor.getByRole('button', { name: "I'll bring the firewood" }),
  ).toBeVisible()

  await visitorContext.close()
})
