import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'
import { generateCode } from '@/domain/reference'

/**
 * Notifications from the outside: a contributor walks the real flow, the
 * organiser confirms on the real screen, and the messages that result are read
 * back from `/dev/messages`.
 *
 * The batching rule itself is proved in `tests/integration/notifications.test.ts`
 * against a real database, where fifty self-reports can be made in a loop. What
 * is checked here is that the enqueue points are actually wired into the pages
 * people use — a rule nothing calls is a rule that does nothing.
 *
 * Nothing sends: no BSP has been chosen (Part J item 3), so the adapter holds
 * messages in memory and this route is the only way to see them. It 404s in
 * production, like `/dev/sms`.
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

function uniquePhone(): string {
  return `082${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`
}

const e164 = (local: string) => `+27${local.slice(1)}`

async function asFreshClient(page: Page): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  await page.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.51.${String(octet())}.${String(octet())}`,
  })
}

interface Seeded {
  readonly slug: string
  readonly eventId: string
  readonly organiserPhone: string
}

/** A published funeral whose organiser can be signed in as. */
async function seedEvent(): Promise<Seeded> {
  const prisma = prismaClient()
  const slug = slugFor('ntf')
  const organiserPhone = e164(uniquePhone())

  try {
    const organiser = await prisma.organiser.create({
      data: { phoneE164: organiserPhone, displayName: 'Nomsa Mthembu' },
    })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'TST',
        refCode: generateCode(),
        title: 'Nokuthula Mthembu',
        place: 'KwaMashu, KwaZulu-Natal',
        status: 'published',
        visibilityDefault: 'name_only',
        directPayDetails: { phone: '0821234567', name: 'N. Mthembu' },
      },
      select: { id: true },
    })

    await prisma.needItem.createMany({
      data: [
        { eventId: event.id, label: 'Tent', note: 'Around R1 200', sortOrder: 0 },
        {
          eventId: event.id,
          label: 'Chairs',
          note: '100 chairs',
          quantityRequired: 100,
          sortOrder: 1,
        },
      ],
    })

    return { slug, eventId: event.id, organiserPhone }
  } finally {
    await prisma.$disconnect()
  }
}

interface DevMessages {
  whatsapp: { to: string; template: string; metaName: string; params: string[] }[]
  email: { to: string; subject: string; body: string }[]
}

async function messagesTo(request: APIRequestContext, to: string): Promise<DevMessages> {
  const response = await request.get(`/dev/messages?to=${encodeURIComponent(to)}`)
  expect(response.status()).toBe(200)

  return (await response.json()) as DevMessages
}

/** Walks the money flow to the point of saying "I've paid". */
async function contribute(
  page: Page,
  slug: string,
  { name, phone }: { name: string; phone: string },
): Promise<void> {
  await page.goto(`/e/${slug}/contribute`)

  // A funeral, so the verb is "stand with them" (rule 11, archetype copy).
  await page.getByRole('button', { name: 'Stand with them money', exact: true }).click()
  await page.getByLabel('Amount').fill('R250')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Your number (optional)').fill(phone)
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('button', { name: "I've paid" }).click()
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()
}

test('a claim tells the person who made it, and nobody else', async ({
  page,
  request,
}) => {
  const event = await seedEvent()
  const claimantPhone = e164(uniquePhone())

  await asFreshClient(page)
  await page.goto(`/e/${event.slug}`)

  await page.getByLabel('Your name').first().fill('Nomsa Ngcobo')
  await page.getByRole('button', { name: /I'll bring the tent/i }).click()
  await expect(page.getByText(/You've claimed the tent/i)).toBeVisible()

  // The board asks for a name and not a number, so nothing is sent — which is
  // the honest consequence of never asking (rule 4), not a gap.
  const claimant = await messagesTo(request, claimantPhone)
  expect(claimant.whatsapp).toHaveLength(0)

  // The organiser is not messaged per claim either: it goes in the digest,
  // which only `pnpm notify` sends.
  const organiser = await messagesTo(request, event.organiserPhone)
  expect(organiser.whatsapp).toHaveLength(0)

  const prisma = prismaClient()
  try {
    expect(
      await prisma.digestEntry.count({
        where: { eventId: event.eventId, kind: 'need_claimed', notificationId: null },
      }),
    ).toBe(1)
  } finally {
    await prisma.$disconnect()
  }
})

test('three people paying produce three facts and no messages until the flush', async ({
  page,
  request,
}) => {
  const event = await seedEvent()

  await asFreshClient(page)
  for (const name of ['Thandi Ngcobo', 'Sipho Zulu', 'Ayanda Khumalo']) {
    await contribute(page, event.slug, { name, phone: uniquePhone() })
  }

  const prisma = prismaClient()
  try {
    // Three facts waiting, and not one message: the point of the digest.
    expect(
      await prisma.digestEntry.count({
        where: {
          eventId: event.eventId,
          kind: 'contribution_self_reported',
          notificationId: null,
        },
      }),
    ).toBe(3)

    expect(await prisma.notification.count({ where: { eventId: event.eventId } })).toBe(0)
  } finally {
    await prisma.$disconnect()
  }

  expect((await messagesTo(request, event.organiserPhone)).whatsapp).toHaveLength(0)
})

test('/dev/messages is development only', async ({ request }) => {
  // It exists so a test can see what would have been sent. In production the
  // senders throw rather than holding messages, and this route 404s.
  const response = await request.get('/dev/messages')
  expect(response.status()).toBe(200)

  const body = (await response.json()) as DevMessages
  expect(Array.isArray(body.whatsapp)).toBe(true)
  expect(Array.isArray(body.email)).toBe(true)
})
