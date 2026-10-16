import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Navbar aws-cdk-lib version badge: the release the docs were
// generated from is visible in the chrome on every page, and the badge is
// the link to the Versions page rather than a dead label.
test.describe('navbar version badge', () => {
  test('shows the aws-cdk-lib version in the navbar and links to the versions page', async ({
    page,
  }) => {
    await page.goto(TOPIC_PAGE);
    const badge = page.locator('.VPNavBar .version-badge');
    await expect(badge).toBeVisible();
    // A real semver, with the v prefix and no "undefined" leaking through
    // from an absent package.
    await expect(badge).toHaveText(/^v\d+\.\d+\.\d+/);
    const href = await badge.getAttribute('href');
    expect(href).toMatch(/\/versions$/);
    // Accessible name says what is versioned, not just the number.
    await expect(badge).toHaveAttribute('aria-label', /aws-cdk-lib/);
  });

  test('the badge renders on non-API pages too', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.VPNavBar .version-badge')).toBeVisible();
  });

  test('following the badge lands on the versions page', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await page.locator('.VPNavBar .version-badge').click();
    await expect(page).toHaveURL(/\/versions/);
  });

  test('visible in the mobile navbar without overflowing the row', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(TOPIC_PAGE);

    const wrapper = page.locator('.VPNavBar .wrapper');
    const title = page.locator('.VPNavBarTitle .title');
    const badge = page.locator('.VPNavBar .content-body > .version-badge');
    const search = page.locator('.VPNavBar .content-body > .search');

    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^v\d+\.\d+\.\d+/);
    await expect(badge).toHaveAttribute('href', /\/versions$/);
    await expect(badge).toHaveAttribute('aria-label', /aws-cdk-lib/);

    const titleBox = await title.boundingBox();
    const badgeBox = await badge.boundingBox();
    const searchBox = await search.boundingBox();
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(badgeBox!.x + 1);
    expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(searchBox!.x + 1);
    expect(badgeBox!.width).toBeGreaterThanOrEqual(44);
    expect(badgeBox!.height).toBeGreaterThanOrEqual(44);

    const overflows = (element: Element) => element.scrollWidth > element.clientWidth + 1;
    expect(await wrapper.evaluate(overflows)).toBe(false);

    await page.locator('.VPNavBar .container > .title').evaluate((element) => {
      (element as HTMLElement).style.flexShrink = '0';
    });
    expect(await wrapper.evaluate(overflows)).toBe(true);
  });
});
