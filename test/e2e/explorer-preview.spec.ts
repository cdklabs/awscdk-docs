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

  test('the preview is off by default: gear in the bar, no rail, favorites section as before', async ({ page }) => {
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

  test('turning the preview on still places focus in a browser without checkVisibility', async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(Element.prototype, 'checkVisibility');
    });
    await open(page);
    expect(await page.evaluate(() => typeof document.body.checkVisibility)).toBe('undefined');
    await page.locator('.VPNavBar .settings-trigger').click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'On', exact: true }).click();
    await expect(rail(page)).toBeVisible();
    await expect(page.locator('#settings-menu-panel').getByRole('button', { name: 'On', exact: true })).toBeFocused();
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

  // The 392px sidebar variable also moves where the top bar's controls start, and the gear is gone, so the
  // row is re-measured at the tightest one-row widths on a page with the sidebar and on one without.
  for (const [pagePath, label] of [
    [QUEUE_PAGE, 'an API page'],
    ['/', 'the home page'],
  ] as const) {
    for (const width of [960, 1000, 1280]) {
      test(`the top bar row fits at ${width}px on ${label} with the preview on`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await open(page, { [PREVIEW_KEY]: 'on' }, false, pagePath);
        const badge = page.locator('.VPNavBar .content-body > .version-badge');
        await expect(badge).toBeVisible();
        const boxes = [];
        for (const selector of [
          '.VPNavBar .language-toggle',
          '.VPNavBar .content-body > .search',
          '.VPNavBar .content-body > .VPNavBarMenu',
          '.VPNavBar .content-body > .version-badge',
        ]) {
          const box = await page.locator(selector).first().boundingBox();
          if (box) boxes.push(box);
        }
        expect(boxes.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < boxes.length; i++) {
          expect(boxes[i].x, 'controls do not overlap').toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 1);
        }
        const last = boxes[boxes.length - 1];
        expect(last.x + last.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await expect(page.locator('.VPNavBar .settings-trigger')).toBeHidden();
        // Only a page with the sidebar gives its 72px to the rail: the title lane elsewhere keeps its width.
        const title = await page.locator('.VPNavBar .container > .title').boundingBox();
        expect(title!.width).toBe(pagePath === QUEUE_PAGE && width >= 960 ? 392 : 320);
      });
    }
  }

  test('turning the preview on from the gear on a page without the rail keeps focus in the bar', async ({ page }) => {
    await open(page);
    await page.goto('/');
    await page.locator('.VPNavBar .settings-trigger').click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'On', exact: true }).click();
    await expect(page.locator('.VPNavBar .settings-trigger')).toBeHidden();
    await expect(page.locator('.VPNavBar .nav-search-btn-wait')).toBeFocused();
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
    await rail(page).getByRole('button', { name: 'Settings' }).click();
    const panel = await page.locator('#settings-menu-panel').boundingBox();
    expect(panel!.x).toBe(160);
  });

  test('on a short desktop window the Settings panel scrolls below the top bar instead of running off', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await open(page, { [PREVIEW_KEY]: 'on' });
    await rail(page).getByRole('button', { name: 'Settings' }).click();
    const panel = page.locator('#settings-menu-panel');
    const box = await panel.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(64);
    expect(box!.y + box!.height).toBe(392);
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });

  test('a click inside the sidebar closes the rail panel, and a click inside the panel does not', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await rail(page).getByRole('button', { name: 'Settings' }).click();
    const panel = page.locator('#settings-menu-panel');
    await expect(panel).toBeVisible();
    await panel.getByText('Site theme').click();
    await expect(panel).toBeVisible();
    await page.locator('.VPSidebar .nav-filter-input').click();
    await expect(panel).toBeHidden();
  });

  test('scrolling the sidebar leaves the rail and its panel where they are', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await open(page, { [PREVIEW_KEY]: 'on' });
    await rail(page).getByRole('button', { name: 'Settings' }).click();
    const railBefore = await rail(page).boundingBox();
    const panelBefore = await page.locator('#settings-menu-panel').boundingBox();
    const scrolled = await page.locator('.VPSidebar').evaluate((el) => {
      el.scrollTo(0, 200);
      return el.scrollTop;
    });
    expect(scrolled, 'the sidebar scrolled').toBeGreaterThan(0);
    expect((await rail(page).boundingBox())!.y).toBe(railBefore!.y);
    expect((await page.locator('#settings-menu-panel').boundingBox())!.y).toBe(panelBefore!.y);
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
  test('turning the preview on from the phone menu row moves focus to the menu button', async ({ page }) => {
    await open(page);
    await page.locator('.VPNavBarHamburger').click();
    const group = page.locator('.VPNavScreen').getByRole('group', { name: 'Explorer preview' });
    await group.getByRole('button', { name: 'On', exact: true }).click();
    await expect(group).toBeHidden();
    await expect(page.locator('.VPNavBarHamburger')).toBeFocused();
  });

  test('turning the preview off from the rail panel on a phone moves focus to the drawer filter', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    await page.getByRole('button', { name: /^Views/ }).click();
    await rail(page).getByRole('button', { name: 'Settings' }).click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'Off', exact: true }).click();
    await expect(rail(page)).toHaveCount(0);
    await expect(page.locator('.VPSidebar .nav-filter-input')).toBeFocused();
  });

  test('turning the preview off from the drawer at 800px keeps focus in the drawer, not on the gear behind it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    await page.getByRole('button', { name: /^Views/ }).click();
    await rail(page).getByRole('button', { name: 'Settings' }).click();
    await page.locator('#settings-menu-panel').getByRole('button', { name: 'Off', exact: true }).click();
    await expect(rail(page)).toHaveCount(0);
    await expect(page.locator('.VPSidebar .nav-filter-input')).toBeFocused();
  });
  test('on a landscape phone the Settings panel stays on screen and scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    await page.getByRole('button', { name: /^Views/ }).click();
    await rail(page).getByRole('button', { name: 'Settings' }).click();
    const panel = page.locator('#settings-menu-panel');
    const box = await panel.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(375);
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await panel.evaluate((el) => el.scrollTo(0, 0));
    await expect(panel.getByRole('group', { name: 'Site theme' })).toBeInViewport();
  });
  test('tabbing out of the unfolded rail folds it and leaves the drawer open', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    const views = page.getByRole('button', { name: /^Views/ });
    await views.click();
    await expect(rail(page)).toBeVisible();
    await rail(page).getByRole('button', { name: 'Settings' }).focus();
    // The Views button is the rail's own toggle, so focus may rest there with the rail unfolded.
    await page.keyboard.press('Tab');
    await expect(views).toBeFocused();
    await expect(rail(page)).toBeVisible();
    // The next stop is the filter behind the scrim; the rail folds and focus stays where the reader put it.
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
