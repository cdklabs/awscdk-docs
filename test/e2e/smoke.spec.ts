import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Core navigation smoke tests. The populated-sidebar assertion catches a
// stale urlPrefix or asset path after a docgen layout change: the
// ApiSidebar fetch 404s and the API nav silently renders empty while
// everything else still builds green.
test.describe('core navigation smoke', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/AWS CDK Reference/);
    await expect(page.locator('.VPNav')).toBeVisible();
  });

  test('an /v2/docs/ page loads with a populated API sidebar', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('h1').first()).toContainText('Topic');

    // The lazy API sidebar must fetch the served skeleton plus the
    // page's chunk and render the Service -> Resource -> Kind tree — not the error state.
    const sidebar = page.locator('.api-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('.api-sidebar-nav')).toBeVisible();
    expect(await sidebar.locator('.api-sidebar-list li').count()).toBeGreaterThan(0);
    await expect(sidebar.locator('.api-sidebar-status')).toHaveCount(0);
  });
});
