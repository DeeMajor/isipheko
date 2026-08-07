import { expect, test } from '@playwright/test'

test('the app boots and serves the root page', async ({ page }) => {
  const response = await page.goto('/')

  expect(response?.status()).toBe(200)
  await expect(page.locator('main')).toContainText('Isipheko')
})
