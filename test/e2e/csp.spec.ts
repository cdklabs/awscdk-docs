import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// The hosted docs send a Content Security Policy whose script-src has no 'unsafe-eval'. The site must boot under it.
const SCRIPT_SRC = "script-src 'self' 'unsafe-inline' blob: *.awsstatic.com";

test.describe('content security policy', () => {
  test('a page hydrates with no eval-dependent script', async ({ page }) => {
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': SCRIPT_SRC },
      });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /unsafe-eval/.test(message.text())) errors.push(message.text());
    });

    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar .api-sidebar-list li').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
