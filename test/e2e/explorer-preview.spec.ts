import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

const PREVIEW_KEY = 'cdk-docs-explorer-preview';
const VIEW_KEY = 'cdk-docs-explorer-view';
const FAVORITES_KEY = 'cdk-docs:favourites';
const FAVORITES = [
  { path: '/v2/docs/aws-cdk-lib.aws_sns.Topic', title: 'Topic' },
  { path: '/v2/docs/aws-cdk-lib.aws_sqs.Queue', title: 'Queue' },
];

async function dismissConsent(page: Page) {
  const accept = page.getByRole('button', { name: 'Accept' });
  if (await accept.count()) await accept.first().click();
}

async function open(page: Page, stored: Record<string, string> = {}, favorites = false) {
  await page.addInitScript(
    ([entries, fav]) => {
      for (const [key, value] of Object.entries(entries as Record<string, string>)) window.localStorage.setItem(key, value);
      if (fav) window.localStorage.setItem('cdk-docs:favourites', JSON.stringify(fav));
    },
    [stored, favorites ? FAVORITES : null] as const,
  );
  await page.goto(QUEUE_PAGE);
  await dismissConsent(page);
}

const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidebar views' });

test.describe('explorer preview on desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the preview is off by default: gear in the bar, no rail, favorites section as before', async ({ page }) => {
    await open(page, {}, true);
    await expect(rail(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-explorer-preview', /.*/);
    await expect(page.locator('.VPNavBar .settings-trigger')).toBeVisible();
    await expect(page.locator('.VPSidebar')).toHaveCSS('width', '320px');
    await expect(page.locator('.favorites-section')).toBeVisible();
    await page.locator('.VPNavBar .settings-trigger').click();
    const group = page.locator('#settings-menu-panel').getByRole('group', { name: 'Explorer preview' });
    await expect(group.getByRole('button')).toHaveText(['Off', 'On']);
    await expect(group.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('turning the preview on swaps the gear for a rail and keeps focus on the On segment', async ({ page }) => {
    await open(page);
    await page.locator('.VPNavBar .settings-trigger').click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'On', exact: true }).click();

    await expect(page.locator('.VPNavBar .settings-trigger')).toBeHidden();
    await expect(rail(page)).toBeVisible();
    await expect(rail(page).getByRole('button')).toHaveText(['API', 'Favorites', 'Settings']);
    await expect(rail(page).getByRole('button', { name: 'API' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'false');
    const box = await rail(page).boundingBox();
    expect(box!.width).toBe(72);
    expect(box!.x).toBe(0);
    await expect(page.locator('.VPSidebar')).toHaveCSS('width', '392px');
    await expect(page.locator('.VPSidebar')).toHaveCSS('padding-left', '104px');

    // The panel stays open beside the rail, and focus sits on the same segment.
    const on = page.locator('#settings-menu-panel').getByRole('button', { name: 'On', exact: true });
    await expect(on).toBeFocused();
    await expect(on).toHaveAttribute('aria-pressed', 'true');
    const panel = await page.locator('#settings-menu-panel').boundingBox();
    expect(panel!.x).toBe(80);
    expect(panel!.y + panel!.height).toBe(892);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), PREVIEW_KEY)).toBe('on');
  });

  test('the API view keeps the filter and tree and drops the favorites section; Favorites shows only the list', async ({
    page,
  }) => {
    await open(page, { [PREVIEW_KEY]: 'on' }, true);
    await expect(page.locator('.favorites-section')).toHaveCount(0);
    await expect(page.getByPlaceholder('Filter navigation…')).toBeVisible();
    await expect(page.locator('.api-sidebar')).toBeVisible();

    await rail(page).getByRole('button', { name: 'Favorites' }).click();
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'true');
    const section = page.locator('.favorites-section');
    await expect(section.getByRole('heading', { name: '★ Favorites (2)' })).toBeVisible();
    await expect(section.locator('.favorites-link')).toHaveText(['Topic', 'Queue']);
    await expect(section.locator('.favorites-toggle')).toHaveCount(0);
    await expect(page.locator('.VPSidebar .nav-filter')).toBeHidden();
    await expect(page.locator('.VPSidebar .api-sidebar')).toBeHidden();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), VIEW_KEY)).toBe('favorites');

    await section.getByRole('button', { name: 'Remove Topic from favorites' }).click();
    await section.getByRole('button', { name: 'Remove Queue from favorites' }).click();
    await expect(section.locator('.favorites-empty')).toHaveText(
      'No favorites yet. Select the star on an API page to add it.',
    );
  });

  test('the switch and the view survive a reload, and the first paint already has the rail width', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on', [VIEW_KEY]: 'favorites' }, true);
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'true');
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        (window as unknown as { __early: string }).__early = document.documentElement.getAttribute('data-explorer-preview') ?? '';
      });
    });
    await page.reload();
    expect(await page.evaluate(() => (window as unknown as { __early: string }).__early)).toBe('on');
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.favorites-section')).toBeVisible();
  });

  test('Settings in the rail opens the panel, Escape closes it and returns focus, and Off brings the gear back', async ({
    page,
  }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    const settings = rail(page).getByRole('button', { name: 'Settings' });
    await expect(settings).toHaveAttribute('aria-haspopup', 'true');
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await settings.click();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#settings-menu-panel')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-menu-panel')).toBeHidden();
    await expect(settings).toBeFocused();

    await settings.click();
    await page.mouse.click(700, 300);
    await expect(page.locator('#settings-menu-panel')).toBeHidden();

    await settings.click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'Off', exact: true }).click();
    await expect(rail(page)).toHaveCount(0);
    await expect(page.locator('.VPNavBar .settings-trigger')).toBeFocused();
    await expect(page.locator('.VPSidebar')).toHaveCSS('width', '320px');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), PREVIEW_KEY)).toBe('off');
  });

  test('each rail button is a Tab stop in order', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await rail(page).getByRole('button', { name: 'API' }).focus();
    await page.keyboard.press('Tab');
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(rail(page).getByRole('button', { name: 'Settings' })).toBeFocused();
  });
});

test.describe('explorer preview on a phone', () => {
  test.use({ viewport: { width: 375, height: 760 } });

  test('the drawer has a Views button that unfolds the rail; picking a view folds it', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' }, true);
    await page.locator('.VPLocalNav button.menu').click();
    const views = page.getByRole('button', { name: /^Views/ });
    await expect(views).toBeVisible();
    await expect(views).toContainText('API');
    await expect(views).toHaveAttribute('aria-expanded', 'false');
    await expect(rail(page)).toBeHidden();
    const viewsBox = await views.boundingBox();
    expect(viewsBox!.height).toBe(44);

    await views.click();
    await expect(views).toHaveAttribute('aria-expanded', 'true');
    await expect(rail(page)).toBeVisible();
    await expect(rail(page).getByRole('button', { name: 'API' })).toBeFocused();
    for (const button of await rail(page).getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await rail(page).getByRole('button', { name: 'Favorites' }).click();
    await expect(rail(page)).toBeHidden();
    await expect(views).toBeFocused();
    await expect(views).toContainText('Favorites');
    await expect(page.locator('.favorites-section .favorites-link')).toHaveText(['Topic', 'Queue']);
  });

  test('Escape and a tap on the scrim fold the rail, and Settings opens the panel beside it', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    const views = page.getByRole('button', { name: /^Views/ });
    await views.click();
    await page.keyboard.press('Escape');
    await expect(rail(page)).toBeHidden();
    await expect(views).toBeFocused();

    await views.click();
    await page.mouse.click(300, 400);
    await expect(rail(page)).toBeHidden();

    await views.click();
    await rail(page).getByRole('button', { name: 'Settings' }).click();
    const panel = await page.locator('#settings-menu-panel').boundingBox();
    expect(panel!.x).toBe(80);
    expect(panel!.x + panel!.width).toBe(367);
    expect(panel!.y + panel!.height).toBe(752);
  });

  test('the phone menu offers the preview switch only while it is off', async ({ page }) => {
    await open(page);
    await page.locator('.VPNavBarHamburger').click();
    const group = page.locator('.VPNavScreen').getByRole('group', { name: 'Explorer preview' });
    await expect(group).toBeVisible();
    await group.getByRole('button', { name: 'On', exact: true }).click();
    await expect(group).toBeHidden();
    await expect(page.locator('.VPNavScreen').getByRole('group', { name: 'Navigation' })).toBeHidden();
  });
});
