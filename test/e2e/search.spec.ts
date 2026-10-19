import { expect, test } from '@playwright/test';

// Site search (SearchBox.vue): the navbar search button opens the dialog;
// querying a symbol documented in the fixture returns results from the JSON
// index docgen built with the site, ranked by MiniSearch in plain JavaScript.
test.describe('site search', () => {
  test('querying a known symbol returns results and navigates on Enter', async ({ page }) => {
    await page.goto('/');

    const searchButton = page.locator('.site-search-button');
    await expect(searchButton).toBeVisible();
    await searchButton.click();

    const input = page.locator('#site-search-input');
    await expect(input).toBeVisible();
    await input.fill('Topic');

    // The index is fetched on first open; allow it a moment.
    const results = page.locator('.site-search-result');
    await expect(results.first()).toBeVisible({ timeout: 15_000 });
    expect(await results.count()).toBeGreaterThan(0);
    // A title hit ranks first: the exact symbol name, not a page that merely mentions it.
    await expect(results.first().locator('.site-search-title')).toHaveText('Topic');

    await input.press('Enter');
    await expect(page).toHaveURL(/aws-cdk-lib\.aws_sns\.Topic\.html$/);
    await expect(input).toBeHidden();
  });

  test('module: and kind: tokens scope the results', async ({ page }) => {
    await page.goto('/');
    await page.locator('.site-search-button').click();
    const input = page.locator('#site-search-input');
    await input.fill('queue kind:construct module:aws-sqs');
    const results = page.locator('.site-search-result');
    await expect(results.first()).toBeVisible({ timeout: 15_000 });
    const kinds = await results.locator('.site-search-kind').allTextContents();
    expect(kinds.every((kind) => kind === 'construct')).toBe(true);
    const modules = await results.locator('.site-search-module').allTextContents();
    expect(modules.every((module) => module === 'aws-sqs')).toBe(true);
  });

  test('search runs without WebAssembly and raises no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const wasmRequests: string[] = [];
    page.on('request', (request) => {
      if (/\.wasm(\?|$)/.test(request.url())) {
        wasmRequests.push(request.url());
      }
    });

    await page.goto('/');
    await page.locator('.site-search-button').click();
    await page.locator('#site-search-input').fill('Topic');
    await expect(page.locator('.site-search-result').first()).toBeVisible({ timeout: 15_000 });

    expect(wasmRequests).toEqual([]);
    expect(errors.filter((text) => /WebAssembly|Content Security Policy|CompileError/.test(text))).toEqual([]);
  });

  test('the search dialog opens with Ctrl+K and closes with Escape', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Control+k');
    const input = page.locator('#site-search-input');
    await expect(input).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(input).toBeHidden();
  });
});
