import { expect, test } from '@playwright/test';

// URL compatibility: the canonical pages live at the
// historical shape — the site is hosted at /cdk/api/, so base-relative
// /v2/docs/… completes the old /cdk/api/v2/docs/… addresses. Type pages
// are asserted by the smoke and language-toggle suites; the reference
// root and versions page are exercised here.
test.describe('URL compatibility with the old page shapes', () => {
  test('the reference root /v2/ resolves to the API overview', async ({ page }) => {
    const response = await page.goto('/v2/');
    expect(response?.ok()).toBe(true);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('/versions.html resolves to the versions page', async ({ page }) => {
    const response = await page.goto('/versions.html');
    expect(response?.ok()).toBe(true);
    await expect(page.locator('h1').first()).toContainText('Versions');
  });
});
