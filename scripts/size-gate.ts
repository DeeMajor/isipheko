/**
 * The performance gate. Implementation plan Part G, CLAUDE.md rule 9.
 *
 * Builds nothing and assumes nothing: it starts the **production server**,
 * seeds a published event, fetches the page exactly as a browser would with a
 * cold cache, and adds up what crossed the wire. Then it deletes the fixture.
 *
 * Part G says to measure the Next production build rather than the design
 * prototypes, which carry a preview runtime that will not exist here. It also
 * says to gate on first load even though fonts cache across navigations,
 * because first load is the contributor's experience.
 *
 * Run: `pnpm gate:size` (expects `pnpm build` to have run, and a database).
 */

import { chromium } from '@playwright/test'

import { createHash, randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../src/db/generated/client.ts'
import { appendEntry } from '../src/db/repositories/ledger.ts'
import { fromCents } from '../src/domain/money/index.ts'

/** CLAUDE.md rule 9. The ceiling, not the target. */
const BUDGET_BYTES = 150 * 1024

/** Part G's typical first load: HTML + inline critical CSS + the latin font. */
const EXPECTED_BYTES = 62 * 1024

/** Part G: LCP ≤ 2.5s on throttled 3G. */
const LCP_BUDGET_MS = 2_500

/**
 * M2-06's own allowance: the Ledger Strand at two hundred contributions costs
 * no more than this on the wire, over the same page with none.
 */
const STRAND_BUDGET_BYTES = 15 * 1024

/** The count the done-criteria name, and the top of the three-cord band. */
const STRAND_CONTRIBUTIONS = 200

/** M4-02's done-criterion: the album has to render at four hundred entries. */
const ALBUM_ENTRIES = 400

/**
 * What the album's document may cost at that size, over the wire, with the
 * font.
 *
 * **Not the 150KB ceiling.** That is rule 9's number for the public event page,
 * the one a stranger opens from a WhatsApp link before they have decided
 * anything. The album is opened deliberately, by somebody who already knows the
 * family, and it is four hundred entries long. It still gets a number, because
 * a page with no number grows.
 *
 * Photos are excluded and that is the point: they lazy-load, one request each,
 * and the document is what a reader pays for before any of them arrive.
 *
 * Set at 50KB against a first measurement of **44.6KB** — 18.4KB of brotli'd
 * document plus the font — rather than at the 60KB it was provisionally given.
 * The gap left is for copy, which is what grows: longer messages, longer names.
 * A structural regression is bigger than that and should trip this.
 */
const ALBUM_BUDGET_BYTES = 50 * 1024

const PORT = Number(process.env.GATE_PORT ?? 3210)
const ORIGIN = `http://localhost:${String(PORT)}`
const SLUG = 'SizeGateFixture01'

/** The same page with a full strand on it, measured against the empty one. */
const STRAND_SLUG = 'SizeGateStrand001'

/** The collection page — a public contributor path with the same data cost. */
const COLLECTION_SLUG = 'SizeGateCollect01'

/** The album at four hundred entries, with messages and photos through it. */
const ALBUM_SLUG = 'SizeGateAlbum001'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://isipheko_app:isipheko_local_dev@localhost:5433/isipheko'

function client(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
}

/**
 * A funeral, because it is the page with the most words on it and the needs
 * template has six items. Measuring the cheapest page would be measuring
 * nothing.
 *
 * **The organiser is verified, because since M3-02 a published event cannot
 * exist otherwise**, and **an umkhaphi has accepted**, because a page with
 * nobody standing on it is the empty case rather than the ordinary one. Both
 * are part of what ships, and the gate has to measure the page that ships
 * rather than a page the product can no longer produce.
 */
async function seed(slug = SLUG, refCode = 'S1ZEG8'): Promise<string> {
  const prisma = client()
  try {
    const verifiedAt = new Date('2026-08-12T00:00:00.000Z')
    const organiser = await prisma.organiser.upsert({
      where: { phoneE164: '+27820000199' },
      update: { idVerificationStatus: 'verified', idVerifiedAt: verifiedAt },
      create: {
        phoneE164: '+27820000199',
        displayName: 'Nomsa Mthembu',
        idVerificationStatus: 'verified',
        idVerifiedAt: verifiedAt,
      },
    })

    await prisma.event.deleteMany({ where: { slug } })

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        slug,
        archetype: 'umngcwabo',
        archetypeGroup: 'bereavement',
        refPrefix: 'TST',
        refCode,
        title: 'Nokuthula Mthembu',
        subtitle: 'uMaZondi',
        place: 'KwaMashu, KwaZulu-Natal',
        eventDate: new Date('2026-08-15T00:00:00.000Z'),
        status: 'published',
        visibilityDefault: 'name_only',
      },
      select: { id: true },
    })

    await prisma.needItem.createMany({
      data: [
        ['Tent', 'Around R1 200 to hire'],
        ['Chairs', '100 chairs'],
        ['Meat', '20kg'],
        ['Groceries', 'Mealie meal, rice, sugar, oil'],
        ['Transport', 'One bakkie or a shared taxi'],
        ['Catering pots', 'Big pots and serving dishes'],
      ].map(([label, note], index) => ({
        eventId: event.id,
        label: label ?? '',
        note: note ?? '',
        sortOrder: index,
      })),
    })

    await prisma.witness.createMany({
      data: [
        {
          eventId: event.id,
          name: 'Thandi Ngcobo',
          phoneE164: '+27820000198',
          status: 'accepted',
          acceptedAt: new Date('2026-08-13T00:00:00.000Z'),
        },
        {
          eventId: event.id,
          name: 'Sipho Mthembu',
          phoneE164: '+27820000197',
          status: 'accepted',
          acceptedAt: new Date('2026-08-13T00:00:00.000Z'),
        },
      ],
    })

    return event.id
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Two hundred confirmed contributions on the second fixture, so the strand can
 * be measured at the top of its three-cord band (M2-06).
 *
 * Written through `appendEntry`, so the chain the page reads is a real one with
 * real hashes rather than a shape that happens to render.
 *
 * **This fixture is never deleted, and cannot be.** `ledger_entries` refuses
 * the delete by foreign key and the application role holds no DELETE on it at
 * all (M1-02) — which is the guarantee the whole product rests on, met here by
 * a size gate rather than by an attacker. So it is created once and topped up
 * on later runs instead.
 */
async function seedStrand(): Promise<void> {
  const prisma = client()
  try {
    const existing = await prisma.event.findFirst({
      where: { slug: STRAND_SLUG },
      select: { id: true },
    })

    const eventId = existing?.id ?? (await seed(STRAND_SLUG, 'STR4ND'))

    const already = await prisma.ledgerEntry.count({
      where: { eventId, entryType: 'contribution' },
    })

    for (let index = already; index < STRAND_CONTRIBUTIONS; index += 1) {
      const inKind = index % 4 === 0

      const contribution = await prisma.contribution.create({
        data: {
          eventId,
          contributorName: `Nomusa Ngcobo ${String(index + 1).padStart(3, '0')}`,
          type: inKind ? 'in_kind' : 'cash',
          amountCents: inKind ? null : BigInt(5_000 + index * 900),
          visibility: 'name_only',
          verificationSource: 'organiser_confirmed',
          status: 'confirmed',
          confirmedAt: new Date(),
        },
        select: { id: true },
      })

      await appendEntry(prisma, {
        chain: { eventId },
        entryType: 'contribution',
        direction: 'credit',
        amountCents: inKind ? null : fromCents(BigInt(5_000 + index * 900)),
        inKindDescription: inKind ? 'Chairs × 10' : null,
        referenceId: contribution.id,
        contributionId: contribution.id,
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Four hundred entries, a third of them carrying a message and a fifth a photo.
 *
 * Its own event rather than a topped-up strand fixture: the strand line
 * measures the event page at two hundred, which is its own criterion, and
 * moving that number to serve this one would quietly change what it reports.
 *
 * The photo keys name objects that do not exist. That is deliberate — the album
 * document is what is being measured, and a photo costs bytes here only as the
 * `<picture>` markup that refers to it. What the images themselves cost is the
 * reader's, one lazy request at a time, and is not this budget's business.
 */
async function seedAlbum(): Promise<void> {
  const prisma = client()

  try {
    const existing = await prisma.event.findFirst({
      where: { slug: ALBUM_SLUG },
      select: { id: true },
    })

    const eventId = existing?.id ?? (await seed(ALBUM_SLUG, 'ALBUM1'))

    const already = await prisma.ledgerEntry.count({
      where: { eventId, entryType: 'contribution' },
    })

    for (let index = already; index < ALBUM_ENTRIES; index += 1) {
      const inKind = index % 4 === 0
      const cents = BigInt(5_000 + index * 900)

      // Deterministic, so two runs of the gate measure the same page.
      const digest = createHash('sha256')
        .update(`album-photo-${String(index)}`)
        .digest('hex')
        .slice(0, 32)

      const contribution = await prisma.contribution.create({
        data: {
          eventId,
          contributorName: `Nomusa Ngcobo ${String(index + 1).padStart(3, '0')}`,
          type: inKind ? 'in_kind' : 'cash',
          amountCents: inKind ? null : cents,
          visibility: 'name_only',
          verificationSource: 'organiser_confirmed',
          status: 'confirmed',
          confirmedAt: new Date(),
          message:
            index % 3 === 0
              ? 'Sisemuva kwenu. We are thinking of you and the whole family today.'
              : null,
          ...(index % 5 === 0 && !inKind
            ? {
                photoKey: `photo/${eventId}/${digest}-full.avif`,
                photoWidth: 2400,
                photoHeight: 1600,
              }
            : {}),
        },
        select: { id: true },
      })

      await appendEntry(prisma, {
        chain: { eventId },
        entryType: 'contribution',
        direction: 'credit',
        amountCents: inKind ? null : fromCents(cents),
        inKindDescription: inKind ? 'Chairs × 10' : null,
        referenceId: contribution.id,
        contributionId: contribution.id,
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * A shared collection with a roster, for the collection page's measurement.
 *
 * The organiser is verified **directly**, because that is the only way a
 * collection has a slug at all (rule 13) and because no application path sets
 * it — M3-01 does, and M3-01 does not exist. A fixture script setting fixture
 * state is not a bypass in the product (M2-10).
 */
async function seedCollection(): Promise<void> {
  const prisma = client()

  try {
    const existing = await prisma.collection.findFirst({
      where: { slug: COLLECTION_SLUG },
      select: { id: true },
    })

    if (existing !== null) return

    const organiser = await prisma.organiser.upsert({
      where: { phoneE164: '+27820000198' },
      update: {
        idVerificationStatus: 'verified',
        idVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
      },
      create: {
        phoneE164: '+27820000198',
        displayName: 'Nomsa Mthembu',
        idVerificationStatus: 'verified',
        idVerifiedAt: new Date('2026-07-12T00:00:00.000Z'),
      },
    })

    await prisma.collection.create({
      data: {
        organiserId: organiser.id,
        occasionArchetype: 'umngcwabo',
        occasionArchetypeGroup: 'bereavement',
        title: 'The Ngcobo cousins',
        purpose: 'The Mthembu family',
        organiserBankHint: "Nomsa's Capitec, ending 4471",
        slug: COLLECTION_SLUG,
        status: 'open',
        members: {
          create: Array.from({ length: 8 }, (_, index) => ({
            name: `Member ${String(index + 1)}`,
            amountCents: BigInt(40_000 + index * 5_000),
            status: 'confirmed' as const,
          })),
        },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function unseed(): Promise<void> {
  const prisma = client()
  try {
    // Only the empty fixture. The strand fixture's ledger entries cannot be
    // deleted by this role, and that is the point of them.
    await prisma.event.deleteMany({ where: { slug: SLUG } })
  } finally {
    await prisma.$disconnect()
  }
}

interface Asset {
  readonly what: string
  readonly bytes: number
}

interface RawResponse {
  readonly status: number
  readonly bytes: number
  readonly body: string
  readonly encoding: string
  /** Read for `x-robots-tag`, which M1-09 asserts in both directions. */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
}

/**
 * Counts the bytes that actually cross the wire.
 *
 * `fetch` decompresses transparently, so measuring its body would report the
 * uncompressed size — about four times the truth for HTML, and a gate that is
 * wrong in the safe direction is still a gate reporting a number nobody can
 * check against a browser's network panel. This uses `node:http` directly and
 * counts the raw chunks, with the response body kept only so the document can
 * be parsed for what it references.
 */
function fetchRaw(url: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const call = httpRequest(
      url,
      { headers: { 'accept-encoding': 'br, gzip', 'user-agent': 'isipheko-size-gate' } },
      (response) => {
        let bytes = 0
        const chunks: Buffer[] = []

        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          chunks.push(chunk)
        })
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            bytes,
            body: Buffer.concat(chunks).toString('binary'),
            encoding: response.headers['content-encoding'] ?? 'identity',
            headers: response.headers,
          })
        })
      },
    )

    call.on('error', reject)
    call.end()
  })
}

async function transferred(url: string, what: string): Promise<Asset> {
  const response = await fetchRaw(url)
  if (response.status !== 200) {
    throw new Error(`${url} answered ${String(response.status)}`)
  }

  return { what, bytes: response.bytes }
}

/**
 * Everything the document asks for. If this ever finds a `<script>`, the page
 * has stopped being what it was built to be and the gate says so by name.
 */
function referencedAssets(html: string): {
  css: string[]
  js: string[]
  fonts: string[]
} {
  const attr = (pattern: RegExp) =>
    [...html.matchAll(pattern)].map((match) => match[1] ?? '')

  return {
    css: attr(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g),
    js: attr(/<script[^>]+src="([^"]+)"/g),
    fonts: attr(/url\('([^']+\.woff2)'\)/g),
  }
}

/**
 * Playwright rather than Lighthouse: it is already a dependency, it is less
 * flaky in CI, and reading `largest-contentful-paint` from a
 * `PerformanceObserver` over CDP throttling measures the same number.
 *
 * Slow 3G — 400kbps down, 400ms round trip — which is harsher than Part G's
 * "throttled 3G" and closer to a prepaid bundle in KwaZulu-Natal.
 */
async function measureLcp(url: string): Promise<number> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const client = await page.context().newCDPSession(page)

    await client.send('Network.enable')
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (400 * 1024) / 8,
    })

    await page.addInitScript(() => {
      const store = window as unknown as { __lcp?: number }
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) store.__lcp = entry.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    })

    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(1_500)

    return await page.evaluate(() => (window as unknown as { __lcp?: number }).__lcp ?? 0)
  } finally {
    await browser.close()
  }
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

async function main(): Promise<void> {
  await seed()
  await seedStrand()
  await seedAlbum()
  await seedCollection()

  // `next start` is production, and production has no default environment —
  // every variable is required (M1-01). The gate reads none of the secrets, so
  // it generates throwaway ones rather than asking whoever runs it to hold real
  // key material to measure a page size.
  const key = () => randomBytes(32).toString('base64')

  const server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PORT)], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: ORIGIN,
      DATABASE_URL,
      MIGRATION_DATABASE_URL:
        process.env.MIGRATION_DATABASE_URL ??
        'postgresql://isipheko_owner:isipheko_local_dev@localhost:5433/isipheko',
      BANK_ACCOUNT_ENCRYPTION_KEY: process.env.BANK_ACCOUNT_ENCRYPTION_KEY ?? key(),
      ID_NUMBER_PEPPER: process.env.ID_NUMBER_PEPPER ?? key(),
      OTP_PEPPER: process.env.OTP_PEPPER ?? key(),
    },
    stdio: 'ignore',
  })

  try {
    // Wait for the server rather than guessing at a sleep length.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const probe = await fetch(`${ORIGIN}/e/${SLUG}`)
        if (probe.ok) break
      } catch {
        // not up yet
      }
      await sleep(500)
    }

    const document = await fetchRaw(`${ORIGIN}/e/${SLUG}`)
    if (document.status !== 200) {
      throw new Error(`the page answered ${String(document.status)}`)
    }

    const assets: Asset[] = [
      {
        what: `HTML + inline critical CSS (${document.encoding})`,
        bytes: document.bytes,
      },
    ]

    // Decompressed only to read what it references — the byte count above is
    // the compressed one.
    const plain = await fetch(`${ORIGIN}/e/${SLUG}`)
    const html = await plain.text()

    const referenced = referencedAssets(html)

    for (const href of referenced.css) {
      assets.push(await transferred(new URL(href, ORIGIN).href, `CSS ${href}`))
    }
    for (const src of referenced.js) {
      assets.push(await transferred(new URL(src, ORIGIN).href, `JS ${src}`))
    }

    // M2-04 added one enhancement to this page. It is measured with everything
    // else rather than exempted: the budget is what a contributor downloads,
    // not what we meant them to.
    const enhancement = assets.find((asset) => asset.what.includes('needs-board.js'))
    if (enhancement !== undefined && enhancement.bytes > 20 * 1024) {
      process.stderr.write(
        `The needs-board enhancement is ${kb(enhancement.bytes)}, over its 20KB ceiling.\n`,
      )
      process.exitCode = 1
      return
    }

    // Only the latin face is fetched by an English page — `unicode-range` makes
    // latin-ext lazy (Part G). The worst case is reported beside the total so a
    // page in isiZulu is never a surprise.
    const latin = await transferred(
      `${ORIGIN}/fonts/public-sans-latin.woff2`,
      'Font (latin)',
    )
    assets.push(latin)
    const latinExt = await transferred(
      `${ORIGIN}/fonts/public-sans-latin-ext.woff2`,
      'Font (latin-ext, lazy)',
    )

    const total = assets.reduce((sum, asset) => sum + asset.bytes, 0)
    const worstCase = total + latinExt.bytes

    // The Ledger Strand's own allowance (M2-06): the same page, same fonts,
    // same board, with two hundred beads on it. The difference is the strand.
    const withStrand = await fetchRaw(`${ORIGIN}/e/${STRAND_SLUG}`)
    if (withStrand.status !== 200) {
      throw new Error(`the strand page answered ${String(withStrand.status)}`)
    }
    const strandBytes = withStrand.bytes - document.bytes

    process.stdout.write('\nFirst load of /e/[slug], production build:\n\n')
    for (const asset of assets) {
      process.stdout.write(`  ${kb(asset.bytes).padStart(10)}  ${asset.what}\n`)
    }
    process.stdout.write(`\n  ${kb(total).padStart(10)}  total (English page)\n`)
    process.stdout.write(
      `  ${kb(worstCase).padStart(10)}  worst case, pulling ${latinExt.what}\n`,
    )
    process.stdout.write(`  ${kb(BUDGET_BYTES).padStart(10)}  budget\n\n`)
    process.stdout.write(
      `  ${kb(strandBytes).padStart(10)}  the Ledger Strand at ` +
        `${String(STRAND_CONTRIBUTIONS)} contributions ` +
        `(budget ${kb(STRAND_BUDGET_BYTES)})\n`,
    )

    /*
     * The album at four hundred entries (M4-02).
     *
     * Reported with its own budget rather than measured against rule 9's
     * ceiling: this is not the page a stranger opens from a link, it is the
     * record somebody who already knows the family sits down with. The photos
     * are not in the number — they lazy-load, one request each — so what this
     * says is what a reader pays for before a single picture arrives.
     */
    const album = await fetchRaw(`${ORIGIN}/e/${ALBUM_SLUG}/album`)
    if (album.status !== 200) {
      throw new Error(`the album answered ${String(album.status)}`)
    }

    const albumTotal = album.bytes + latin.bytes
    process.stdout.write(
      `  ${kb(albumTotal).padStart(10)}  /e/[slug]/album at ${String(ALBUM_ENTRIES)} ` +
        `entries (HTML ${kb(album.bytes)} + the latin font, ` +
        `budget ${kb(ALBUM_BUDGET_BYTES)})\n`,
    )

    if (albumTotal > ALBUM_BUDGET_BYTES) {
      process.stderr.write(
        `The album is ${kb(albumTotal)} at ${String(ALBUM_ENTRIES)} entries, over its ` +
          `${kb(ALBUM_BUDGET_BYTES)} budget.\n` +
          'Photos are excluded from this number; the document itself has grown.\n',
      )
      process.exitCode = 1
      return
    }

    // The collection page: same audience, same prepaid bundle, same ceiling.
    const collection = await fetchRaw(`${ORIGIN}/c/${COLLECTION_SLUG}`)
    if (collection.status !== 200) {
      throw new Error(`the collection page answered ${String(collection.status)}`)
    }

    const collectionTotal = collection.bytes + latin.bytes
    process.stdout.write(
      `  ${kb(collectionTotal).padStart(10)}  /c/[slug], first load ` +
        `(HTML ${kb(collection.bytes)} + the latin font)\n\n`,
    )

    if (collectionTotal > BUDGET_BYTES) {
      process.stderr.write(
        `The collection page is ${kb(collectionTotal)}, over the ${kb(BUDGET_BYTES)} ceiling.\n` +
          'It is a public contributor path (rule 9). Do not raise the number.\n',
      )
      process.exitCode = 1
      return
    }

    // The front page (M1-09). No slug, no seed, no session — the one public
    // route a stranger reaches by typing the address, and the first thing many
    // of them ever load from us.
    const home = await fetchRaw(`${ORIGIN}/`)
    if (home.status !== 200) {
      throw new Error(`the home page answered ${String(home.status)}`)
    }

    const homeTotal = home.bytes + latin.bytes
    process.stdout.write(
      `  ${kb(homeTotal).padStart(10)}  /, first load ` +
        `(HTML ${kb(home.bytes)} + the latin font)\n`,
    )

    // It carries no needs board, so unlike `/e/[slug]` it should load no script
    // at all. A single one here means it was converted back to a page and the
    // App Router runtime came with it (Part G.1).
    const homeScripts = referencedAssets(await (await fetch(`${ORIGIN}/`)).text()).js
    if (homeScripts.length > 0) {
      process.stderr.write(
        `The home page loaded ${String(homeScripts.length)} script(s):\n` +
          homeScripts.map((src) => `  ${src}\n`).join('') +
          '\nIt is a route handler rendering static markup and needs none.\n' +
          'A script here means it became a page.tsx again. See Part G.1.\n',
      )
      process.exitCode = 1
      return
    }

    /*
     * The one public route that is **not** noindex, and the assertion runs both
     * ways because a later blanket header is exactly how this breaks.
     *
     * Architecture §10 keeps event and collection pages out of search because a
     * death in the family must not be findable on Google. This page names
     * nobody, and a front door nobody can find is not a front door.
     */
    if (home.headers['x-robots-tag'] !== undefined) {
      process.stderr.write(
        'The home page carries x-robots-tag, and it is the one public page that ' +
          'should not.\nSee docs/decisions.md M1-09 §2.\n',
      )
      process.exitCode = 1
      return
    }

    if (!String(collection.headers['x-robots-tag'] ?? '').includes('noindex')) {
      process.stderr.write(
        'The collection page lost its noindex header (architecture §10).\n',
      )
      process.exitCode = 1
      return
    }

    if (homeTotal > BUDGET_BYTES) {
      process.stderr.write(
        `The home page is ${kb(homeTotal)}, over the ${kb(BUDGET_BYTES)} ceiling.\n` +
          'It is the first thing a stranger loads (rule 9).\n',
      )
      process.exitCode = 1
      return
    }

    process.stdout.write('\n')

    // One script is expected: the ~1.5KB needs-board enhancement from M2-04.
    // Anything else on this route means a framework runtime came back, which is
    // the 174KB regression M1-08 measured and moved the page off a page for.
    const unexpected = referenced.js.filter((src) => !src.endsWith('/needs-board.js'))

    if (unexpected.length > 0) {
      process.stderr.write(
        `This route loaded ${String(unexpected.length)} script(s) it should not:\n` +
          unexpected.map((src) => `  ${src}\n`).join('') +
          '\nIt is served as static HTML from a route handler and carries one small\n' +
          'enhancement. See docs/decisions.md M1-08 and M2-04.\n',
      )
      process.exitCode = 1
      return
    }

    if (strandBytes > STRAND_BUDGET_BYTES) {
      process.stderr.write(
        `The strand costs ${kb(strandBytes)} at ${String(STRAND_CONTRIBUTIONS)} ` +
          `contributions, over its ${kb(STRAND_BUDGET_BYTES)} allowance (M2-06).\n` +
          'The beads are declared markup, so this grows with the number of people\n' +
          'who stood with the family. Make each bead cheaper, not the budget bigger.\n',
      )
      process.exitCode = 1
      return
    }

    if (worstCase > BUDGET_BYTES) {
      process.stderr.write(
        `OVER BUDGET by ${kb(worstCase - BUDGET_BYTES)}.\n\n` +
          'The 150KB ceiling is CLAUDE.md rule 9. It is there because a contributor\n' +
          'in KwaZulu-Natal pays for these kilobytes out of a prepaid bundle. Do not\n' +
          'raise the number to make this pass.\n',
      )
      process.exitCode = 1
      return
    }

    if (total > EXPECTED_BYTES) {
      process.stdout.write(
        `Inside the ceiling, but above Part G's ${kb(EXPECTED_BYTES)} typical first load. ` +
          'Worth a look.\n\n',
      )
    }

    const lcp = await measureLcp(`${ORIGIN}/e/${SLUG}`)
    process.stdout.write(
      `Largest contentful paint on slow 3G: ${(lcp / 1000).toFixed(2)}s ` +
        `(budget ${(LCP_BUDGET_MS / 1000).toFixed(1)}s)\n\n`,
    )

    if (lcp > LCP_BUDGET_MS) {
      process.stderr.write(
        'OVER THE PAINT BUDGET. The page took longer than 2.5s to show its largest\n' +
          'element on a 400kbps connection with a 400ms round trip. Part G.\n',
      )
      process.exitCode = 1
      return
    }

    process.stdout.write('Within budget.\n\n')
  } finally {
    server.kill('SIGTERM')
    await unseed()
  }
}

await main()
