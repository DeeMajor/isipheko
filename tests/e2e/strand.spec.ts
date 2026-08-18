import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'
import { entryHash, genesisPrevHash } from '@/domain/ledger'
import { fromCents } from '@/domain/money'
import { generateCode } from '@/domain/reference'

/**
 * The Ledger Strand on a real page, in a real browser.
 *
 * What can only be checked here: that a bead opens **with JavaScript disabled**
 * — the beads are submit buttons in a GET form, so opening one is a server
 * round-trip like everything else on this page — that the strand is a list to
 * assistive technology, that it is keyboard reachable, and that axe is clean at
 * 375px on a funeral, which is the page that must not be got wrong.
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

interface Person {
  readonly name: string
  readonly cents: bigint | null
  readonly item: string | null
  readonly message?: string
  readonly anonymous?: boolean
}

/**
 * A published event with a chain of confirmed contributions.
 *
 * Written straight to the database, hashes and all, rather than walking the
 * contribution flow four hundred times. The chain is built the way the
 * repository builds it, so the page under test is reading a chain that would
 * verify.
 */
async function seedStrand({
  slug,
  people,
  archetype = 'umngcwabo',
}: {
  slug: string
  people: readonly Person[]
  archetype?: 'umngcwabo' | 'umshado'
}): Promise<void> {
  const prisma = prismaClient()

  try {
    const organiser = await prisma.organiser.upsert({
      where: { phoneE164: '+27820000399' },
      update: {},
      create: { phoneE164: '+27820000399', displayName: 'Nomsa Mthembu' },
    })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        archetype,
        archetypeGroup: archetype === 'umngcwabo' ? 'bereavement' : 'union',
        refPrefix: 'TST',
        refCode: generateCode(),
        title: archetype === 'umngcwabo' ? 'Nokuthula Mthembu' : 'Lindiwe & Sipho',
        place: 'KwaMashu, KwaZulu-Natal',
        status: 'published',
        visibilityDefault: archetype === 'umngcwabo' ? 'name_only' : 'public',
      },
      select: { id: true },
    })

    let prevHash = genesisPrevHash(event.id)

    for (const [index, person] of people.entries()) {
      const createdAt = new Date(Date.UTC(2026, 7, 1, 8, index % 50))
      const inKind = person.item

      const contribution = await prisma.contribution.create({
        data: {
          eventId: event.id,
          contributorName: person.name,
          type: inKind === null ? 'cash' : 'in_kind',
          amountCents: person.cents,
          message: person.message ?? null,
          visibility: person.anonymous === true ? 'anonymous' : 'public',
          verificationSource: 'organiser_confirmed',
          status: 'confirmed',
          confirmedAt: createdAt,
        },
        select: { id: true },
      })

      const fields = {
        sequenceNo: index + 1,
        entryType: 'contribution' as const,
        direction: 'credit' as const,
        amountCents: person.cents === null ? null : fromCents(person.cents),
        inKindDescription: inKind,
        referenceId: contribution.id,
        contributionId: contribution.id,
        prevHash,
        createdAt,
      }

      const hash = entryHash(fields)

      await prisma.ledgerEntry.create({
        data: {
          eventId: event.id,
          sequenceNo: fields.sequenceNo,
          entryType: fields.entryType,
          direction: fields.direction,
          amountCents: fields.amountCents,
          inKindDescription: fields.inKindDescription,
          referenceId: fields.referenceId,
          contributionId: fields.contributionId,
          prevHash,
          entryHash: hash,
          createdAt,
        },
      })

      prevHash = hash
    }
  } finally {
    await prisma.$disconnect()
  }
}

/** Letters rather than numbers, so a fixture name can never read as a count. */
function letters(index: number): string {
  let name = ''
  let remaining = index

  do {
    name = String.fromCharCode(65 + (remaining % 26)) + name
    remaining = Math.floor(remaining / 26) - 1
  } while (remaining >= 0)

  return name
}

/** A strand of `count` people, cash and in-kind mixed. */
function crowd(count: number): Person[] {
  return Array.from({ length: count }, (_, index) => {
    const inKind = index % 4 === 0

    return {
      name: `Person ${letters(index)}`,
      cents: inKind ? null : BigInt(5_000 + index * 900),
      item: inKind ? 'Chairs' : null,
    }
  })
}

test('renders a bead for every contribution, as a list', async ({ page }) => {
  const slug = slugFor('str')
  await seedStrand({
    slug,
    people: [
      { name: 'Thandi Ngcobo', cents: 20_000n, item: null, message: 'Sengikhona.' },
      { name: 'Sipho Zulu', cents: null, item: 'Tent' },
      { name: 'Quiet giver', cents: 5_000n, item: null, anonymous: true },
    ],
  })

  await page.goto(`/e/${slug}`)

  const strand = page.locator('.strand')
  await expect(strand).toHaveAttribute('class', /strandCord/)
  await expect(strand.locator('li')).toHaveCount(3)

  await expect(strand.getByText('Thandi Ngcobo')).toBeVisible()
  await expect(strand.getByText('Sipho Zulu')).toBeVisible()
  // Somebody who gave quietly keeps their bead and loses their name.
  await expect(strand.getByText('Someone')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Quiet giver')
})

test('shows no total, no count and no amount', async ({ page }) => {
  const slug = slugFor('ntl')
  await seedStrand({ slug, people: crowd(40) })

  await page.goto(`/e/${slug}`)

  const strandText = (await page.locator('#strand').innerText()).toLowerCase()

  expect(strandText).not.toContain('total')
  expect(strandText).not.toContain('target')
  expect(strandText).not.toContain('raised')
  expect(strandText).not.toMatch(/r\s?\d/)
  // Nowhere on the strand is the number of people written down.
  expect(strandText).not.toMatch(/\b40\b/)
  await expect(page.locator('#strand progress')).toHaveCount(0)
})

test('opens a bead with JavaScript disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  const slug = slugFor('njb')
  await seedStrand({
    slug,
    people: [
      { name: 'Thandi Ngcobo', cents: 20_000n, item: null, message: 'Sengikhona.' },
      { name: 'Sipho Zulu', cents: null, item: 'Tent' },
    ],
  })

  await page.goto(`/e/${slug}`)
  await expect(page.getByText('Sengikhona.')).toHaveCount(0)

  await page.locator('.strand button').first().click()

  // A server round-trip, like every other interaction on this page.
  await expect(page).toHaveURL(/[?&]bead=/)
  await expect(page.getByText('Sengikhona.')).toBeVisible()
  await expect(page.locator('button[aria-expanded="true"]')).toHaveCount(1)

  // And it closes again from the same button.
  await page.locator('.strand button').first().click()
  await expect(page.getByText('Sengikhona.')).toHaveCount(0)

  await context.close()
})

test('braids past thirty and stays a list', async ({ page }) => {
  const slug = slugFor('brd')
  await seedStrand({ slug, people: crowd(200) })

  await page.goto(`/e/${slug}`)

  await expect(page.locator('.strandBraid')).toBeVisible()
  await expect(page.locator('.strand li')).toHaveCount(200)

  // Every bead is a real control with a 44px hit area, however small the disc.
  const box = await page.locator('.strand button').first().boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(44)
  expect(box?.height).toBeGreaterThanOrEqual(44)
})

test('is keyboard reachable and opens on Enter', async ({ page }) => {
  const slug = slugFor('kbd')
  await seedStrand({
    slug,
    people: [
      { name: 'Thandi Ngcobo', cents: 20_000n, item: null, message: 'Sengikhona.' },
    ],
  })

  await page.goto(`/e/${slug}`)

  await page.locator('.strand button').first().focus()
  await expect(page.locator('.strand button').first()).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByText('Sengikhona.')).toBeVisible()
})

test('is axe clean at 375px, on a funeral and on a wedding', async ({ page }) => {
  for (const archetype of ['umngcwabo', 'umshado'] as const) {
    const slug = slugFor(archetype === 'umngcwabo' ? 'axf' : 'axw')
    await seedStrand({ slug, people: crowd(40), archetype })

    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(`/e/${slug}?bead=`)

    const results = await new AxeBuilder({ page }).include('#strand').analyze()
    expect(results.violations).toEqual([])
  }
})

test('a funeral gets one bead size and no motion', async ({ page }) => {
  const slug = slugFor('ber')
  await seedStrand({ slug, people: crowd(12) })

  await page.goto(`/e/${slug}`)

  const diameters = await page
    .locator('.beadDot')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).width))

  // Amounts are hidden on a bereavement page, and four monotonic diameters
  // would put them back (architecture §7.3).
  expect(new Set(diameters).size).toBe(1)

  const animations = await page
    .locator('.beadMark')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).animationName))
  expect(new Set(animations)).toEqual(new Set(['none']))
})
