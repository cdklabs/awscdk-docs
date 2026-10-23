import { expect, test, type Page } from '@playwright/test';
import { API_OVERVIEW } from './fixture.js';

// The sidebar header must keep one height across a navigation from the API
// overview root to a type page. The absent-then-present assertions are what
// stop the comparison passing on a control that renders nowhere.
test.describe('API sidebar header keeps a constant height across navigation', () => {
  const headerHeight = (page: Page) =>
    page.evaluate(() => {
      const header = document.querySelector('.VPSidebar .sidebar-header');
      return header ? header.getBoundingClientRect().height : null;
    });

  const control = (page: Page) => page.locator('button.sidebar-jump-current');

  test('the header does not grow when a type page replaces the overview root', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(API_OVERVIEW);
    await expect(page.locator('.nav-filter-input')).toBeVisible();

    await expect(control(page)).toHaveCount(0);
    const before = await headerHeight(page);
    expect(before).not.toBeNull();

    // Navigate the way the filter is meant to be used. The overview root's
    // tree holds a single link, so a sidebar click cannot get us to a type
    // page. `sns topic` resolves to a symbol the fixture prune keeps.
    await page.fill('.nav-filter-input', 'sns topic');
    await expect(page.locator('.nav-filter-hint')).toContainText('Enter opens');
    await page.press('.nav-filter-input', 'Enter');

    await expect(page).toHaveURL(/aws_sns\.Topic\.html$/);
    await expect(control(page)).toHaveCount(1);

    const after = await headerHeight(page);
    expect(Math.abs(after! - before!)).toBeLessThanOrEqual(1);
  });

  test('the control is withheld while a query narrows the tree', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(API_OVERVIEW);
    await page.fill('.nav-filter-input', 'sns topic');
    await page.press('.nav-filter-input', 'Enter');
    await expect(page).toHaveURL(/aws_sns\.Topic\.html$/);
    await expect(control(page)).toHaveCount(1);

    const resting = await headerHeight(page);

    await page.fill('.nav-filter-input', 'bucket');
    await expect(page.locator('.nav-filter-hint')).toContainText('Enter opens');
    await expect(control(page)).toHaveCount(0);

    // Giving way must not move the tree either: the row is reserved. The hint's
    // symbol name is pinned to the row's line-height, so the allowance here is
    // slack rather than a height the row is expected to take up.
    expect(Math.abs((await headerHeight(page))! - resting!)).toBeLessThanOrEqual(1);
  });
});

test('the API root serves the construct overview without a static rail item', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(API_OVERVIEW);
  await expect(page.getByRole('heading', { level: 1, name: 'AWS Construct Library' })).toBeVisible();
  await expect(page.locator('.VPSidebarItem .item')).toHaveCount(0);
  await expect(page.locator('.api-sidebar-section-title').first()).toHaveText('Framework');
  const noFavoritesOffset = await page.evaluate(() => {
    const sidebar = document.querySelector('.VPSidebar')!.getBoundingClientRect();
    const firstSection = document.querySelector('.api-sidebar-section-title')!.getBoundingClientRect();
    return firstSection.top - sidebar.top;
  });
  // The first section sits directly below the pinned header, so its offset
  // tracks the header's height. The header carries 8px of top padding on
  // desktop (so the focused filter ring clears the navbar border), which adds
  // 8 to this offset — 60 without the padding, 68 with it.
  expect(noFavoritesOffset).toBe(68);
});

test('favorites use the measured collapsed and expanded spacing budgets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('cdk-docs:favourites', JSON.stringify([
      { path: '/v2/docs/aws-cdk-lib.aws_sqs.Queue', title: 'Queue' },
    ]));
    localStorage.setItem('cdk-docs:favourites:collapsed', 'true');
  });
  await page.goto(API_OVERVIEW);
  const offset = () => page.evaluate(() => {
    const sidebar = document.querySelector('.VPSidebar')!.getBoundingClientRect();
    const firstSection = document.querySelector('.api-sidebar-section-title')!.getBoundingClientRect();
    return firstSection.top - sidebar.top;
  });
  await expect(page.locator('.favorites-section')).toBeVisible();
  // +8 over the no-favorites/no-padding baselines: the header's 8px desktop
  // top padding (filter ring vs navbar border) lifts everything below it.
  expect(await offset()).toBe(119);
  await page.getByRole('button', { name: /Favorites/ }).click();
  expect(await offset()).toBe(150);
});
