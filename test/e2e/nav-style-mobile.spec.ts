import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// Navigation style on a phone (docs/adr/2026-10-23-sidebar-navigation-styles.md,
// "Picker"): below 768px the Settings dropdown that holds the By service / By
// package control is hidden (nav-controls.css), so the hamburger nav screen
// renders the same NavStylePicker as a direct row. Picking a style there
// regroups the sidebar drawer, and the desktop layout keeps the control in
// the Settings dropdown only.
const NAV_KEY = 'cdk-docs-nav-style';

async function dismissConsent(page: Page) {
  const accept = page.getByRole('button', { name: 'Accept' });
  if (await accept.count()) await accept.first().click();
}

const sectionTitles = (page: Page) =>
  page.locator('.api-sidebar-nav > .api-sidebar-list > li > p.api-sidebar-section-title');
const topButton = (page: Page, name: string) =>
  page
    .locator('.api-sidebar-nav > .api-sidebar-list > li')
    .filter({ has: page.locator(`:scope > button.api-sidebar-group:has-text("${name}")`) })
    .first()
    .locator(':scope > button.api-sidebar-group');

test.describe('navigation style on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the hamburger menu offers By service and By package, and the choice regroups the drawer', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await dismissConsent(page);
    await expect(page.locator('.VPNavBar .content-body > .SettingsMenu')).toBeHidden();

    await page.locator('.VPNavBarHamburger').click();
    const group = page.locator('.VPNavScreen').getByRole('group', { name: 'Navigation' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('button')).toHaveText(['By service', 'By package']);
    await expect(group.getByRole('button', { name: 'By service' })).toHaveAttribute('aria-pressed', 'true');
    // Fits the 390px screen and keeps the 24px target floor.
    const track = await group.boundingBox();
    expect(track).not.toBeNull();
    expect(track!.x).toBeGreaterThanOrEqual(0);
    expect(track!.x + track!.width).toBeLessThanOrEqual(390);
    for (const height of await group
      .getByRole('button')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(height).toBeGreaterThanOrEqual(24);
    }
    // The nav-screen row spacing, not the Settings panel's.
    await expect(page.locator('.VPNavScreen .NavStylePicker')).toHaveCSS('margin-top', '12px');

    await group.getByRole('button', { name: 'By package' }).click();
    await expect(group.getByRole('button', { name: 'By package' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), NAV_KEY)).toBe('package');

    // Close the nav screen and open the sidebar drawer: it shows the package tree.
    await page.locator('.VPNavBarHamburger').click();
    await expect(page.locator('.VPNavScreen')).toBeHidden();
    await page.locator('.VPLocalNav button.menu').click();
    await expect(page.locator('.VPSidebar')).toBeInViewport();
    await expect(topButton(page, 'aws-cdk-lib.aws_sqs')).toHaveAttribute('aria-expanded', 'true');
    await expect(sectionTitles(page)).toHaveCount(0);
    expect(page.url()).toContain('aws-cdk-lib.aws_sqs.Queue');
  });

  test('a stored package choice shows as active in the hamburger menu', async ({ page }) => {
    await page.addInitScript((key) => window.localStorage.setItem(key, 'package'), NAV_KEY);
    await page.goto(QUEUE_PAGE);
    await dismissConsent(page);
    await page.locator('.VPNavBarHamburger').click();
    const group = page.locator('.VPNavScreen').getByRole('group', { name: 'Navigation' });
    await expect(group.getByRole('button', { name: 'By package' })).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { name: 'By service' })).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('navigation style on desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the control stays in the Settings dropdown only', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await dismissConsent(page);
    await expect(page.locator('.VPNavBarHamburger')).toBeHidden();
    await expect(page.locator('.VPNavScreen')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Navigation' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings' }).click();
    const group = page.locator('.SettingsMenu').getByRole('group', { name: 'Navigation' });
    await expect(group).toBeVisible();
    await expect(page.getByRole('group', { name: 'Navigation' })).toHaveCount(1);
    await expect(page.locator('.SettingsMenu .NavStylePicker')).toHaveCSS('margin-top', '6px');
  });
});
