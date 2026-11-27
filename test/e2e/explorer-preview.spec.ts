import { expect, test, type Page } from '@playwright/test';
import { CFN_QUEUE_PAGE, QUEUE_PAGE } from './fixture.js';

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

async function open(page: Page, stored: Record<string, string> = {}, favorites = false, path = QUEUE_PAGE) {
  await page.addInitScript(
    ([entries, fav]) => {
      for (const [key, value] of Object.entries(entries as Record<string, string>)) window.localStorage.setItem(key, value);
      if (fav) window.localStorage.setItem('cdk-docs:favourites', JSON.stringify(fav));
    },
    [stored, favorites ? FAVORITES : null] as const,
  );
  await page.goto(path);
  await dismissConsent(page);
}

const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidebar views' });

test.describe('explorer preview on desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the preview is off by default: gear in the bar, no rail, favorites section in the sidebar', async ({ page }) => {
    await open(page, {}, true);
    await expect(page.locator('html')).not.toHaveAttribute('data-explorer-preview', /.*/);
    await expect(page.locator('.VPNavBar .settings-trigger')).toBeVisible();
    await expect(page.locator('.VPSidebar')).toHaveCSS('width', '320px');
    await expect(page.locator('.favorites-section')).toBeVisible();
    // The rail renders only after mount, so it is checked once a post-mount element is on the page.
    await expect(rail(page)).toHaveCount(0);
    await page.locator('.VPNavBar .settings-trigger').click();
    const group = page.locator('#settings-menu-panel').getByRole('group', { name: 'Explorer preview' });
    await expect(group.getByRole('button')).toHaveText(['Off', 'On']);
    await expect(group.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('turning the preview on adds the rail, keeps the gear and leaves focus on the On segment', async ({ page }) => {
    await open(page);
    await page.locator('.VPNavBar .settings-trigger').click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'On', exact: true }).click();

    await expect(page.locator('.VPNavBar .settings-trigger')).toBeVisible();
    await expect(rail(page)).toBeVisible();
    await expect(rail(page).getByRole('button')).toHaveText(['API', 'Favorites']);
    await expect(rail(page).getByRole('button', { name: 'Settings' })).toHaveCount(0);
    await expect(rail(page).getByRole('button', { name: 'API' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'false');
    const box = await rail(page).boundingBox();
    expect(box!.width).toBe(72);
    expect(box!.x).toBe(0);
    await expect(page.locator('.VPSidebar')).toHaveCSS('width', '392px');
    await expect(page.locator('.VPSidebar')).toHaveCSS('padding-left', '104px');

    // The panel stays open under the gear, and focus sits on the same segment.
    const on = page.locator('#settings-menu-panel').getByRole('button', { name: 'On', exact: true });
    await expect(on).toBeFocused();
    await expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), PREVIEW_KEY)).toBe('on');
  });

  test('turning the preview off from the gear panel removes the rail, closes the panel and returns focus to the gear', async ({
    page,
  }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await expect(rail(page)).toBeVisible();
    await page.locator('.VPNavBar .settings-trigger').click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'Off', exact: true }).click();
    await expect(rail(page)).toHaveCount(0);
    await expect(page.locator('.VPSidebar')).toHaveCSS('width', '320px');
    await expect(page.locator('.VPNavBar .settings-trigger')).toBeFocused();
    await expect(page.locator('#settings-menu-panel')).toBeHidden();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), PREVIEW_KEY)).toBe('off');
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

    // Back in the API view the section is gone again. The section is never in the server HTML, so this is
    // checked after the view was switched at runtime, while both entries are still stored.
    await rail(page).getByRole('button', { name: 'API' }).click();
    await expect(page.locator('.favorites-section')).toHaveCount(0);
    await rail(page).getByRole('button', { name: 'Favorites' }).click();

    await section.getByRole('button', { name: 'Remove Topic from favorites' }).click();
    await section.getByRole('button', { name: 'Remove Queue from favorites' }).click();
    await expect(section.locator('.favorites-empty')).toHaveText(
      'No favorites yet. Select the star on an API page to add it.',
    );
  });

  test('the switch and the view the reader chose survive a reload, and the head script sets both attributes first', async ({
    page,
  }) => {
    await open(page, {}, true);
    await page.locator('.VPNavBar .settings-trigger').click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'On', exact: true }).click();
    await rail(page).getByRole('button', { name: 'Favorites' }).click();
    await page.addInitScript(() => {
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'interactive') return;
        const html = document.documentElement;
        (window as unknown as { __early: string[] }).__early = [
          html.getAttribute('data-explorer-preview') ?? '',
          html.getAttribute('data-explorer-view') ?? '',
        ];
      });
    });
    await page.reload();
    // `interactive` comes after inline head scripts and before any module script, so the attributes seen
    // then can only have come from the head script.
    expect(await page.evaluate(() => (window as unknown as { __early: string[] }).__early)).toEqual([
      'on',
      'favorites',
    ]);
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.favorites-section')).toBeVisible();
  });

  test('the head script ignores an unknown preview value and falls back to the API view for an unknown view', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'interactive') return;
        const html = document.documentElement;
        (window as unknown as { __early: string[] }).__early = [
          html.getAttribute('data-explorer-preview') ?? '',
          html.getAttribute('data-explorer-view') ?? '',
        ];
      });
    });
    await open(page, { [PREVIEW_KEY]: 'yes', [VIEW_KEY]: 'tree' });
    expect(await page.evaluate(() => (window as unknown as { __early: string[] }).__early)).toEqual(['', '']);
    // The rail renders only after mount, so wait for the panel to show the switch read from storage first.
    await page.locator('.VPNavBar .settings-trigger').click();
    await expect(page.locator('#settings-menu-panel [data-value="off"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(rail(page)).toHaveCount(0);
  });

  test('an unknown stored view falls back to the API view with the preview on', async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'interactive') return;
        const html = document.documentElement;
        (window as unknown as { __early: string[] }).__early = [
          html.getAttribute('data-explorer-preview') ?? '',
          html.getAttribute('data-explorer-view') ?? '',
        ];
      });
    });
    await open(page, { [PREVIEW_KEY]: 'on', [VIEW_KEY]: 'tree' });
    expect(await page.evaluate(() => (window as unknown as { __early: string[] }).__early)).toEqual(['on', 'api']);
    await expect(rail(page).getByRole('button', { name: 'API' })).toHaveAttribute('aria-pressed', 'true');
  });

  // The 392px sidebar variable moves where the top bar's controls start, so the row, gear included,
  // is measured at the tightest one-row widths on a page with the sidebar and on one without.
  for (const [pagePath, label] of [
    [QUEUE_PAGE, 'an API page'],
    ['/', 'the home page'],
  ] as const) {
    for (const width of [960, 1000, 1280]) {
      test(`the top bar row fits at ${width}px on ${label} with the preview on`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await open(page, { [PREVIEW_KEY]: 'on' }, false, pagePath);
        const controls = [
          '.VPNavBar .language-toggle',
          '.VPNavBar .content-body > .search',
          '.VPNavBar .content-body > .VPNavBarMenu',
          '.VPNavBar .content-body > .version-badge',
          '.VPNavBar .settings-trigger',
        ];
        const boxes = [];
        for (const selector of controls) {
          const control = page.locator(selector).first();
          await expect(control, `${selector} is visible`).toBeVisible();
          const box = await control.boundingBox();
          expect(box, `${selector} has a box`).not.toBeNull();
          boxes.push(box!);
        }
        const title = await page.locator('.VPNavBar .container > .title').boundingBox();
        expect(boxes[0].x, 'the first control starts after the title lane').toBeGreaterThanOrEqual(title!.x + title!.width);
        // The search button keeps at least its icon width where the row is tightest.
        expect(boxes[1].width, 'the search button keeps its icon width').toBeGreaterThanOrEqual(40);
        for (let i = 1; i < boxes.length; i++) {
          expect(boxes[i].x, 'controls do not overlap').toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 1);
        }
        const last = boxes[boxes.length - 1];
        expect(last.x + last.width, 'the gear ends at least 8px inside the viewport').toBeLessThanOrEqual(width - 8);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await expect(page.locator('.VPNavBar .settings-trigger')).toBeVisible();
        // Only a page with the sidebar gives its 72px to the rail: the title lane elsewhere keeps its width.
        expect(title!.width).toBe(pagePath === QUEUE_PAGE && width >= 960 ? 392 : 320);
      });
    }
  }

  test('on a page without the rail the gear stays, and the switch there turns the preview off', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' }, false, '/');
    await expect(page.locator('html')).toHaveAttribute('data-explorer-preview', 'on');
    await expect(rail(page)).toHaveCount(0);
    const gear = page.locator('.VPNavBar .settings-trigger');
    await expect(gear).toBeVisible();
    await gear.click();
    const panel = page.locator('#settings-menu-panel');
    await expect(panel.locator('[data-value="on"]')).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('button', { name: 'Off', exact: true }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-explorer-preview', /.*/);
    await expect(gear).toBeFocused();
    await expect(gear).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), PREVIEW_KEY)).toBe('off');
  });

  test('turning the preview on from the gear on a page without the rail keeps the gear and the focus', async ({
    page,
  }) => {
    await open(page, {}, false, '/');
    await page.locator('.VPNavBar .settings-trigger').click();
    const on = page.locator('#settings-menu-panel').getByRole('button', { name: 'On', exact: true });
    await on.click();
    await expect(page.locator('html')).toHaveAttribute('data-explorer-preview', 'on');
    await expect(page.locator('.VPNavBar .settings-trigger')).toBeVisible();
    await expect(on).toBeFocused();
  });
  test('with the preview on, the gear panel opens, and Escape closes it and returns focus to the gear', async ({
    page,
  }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    const gear = page.locator('.VPNavBar .settings-trigger');
    await expect(gear).toHaveAttribute('aria-haspopup', 'true');
    await expect(gear).toHaveAttribute('aria-expanded', 'false');
    await gear.click();
    await expect(gear).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#settings-menu-panel')).toBeVisible();
    await expect(page.locator('#settings-menu-panel [data-value="on"]')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-menu-panel')).toBeHidden();
    await expect(gear).toBeFocused();

    await gear.click();
    await page.mouse.click(700, 300);
    await expect(page.locator('#settings-menu-panel')).toBeHidden();
  });
  test('at 1600px the rail sits where the sidebar content used to start and the tree keeps its width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await open(page, { [PREVIEW_KEY]: 'on' });
    const box = await rail(page).boundingBox();
    expect(box!.x).toBe(80);
    expect(box!.width).toBe(72);
    await expect(page.locator('.VPSidebar')).toHaveCSS('padding-left', '184px');
    const tree = await page.locator('.VPSidebar .api-sidebar').boundingBox();
    expect(tree!.x).toBe(184);
  });

  test('scrolling the sidebar leaves the rail where it is', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await open(page, { [PREVIEW_KEY]: 'on' });
    const railBefore = await rail(page).boundingBox();
    const scrolled = await page.locator('.VPSidebar').evaluate((el) => {
      el.scrollTo(0, 200);
      return el.scrollTop;
    });
    expect(scrolled, 'the sidebar scrolled').toBeGreaterThan(0);
    expect((await rail(page).boundingBox())!.y).toBe(railBefore!.y);
  });

  test('each rail button is a Tab stop in order', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await rail(page).getByRole('button', { name: 'API' }).focus();
    await page.keyboard.press('Tab');
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toBeFocused();
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

  test('Escape and a tap on the scrim fold the rail', async ({ page }) => {
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
  });
  test('the phone menu keeps all its setting rows with the preview on, and the switch there turns it off', async ({
    page,
  }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPNavBarHamburger').click();
    const screen = page.locator('.VPNavScreen');
    const group = screen.getByRole('group', { name: 'Explorer preview' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(screen.getByRole('group', { name: 'Navigation' })).toBeVisible();
    await expect(screen.getByRole('group', { name: 'Site theme' })).toBeVisible();
    await group.getByRole('button', { name: 'Off', exact: true }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-explorer-preview', /.*/);
    await expect(group.getByRole('button', { name: 'Off', exact: true })).toBeFocused();
  });

  test('the phone menu offers the preview switch, and turning it on keeps the rows and the focus', async ({ page }) => {
    await open(page);
    await page.locator('.VPNavBarHamburger').click();
    const screen = page.locator('.VPNavScreen');
    const group = screen.getByRole('group', { name: 'Explorer preview' });
    await expect(group).toBeVisible();
    await group.getByRole('button', { name: 'On', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-explorer-preview', 'on');
    await expect(group).toBeVisible();
    await expect(screen.getByRole('group', { name: 'Navigation' })).toBeVisible();
    await expect(group.getByRole('button', { name: 'On', exact: true })).toBeFocused();
  });
  test('at 800px the gear is in the bar with the preview on, and turning it off from there closes the panel and returns focus to the gear', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await open(page, { [PREVIEW_KEY]: 'on' });
    const gear = page.locator('.VPNavBar .settings-trigger');
    await expect(gear).toBeVisible();
    await gear.click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'Off', exact: true }).click();
    await expect(rail(page)).toHaveCount(0);
    await expect(gear).toBeFocused();
    await expect(page.locator('#settings-menu-panel')).toBeHidden();
  });
  test('the unfolded rail and scrim stay fixed to the viewport when the drawer scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 400 });
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    await page.getByRole('button', { name: /^Views/ }).click();
    await expect(rail(page)).toBeVisible();
    const scrolled = await page.locator('.VPSidebar').evaluate((el) => {
      el.scrollTo(0, 200);
      return el.scrollTop;
    });
    expect(scrolled, 'the drawer scrolled').toBeGreaterThan(0);
    const box = (await rail(page).boundingBox())!;
    expect(box.y).toBe(0);
    expect(box.height).toBe(400);
    expect((await page.locator('.explorer-rail-scrim').boundingBox())!.width).toBe(375);
  });

  test('tabbing out of the unfolded rail folds it and leaves the drawer open', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    const views = page.getByRole('button', { name: /^Views/ });
    await views.click();
    await expect(rail(page)).toBeVisible();
    await rail(page).getByRole('button', { name: 'Favorites' }).focus();
    // The Views button sits under the rail and the scrim, so tabbing onto it folds the rail and focus stays there.
    await page.keyboard.press('Tab');
    await expect(views).toBeFocused();
    await expect(rail(page)).toBeHidden();
    // The next stop is the filter; the rail stays folded.
    await page.keyboard.press('Tab');
    await expect(page.locator('.VPSidebar .nav-filter-input')).toBeFocused();
    await expect(rail(page)).toBeHidden();
    await expect(views).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.VPSidebar')).toHaveClass(/\bopen\b/);
  });

  test('a modifier released before Escape does not let the Escape release close the drawer', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    const views = page.getByRole('button', { name: /^Views/ });
    await views.click();
    await page.keyboard.down('Shift');
    await page.keyboard.down('Escape');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Escape');
    await expect(rail(page)).toBeHidden();
    await expect(page.locator('.VPSidebar')).toHaveClass(/\bopen\b/);
  });

  test('an Escape release that never arrives does not leave a swallow listener behind', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    await page.getByRole('button', { name: /^Views/ }).click();
    await page.evaluate(() => {
      (window as unknown as { releases: number }).releases = 0;
      window.addEventListener('keyup', (event) => {
        if (event.key === 'Escape') (window as unknown as { releases: number }).releases += 1;
      });
    });
    await page.keyboard.down('Escape');
    await expect(rail(page)).toBeHidden();
    // The window loses focus before the key comes up, so the release is sent after the blur.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('Escape');
    expect(await page.evaluate(() => (window as unknown as { releases: number }).releases)).toBe(1);
  });

  test('a client-side route change folds an unfolded rail', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    const views = page.getByRole('button', { name: /^Views/ });
    await views.click();
    await expect(rail(page)).toBeVisible();
    // A programmatic click on a sidebar link is a VitePress client-side navigation; the scrim covers the tree
    // on a phone, so a pointer click cannot reach it.
    await page.evaluate((href) => {
      (document.querySelector(`.VPSidebar a[href$="${href}"]`) as HTMLAnchorElement).click();
    }, CFN_QUEUE_PAGE);
    await expect(page).toHaveURL(new RegExp(`${CFN_QUEUE_PAGE}$`));
    await page.locator('.VPLocalNav button.menu').click();
    await expect(views).toHaveAttribute('aria-expanded', 'false');
    await expect(rail(page)).toBeHidden();
  });
});
