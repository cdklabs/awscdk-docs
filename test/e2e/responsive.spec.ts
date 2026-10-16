import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Mobile-viewport behavior. The unit test pins the CSS
// declarations; only a browser can measure the boxes they produce, which is
// the class AGENTS.md rule 7 requires an e2e spec for. The star and the row
// height are measured because they are the only boxes the 44px floor changes.
test.describe('mobile viewport: drawer and tap targets', () => {
  test.use({ viewport: { width: 375, height: 720 } });

  const MIN_TAP = 44;

  test('the breadcrumb favorite star is a 44px tap target', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    const star = page.locator('.favorite-star-button').first();
    await expect(star).toBeVisible();
    const box = await star.boundingBox();
    expect(box).not.toBeNull();
    // Both dimensions come from the min-* pair: the icon's natural box is
    // smaller, so this fails if either declaration is removed.
    expect(box!.width).toBeGreaterThanOrEqual(MIN_TAP);
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TAP);
  });

  test('the sidebar drawer opens, closes, and its rows are 44px tall', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    const sidebar = page.locator('aside.VPSidebar');
    const toggle = page.locator('.VPLocalNav .menu');

    // Closed to begin with: the drawer is off-canvas until the local-nav
    // Menu button is tapped (the navbar hamburger opens the nav screen, a
    // different surface).
    await expect(sidebar).not.toHaveClass(/\bopen\b/);

    await toggle.click();
    await expect(sidebar).toHaveClass(/\bopen\b/);

    // Height only: the row's width is the drawer's, so a width assertion here
    // could never fail.
    const row = sidebar.locator('.api-sidebar-group, .api-sidebar-link').first();
    await expect(row).toBeVisible();
    const rowBox = await row.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.height).toBeGreaterThanOrEqual(MIN_TAP);

    await page.keyboard.press('Escape');
    await expect(sidebar).not.toHaveClass(/\bopen\b/);
  });
});
