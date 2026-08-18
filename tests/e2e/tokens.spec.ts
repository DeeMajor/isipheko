import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { ARCHETYPES, type ArchetypeConfig } from '@/domain/archetype'

/**
 * The tokens page, checked the way the done-criteria for M1-05 are worded:
 * every primitive in all six themes, axe clean, focus visible everywhere, and
 * exactly two font files, both ours.
 *
 * Bereavement is the theme that matters most here. It sets no `--accent` at
 * all, so it is the one that proves `var(--accent, #16233D)` is carrying the
 * fallback rather than a value somebody wrote down.
 */

const CONFIGS: readonly ArchetypeConfig[] = Object.values(ARCHETYPES)

/** One archetype per group — the same six themes the page renders. */
const THEMES = CONFIGS.filter(
  (config, index) => CONFIGS.findIndex((other) => other.group === config.group) === index,
)

const FONT_FILES = [
  '/fonts/public-sans-latin.woff2',
  '/fonts/public-sans-latin-ext.woff2',
]

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/tokens')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('renders every theme, including the one with no accent', async ({ page }) => {
  for (const config of THEMES) {
    await expect(page.locator(`[data-archetype="${config.key}"]`)).toBeVisible()
  }

  expect(THEMES).toHaveLength(6)
})

test('has no axe violations anywhere on the page', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze()

  expect(results.violations).toEqual([])
})

for (const config of THEMES) {
  test(`has no axe violations in the ${config.group} theme`, async ({ page }) => {
    // Scoped as well as page-wide, so a failure names the theme rather than
    // leaving somebody to find which of six columns broke.
    const results = await new AxeBuilder({ page })
      .include(`[data-archetype="${config.key}"]`)
      .analyze()

    expect(results.violations).toEqual([])
  })

  test(`renders every primitive in the ${config.group} theme`, async ({ page }) => {
    const theme = page.locator(`[data-archetype="${config.key}"]`)

    await expect(theme.getByRole('button', { name: config.verb })).toBeVisible()
    await expect(theme.getByRole('heading', { name: 'A card' })).toBeVisible()
    await expect(theme.getByLabel('Your name')).toBeVisible()
    await expect(theme.getByLabel('A message for the family')).toBeVisible()
    await expect(theme.getByLabel('Who can see this')).toBeVisible()
    await expect(theme.getByRole('status')).toBeVisible()
    await expect(theme.getByRole('alert').first()).toBeVisible()
    await expect(theme.locator('dialog[open]')).toBeVisible()
  })
}

test('sets --accent from the config, and sets nothing at all for bereavement', async ({
  page,
}) => {
  for (const config of THEMES) {
    const wrapper = page.locator(`[data-archetype="${config.key}"]`)
    const inline = await wrapper.getAttribute('style')

    if (config.accent === undefined) {
      // Not an empty declaration, not `--accent: initial` — no style attribute.
      expect(inline, config.key).toBeNull()
    } else {
      // Whitespace-insensitive: React serialises the custom property without
      // a space after the colon, and that is not the thing under test.
      expect(inline?.toLowerCase().replace(/\s+/g, ''), config.key).toContain(
        `--accent:${config.accent.toLowerCase()}`,
      )
    }
  }
})

test('falls back to indigo where no accent was declared', async ({ page }) => {
  const bead = (key: string) =>
    page.locator(`[data-archetype="${key}"] [aria-hidden="true"]`).first()

  const bereavement = THEMES.find((config) => config.group === 'bereavement')
  const union = THEMES.find((config) => config.group === 'union')

  expect(bereavement).toBeDefined()
  expect(union).toBeDefined()

  // #16233D — the fallback inside var(--accent, …), with nothing declaring it.
  await expect(bead(bereavement?.key ?? '')).toHaveCSS(
    'background-color',
    'rgb(22, 35, 61)',
  )
  // #8C2F22 — union's accent, straight off the config.
  await expect(bead(union?.key ?? '')).toHaveCSS('background-color', 'rgb(140, 47, 34)')
})

test('shows a visible focus ring on every control reachable by keyboard', async ({
  page,
}) => {
  const focusRingOf = (target: Page) =>
    target.evaluate(() => {
      const element = document.activeElement
      if (element === null || element === document.body) return null

      const style = getComputedStyle(element)
      return {
        tag: element.tagName.toLowerCase(),
        width: style.outlineWidth,
        style: style.outlineStyle,
        offset: style.outlineOffset,
      }
    })

  let checked = 0

  // Tab through the page rather than calling .focus(): :focus-visible is about
  // how focus arrived, and a programmatic focus is not the case a keyboard user
  // is in.
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab')
    const ring = await focusRingOf(page)
    if (ring === null) continue

    expect(ring.style, `${ring.tag} has no focus outline`).toBe('solid')
    expect(ring.width, `${ring.tag} focus outline width`).toBe('2px')
    expect(ring.offset, `${ring.tag} focus outline offset`).toBe('2px')
    checked += 1
  }

  // Buttons, inputs, textareas and selects across six themes — if this number
  // collapses, the test stopped covering anything.
  expect(checked).toBeGreaterThan(20)
})

test('fetches its fonts from this origin and nowhere else', async ({ page, baseURL }) => {
  const fontRequests: string[] = []

  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url())
  })

  await page.reload()
  await page.evaluate(() => document.fonts.ready)

  expect(fontRequests.length).toBeGreaterThan(0)

  for (const url of fontRequests) {
    expect(url.startsWith(baseURL ?? ''), url).toBe(true)
    expect(
      FONT_FILES.some((file) => url.endsWith(file)),
      url,
    ).toBe(true)
  }
})
