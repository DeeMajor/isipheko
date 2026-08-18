import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { PrismaClient } from '@/db/generated/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * Setting up an umcimbi, end to end, as somebody actually would: sign in with a
 * code, choose a funeral, fill in the details, edit the pre-filled list, ask an
 * umkhaphi, walk past the verification step, publish, and open the page.
 *
 * The funeral is the variant under test throughout, because it is the one where
 * getting it wrong is not recoverable.
 */

/**
 * A draft's slug is deliberately not shown anywhere before it is published, so
 * the only way to test that the public route refuses one is to read it from the
 * database the dev server is using.
 */
async function draftSlug(eventId: string): Promise<string> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://isipheko_app:isipheko_local_dev@localhost:5433/isipheko',
    }),
  })

  try {
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { slug: true, status: true },
    })
    expect(event.status).toBe('draft')
    return event.slug
  } finally {
    await prisma.$disconnect()
  }
}

function uniquePhone(): string {
  const suffix = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')
  return `082${suffix}`
}

const e164 = (local: string) => `+27${local.slice(1)}`

/** Each test is its own client — see tests/e2e/sign-in.spec.ts. */
async function asFreshClient(page: Page): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1
  await page.setExtraHTTPHeaders({
    'cf-connecting-ip': `198.51.${String(octet())}.${String(octet())}`,
  })
}

async function signIn(page: Page, request: APIRequestContext): Promise<void> {
  const phone = uniquePhone()

  await page.goto('/sign-in')
  await page.getByLabel('Your phone number').fill(phone)
  await page.getByRole('button', { name: 'Send me a code' }).click()
  // Wait for the action to have run: reading /dev/sms before the redirect
  // lands returns 404, and an empty code then fails for the wrong reason.
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible()

  const response = await request.get(`/dev/sms?phone=${encodeURIComponent(e164(phone))}`)
  const { body } = (await response.json()) as { body: string }
  const code = /\b(\d{6})\b/.exec(body)?.[1] ?? ''

  await page.getByLabel('The six-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign me in' }).click()
  await expect(page).toHaveURL(/\/account$/)
}

/** Walks the six steps for a funeral and returns the published page's URL. */
async function setUpFuneral(page: Page): Promise<string> {
  await page.goto('/create?kind=umngcwabo')
  await page.getByRole('button', { name: 'Continue with funeral' }).click()

  await expect(page.getByRole('heading', { name: 'About her, or him' })).toBeVisible()
  await page.getByLabel('Her name, or his name').fill('Nokuthula Mthembu')
  await page.getByLabel('Clan name (optional)').fill('uMaZondi')
  await page.getByLabel('Your name').fill('Nomsa Mthembu')
  await page.getByLabel('Where').fill('KwaMashu, KwaZulu-Natal')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: "What's needed" })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Who stands with you?' })).toBeVisible()
  await page.getByLabel('Their name').fill('Thandi Ngcobo')
  await page.getByLabel('Their number').fill('0821234567')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(
    page.getByRole('heading', { name: 'One check, then you can share it' }),
  ).toBeVisible()
  await verifyHere(page)
  await page.getByRole('button', { name: 'Carry on' }).click()

  await expect(page.getByRole('heading', { name: "It's ready. Send it." })).toBeVisible()
  await page.getByRole('button', { name: 'Publish and get the link' }).click()

  // The link lives in a readonly field the share step's copy button reads
  // (M2-07), not in a paragraph.
  const link = page.locator('[data-copy-source]')
  await expect(link).toBeVisible()

  return ((await link.inputValue()) ?? '').trim()
}

/**
 * A valid South African ID number with a random date of birth.
 *
 * The sequence block is `0000`, which the in-memory verifier answers verified
 * on the first call (M3-01) — so these specs, whose subject is publishing and
 * sharing, do not spend twenty seconds each reloading a pending page. The
 * polling path is exercised where it is the subject, in `verify.spec.ts`.
 *
 * The date varies because one identity means one account and this suite runs
 * against a database that outlives the run.
 */
function idNumber(): string {
  const year = String(Math.floor(Math.random() * 100)).padStart(2, '0')
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')
  const first12 = `${year}${month}${day}000008`

  let sum = 0
  let double = true
  for (let index = first12.length - 1; index >= 0; index -= 1) {
    let digit = first12.charCodeAt(index) - 48
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }

  return first12 + String((10 - (sum % 10)) % 10)
}

/** Runs the identity check on step five and waits for it to come back. */
async function verifyHere(page: Page): Promise<void> {
  await page.getByLabel('Your ID number').fill(idNumber())
  await page.getByText('I have read this and I agree to the check').click()
  await page.getByRole('button', { name: 'Run the check' }).click()

  await expect(page.getByText('You are verified').first()).toBeVisible()
}

test('creates an umcimbi and publishes it', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)

  const url = await setUpFuneral(page)
  const slug = url.split('/e/')[1] ?? ''

  // Architecture §10: ≥16 base62 characters, never sequential.
  expect(slug).toMatch(/^[0-9A-Za-z]{16,}$/)

  await page.goto(`/e/${slug}`)
  await expect(page.getByRole('heading', { name: 'Nokuthula Mthembu' })).toBeVisible()
  await expect(page.getByText('uMaZondi')).toBeVisible()
  await expect(page.getByText('Organised by Nomsa Mthembu')).toBeVisible()

  // The badge she earned two steps earlier, on the page her relatives open.
  await expect(page.locator('header .verified')).toContainText('ID verified')
})

test('will not publish an unverified umcimbi, and explains rather than demands', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  await signIn(page, request)

  await page.goto('/create?kind=umngcwabo')
  await page.getByRole('button', { name: 'Continue with funeral' }).click()
  await page.getByLabel('Her name, or his name').fill('Nokuthula Mthembu')
  await page.getByLabel('Your name').fill('Nomsa Mthembu')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: "What's needed" })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Who stands with you?' })).toBeVisible()
  await page.getByLabel('Their name').fill('Thandi Ngcobo')
  await page.getByLabel('Their number').fill('0821234567')
  await page.getByRole('button', { name: 'Continue' }).click()

  // Straight past the check, which is exactly what the gate is for.
  await expect(
    page.getByRole('heading', { name: 'One check, then you can share it' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Continue to sharing' }).click()

  const eventId = page.url().split('/create/')[1]?.split('/')[0] ?? ''
  await page.getByRole('button', { name: 'Publish and get the link' }).click()

  await expect(page).toHaveURL(/error=not-verified/)
  await expect(page.getByText('your name has to be confirmed')).toBeVisible()

  // The answer to "why can't I skip this?" is on this screen, closed until
  // asked for, and it explains rather than instructs (M3-02).
  const why = page.getByRole('group').filter({ hasText: "Why can't I skip this?" })
  await expect(why).toBeVisible()
  await expect(page.getByText('Anyone can make a page in ten minutes')).toBeHidden()
  await page.getByText("Why can't I skip this?").click()
  await expect(page.getByText('Anyone can make a page in ten minutes')).toBeVisible()

  // Nothing was published.
  const slug = await draftSlug(eventId)
  expect((await page.goto(`/e/${slug}`))?.status()).toBe(404)
})

test('a draft is not publicly reachable', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)

  await page.goto('/create?kind=umngcwabo')
  await page.getByRole('button', { name: 'Continue with funeral' }).click()
  await page.getByLabel('Her name, or his name').fill('Nokuthula Mthembu')
  await page.getByLabel('Your name').fill('Nomsa Mthembu')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: "What's needed" })).toBeVisible()

  const eventId = page.url().split('/create/')[1]?.split('/')[0] ?? ''
  expect(eventId).not.toBe('')

  // Read the draft's real slug out of the database. Asserting that some made-up
  // slug 404s would pass even with the `status: 'published'` filter removed —
  // which is the failure this test exists for.
  const slug = await draftSlug(eventId)
  expect(slug).toMatch(/^[0-9A-Za-z]{16}$/)

  const draftResponse = await page.goto(`/e/${slug}`)
  expect(draftResponse?.status(), 'a draft answered a public request').toBe(404)

  // The share step does not hand out the link before publishing either.
  await page.goto(`/create/${eventId}/share`)
  await expect(page.locator('main')).not.toContainText(slug)

  // And once published, the same slug works — so the 404 above was the filter
  // and not a broken route.
  //
  // Finishing the flow first, because publishing is refused without an
  // umkhaphi and, since M3-02, without a verified organiser. `canPublish`
  // blocks on both, and the first run of this test proved that by returning
  // 404 for a page that was never published.
  await page.goto(`/create/${eventId}/witnesses`)
  await page.getByLabel('Their name').fill('Thandi Ngcobo')
  await page.getByLabel('Their number').fill('0821234567')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { name: 'One check, then you can share it' }),
  ).toBeVisible()
  await verifyHere(page)

  await page.goto(`/create/${eventId}/share`)
  await page.getByRole('button', { name: 'Publish and get the link' }).click()
  await expect(page.locator('[data-copy-source]')).toHaveValue(new RegExp(slug))

  const publishedResponse = await page.goto(`/e/${slug}`)
  expect(publishedResponse?.status()).toBe(200)
})

test('the needs list arrives pre-filled and stays editable', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  await signIn(page, request)

  await page.goto('/create?kind=umngcwabo')
  await page.getByRole('button', { name: 'Continue with funeral' }).click()
  await page.getByLabel('Her name, or his name').fill('Nokuthula Mthembu')
  await page.getByLabel('Your name').fill('Nomsa Mthembu')
  await page.getByRole('button', { name: 'Continue' }).click()

  // What a funeral needs, already written down: "You do not have to think of it
  // all yourself."
  await expect(page.getByRole('heading', { name: "What's needed" })).toBeVisible()
  await expect(page.locator('input[name="label"]')).toHaveCount(6)
  await expect(page.locator('input[name="label"]').first()).toHaveValue('Tent')
  await expect(page.getByText('Suggested — edit or remove it').first()).toBeVisible()

  // Removing a row is a submit, not a click handler.
  await page.getByRole('button', { name: 'Remove' }).first().click()
  await expect(page.locator('input[name="label"]')).toHaveCount(5)

  await page.getByRole('button', { name: 'Add something else' }).click()
  await expect(page.locator('input[name="label"]')).toHaveCount(6)
})

test('the consequence preview says what a funeral will and will not do', async ({
  page,
  request,
}) => {
  await asFreshClient(page)
  await signIn(page, request)

  await page.goto('/create?kind=umngcwabo')

  await expect(page.getByText('Amounts are hidden.')).toBeVisible()
  await expect(page.getByText('No target is shown.')).toBeVisible()
  await expect(page.getByText('No animation.')).toBeVisible()
  await expect(page.getByText('Stand with them')).toBeVisible()

  // And a wedding says the opposite, from the same config.
  await page.goto('/create?kind=umshado')
  await expect(page.getByText('Amounts are shown.')).toBeVisible()
  await expect(page.getByText('A target is shown.')).toBeVisible()
  await expect(page.getByText('A little celebration.')).toBeVisible()
})

test('a funeral page carries no accent of its own', async ({ page, request }) => {
  await asFreshClient(page)
  await signIn(page, request)

  const url = await setUpFuneral(page)
  await page.goto(`/e/${url.split('/e/')[1] ?? ''}`)

  const theme = page.locator('[data-archetype="umngcwabo"]')
  // Nothing is set, so var(--accent, #16233D) renders indigo (CLAUDE.md rule 2).
  expect(await theme.getAttribute('style')).toBeNull()

  // The claim button is painted with `var(--accent-strong, #16233d)`, which is
  // derived from `var(--accent, #16233d)`. With nothing declaring the custom
  // property both fall through to indigo — the mechanism, not a colour anybody
  // wrote down for bereavement.
  //
  // Read as channels rather than as a string: `color-mix()` computes to
  // `color(srgb …)` rather than `rgb()`, and asserting on the notation would
  // test how the browser prints a colour instead of which colour it is.
  const channels = await page
    .locator('.buttonPrimary')
    .first()
    .evaluate((node) => {
      const [red, green, blue] = getComputedStyle(node)
        .backgroundColor.match(/[\d.]+/g)!
        .map(Number)
      // color(srgb …) gives 0–1; rgb() gives 0–255.
      const scale = (value: number) => Math.round(value <= 1 ? value * 255 : value)
      return [scale(red!), scale(green!), scale(blue!)]
    })

  expect(channels).toEqual([22, 35, 61])
})

test('the setup flow works with JavaScript disabled', async ({ browser, request }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await asFreshClient(page)

  await signIn(page, request)
  const url = await setUpFuneral(page)

  await page.goto(`/e/${url.split('/e/')[1] ?? ''}`)
  await expect(page.getByRole('heading', { name: 'Nokuthula Mthembu' })).toBeVisible()

  await context.close()
})

test('has no axe violations across the six steps', async ({ page, request }) => {
  // Twelve scans, and M3-02 added four of them: the blocked share step, its
  // open disclosure, the check, and the result. Each one compiles a route in
  // the dev server before axe runs, which is over the default budget when six
  // workers are doing it at once. Tripled rather than trimmed — dropping a
  // screen from the walk would be paying for a green suite with coverage.
  test.slow()

  await asFreshClient(page)
  await signIn(page, request)

  const scan = async (heading: string) => {
    // Wait for the step to be on screen before scanning: axe on a page that is
    // still navigating reports whatever happened to be rendered.
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    expect((await new AxeBuilder({ page }).analyze()).violations, heading).toEqual([])
  }

  await page.goto('/create?kind=umngcwabo')
  await scan('What are you setting up?')

  await page.getByRole('button', { name: 'Continue with funeral' }).click()
  await scan('About her, or him')

  await page.getByLabel('Her name, or his name').fill('Nokuthula Mthembu')
  await page.getByLabel('Your name').fill('Nomsa Mthembu')
  await page.getByRole('button', { name: 'Continue' }).click()
  await scan("What's needed")

  await page.getByRole('button', { name: 'Continue' }).click()
  await scan('Who stands with you?')

  await page.getByLabel('Their name').fill('Thandi Ngcobo')
  await page.getByLabel('Their number').fill('0821234567')
  await page.getByRole('button', { name: 'Continue' }).click()
  await scan('One check, then you can share it')

  // The blocked share step is a screen in its own right since M3-02 — the
  // refusal, the disclosure and the route to the check — so it is scanned
  // before the check is run and again after.
  await page.getByRole('button', { name: 'Continue to sharing' }).click()
  await scan("It's ready. Send it.")
  await page.getByRole('button', { name: 'Publish and get the link' }).click()
  await expect(page.getByText('your name has to be confirmed')).toBeVisible()
  await scan("It's ready. Send it.")
  await page.getByText("Why can't I skip this?").click()
  await scan("It's ready. Send it.")

  await page.getByRole('button', { name: 'Confirm it is you' }).click()
  await scan('Confirm it is you')
  await verifyHere(page)
  await scan('You are verified')
  await page.getByRole('button', { name: 'Carry on' }).click()
  await scan("It's ready. Send it.")

  await page.getByRole('button', { name: 'Publish and get the link' }).click()
  // The heading does not change when the page publishes, so waiting on it
  // would pass while the navigation is still in flight and axe would scan a
  // half-rendered document. The link only exists afterwards.
  await expect(page.locator('[data-copy-source]')).toBeVisible()
  await scan("It's ready. Send it.")
})
