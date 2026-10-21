import { expect, test } from '@playwright/test';
import { MAX_SEARCH_RESULTS } from '../../docs/.vitepress/theme/search-client.js';

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

  test('a broad query loads only the capped result fragments', async ({ page }) => {
    const fragments = new Set<string>();
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/pagefind/fragment/') && path.endsWith('.pf_fragment')) {
        fragments.add(path);
      }
    });

    await page.goto('/');
    const uncappedResults = await page.evaluate(async () => {
      const preload = document.querySelector<HTMLLinkElement>(
        'link[rel="modulepreload"][href$="pagefind/pagefind.js"]',
      );
      if (!preload) return 0;
      const pagefind = await import(/* @vite-ignore */ preload.href);
      await pagefind.init?.();
      const search = await pagefind.search('construct');
      return search.results.length;
    });
    expect(uncappedResults).toBeGreaterThan(MAX_SEARCH_RESULTS);

    await page.locator('.blog-search button').click();
    await page.locator('#search-input').fill('construct');
    await expect(page.locator('.search-dialog .link').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    expect(fragments.size).toBe(MAX_SEARCH_RESULTS);
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
