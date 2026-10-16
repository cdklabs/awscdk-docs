import { expect, test } from '@playwright/test';

// Pagefind static search (vitepress-plugin-pagefind): the navbar
// search button opens the search dialog; querying a symbol documented in the
// fixture returns results from the Pagefind index built with the site.
test.describe('pagefind search', () => {
  test('querying a known symbol returns results', async ({ page }) => {
    await page.goto('/');

    const searchButton = page.locator('.blog-search button');
    await expect(searchButton).toBeVisible();
    await searchButton.click();

    const input = page.locator('#search-input');
    await expect(input).toBeVisible();
    await input.fill('Topic');

    // Pagefind loads its index chunks on demand; allow it a moment.
    const results = page.locator('.search-dialog .link');
    await expect(results.first()).toBeVisible({ timeout: 15_000 });
    expect(await results.count()).toBeGreaterThan(0);
  });

  test('the search dialog opens and closes', async ({ page }) => {
    await page.goto('/');

    await page.locator('.blog-search button').click();
    const input = page.locator('#search-input');
    await expect(input).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(input).toBeHidden();
  });
});
