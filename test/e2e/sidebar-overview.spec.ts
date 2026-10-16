import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// Submodule Overview links in the API sidebar: every service
// section leads with an `Overview` entry linking straight to that
// submodule's landing page (its README), so the page is one click from the
// sidebar instead of a multi-hop walk through /api/. These specs prove the
// interactive contract on the BUILT, hydrated site.
test.describe('sidebar submodule Overview link', () => {
  async function waitForSidebar(page: Page) {
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  test('an expanded service section leads with an Overview link to the submodule page', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);

    // Being on Queue auto-expands the SQS section; its first child is the
    // Overview leaf pointing at the submodule's landing page. Collapsed
    // sections keep their (hidden) children in the DOM, so scope to the
    // visible one.
    const overview = page
      .locator('.api-sidebar a.api-sidebar-link:visible', { hasText: 'Overview' })
      .first();
    await expect(overview).toBeVisible();
    await expect(overview).toHaveAttribute('href', '/v2/docs/aws-cdk-lib.aws_sqs-readme');
  });

  test('clicking Overview navigates to the submodule page and marks it active', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);

    await page
      .locator('.api-sidebar a.api-sidebar-link:visible', { hasText: 'Overview' })
      .first()
      .click();

    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sqs-readme(\.html)?$/);
    // The overview page rendered (README H1 or fqn fallback).
    await expect(page.locator('.vp-doc h1').first()).not.toBeEmpty();

    // The sidebar Overview entry is the single active link, keeping
    // expand/collapse independent.
    const active = page.locator('.api-sidebar a.api-sidebar-link.active');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveText('Overview');
    await expect(active).toHaveAttribute('aria-current', 'page');
  });

  test('the Overview entry stays reachable under the in-sidebar filter', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);

    const input = page.getByRole('textbox', { name: 'Filter API symbols in the sidebar' });
    await input.fill('Overview');

    const sidebar = page.locator('.api-sidebar');
    await expect(
      sidebar.locator('a.api-sidebar-link', { hasText: 'Overview' }).first(),
    ).toBeVisible();
  });
});
