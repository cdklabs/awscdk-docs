import { expect, test, type Page } from '@playwright/test';
import { CFN_QUEUE_PAGE, QUEUE_PAGE, SKILLS_PAGE, VERSIONS_PAGE } from './fixture.js';

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
    await expect(section.getByRole('heading', { name: 'Favorites (2)' })).toBeVisible();
    // Grouped by service, so the rows read A to Z inside their group rather
    // than in the order they were starred.
    await expect(section.locator('.favorites-group-name')).toHaveText(['Application integration']);
    await expect(section.locator('.favorites-link')).toHaveText(['Queue · SQS', 'Topic · SNS']);
    await expect(section.locator('.favorites-toggle')).toHaveCount(0);
    await expect(page.locator('.VPSidebar .nav-filter')).toBeHidden();
    await expect(page.locator('.VPSidebar .api-sidebar')).toBeHidden();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), VIEW_KEY)).toBe('favorites');

    // Back in the API view the section is gone again. The section is never in the server HTML, so this is
    // checked after the view was switched at runtime, while both entries are still stored.
    await rail(page).getByRole('button', { name: 'API' }).click();
    await expect(page.locator('.favorites-section')).toHaveCount(0);
    await rail(page).getByRole('button', { name: 'Favorites' }).click();

    await section.getByRole('button', { name: 'Remove Topic from Favorites' }).click();
    await section.getByRole('button', { name: 'Remove Queue from Favorites' }).click();
    await expect(section.getByRole('heading', { name: 'Favorites (0)' })).toBeVisible();
    await expect(section.locator('.favorites-empty')).toHaveText(
      /No favorites yet\.\s*Select the star \(☆\) on an API page to add it\./,
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
  // is measured at the tightest one-row widths on a page with the sidebar and on ones without.
  for (const [pagePath, label] of [
    [QUEUE_PAGE, 'an API page'],
    ['/', 'the home page'],
    [SKILLS_PAGE, 'the skills page'],
    [VERSIONS_PAGE, 'the versions page'],
  ] as const) {
    for (const width of [960, 1000, 1024, 1100, 1119, 1120, 1135, 1136, 1280, 1282, 1295, 1296]) {
      test(`the top bar row fits at ${width}px on ${label} with the preview on`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await open(page, { [PREVIEW_KEY]: 'on' }, false, pagePath);
        // The version badge leaves the bar from 960px to 1135px with the preview on; the Versions link covers it.
        const badge = '.VPNavBar .content-body > .version-badge';
        if (width < 1136) {
          await expect(page.locator(badge), 'the version badge is hidden below 1136px').toBeHidden();
        }
        const controls = [
          '.VPNavBar .language-toggle',
          '.VPNavBar .content-body > .search',
          '.VPNavBar .content-body > .VPNavBarMenu',
          ...(width < 1136 ? [] : [badge]),
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
        // The search button keeps at least its 36px icon width where the row is tightest.
        expect(boxes[1].width, 'the search button keeps its icon width').toBeGreaterThanOrEqual(36);
        // The last language tab keeps at least 8px from the search button, so a hovered tab's fill does not touch it.
        // The button sits inside the search wrapper, which itself starts flush with the tabs.
        const searchButton = await page.locator('.VPNavBar .content-body > .search .nav-search-btn-wait').boundingBox();
        expect(searchButton, 'the search button has a box').not.toBeNull();
        expect(searchButton!.x - (boxes[0].x + boxes[0].width), 'the tabs keep 8px from the search').toBeGreaterThanOrEqual(8);
        for (let i = 1; i < boxes.length; i++) {
          expect(boxes[i].x, 'controls do not overlap').toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 1);
        }
        const last = boxes[boxes.length - 1];
        expect(last.x + last.width, 'the gear ends at least 8px inside the viewport').toBeLessThanOrEqual(width - 8);
        // Same distance from the viewport edge as with the preview off.
        expect(width - (last.x + last.width), 'the gear sits 32px from the viewport edge').toBeCloseTo(32, 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await expect(page.locator('.VPNavBar .settings-trigger')).toBeVisible();
        // The title lane follows the preview, not the page: 392px on every page, so the controls do not move.
        expect(title!.width).toBe(392);
      });
    }
  }

  test('the Favorites view keeps the tree and filter until the view has rendered', async ({ page }) => {
    // Without the theme's scripts the heading never renders, which is the window before hydration.
    await page.route('**/*.js', (route) => route.abort());
    await page.addInitScript(
      ([preview, view]) => {
        window.localStorage.setItem(preview, 'on');
        window.localStorage.setItem(view, 'favorites');
      },
      [PREVIEW_KEY, VIEW_KEY],
    );
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('html')).toHaveAttribute('data-explorer-view', 'favorites');
    await expect(page.locator('.favorites-static-heading')).toHaveCount(0);
    await expect(page.locator('.VPSidebar .nav-filter')).toBeVisible();
    // Positive control: the same rule without the heading condition hides the filter.
    await page.addStyleTag({
      content:
        'html[data-explorer-preview="on"][data-explorer-view="favorites"] .VPSidebar :is(.nav-filter, .api-sidebar) { display: none; }',
    });
    await expect(page.locator('.VPSidebar .nav-filter')).toBeHidden();
  });

  test('in forced colors the selected rail button keeps a visible marker and the other does not', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page, { [PREVIEW_KEY]: 'on' });
    const colors = (name: string) =>
      rail(page)
        .getByRole('button', { name })
        .evaluate((el) => ({
          marker: getComputedStyle(el, '::before').backgroundColor,
          background: getComputedStyle(el.closest('.ExplorerRail') ?? el).backgroundColor,
        }));
    await expect(rail(page)).toBeVisible();
    // Forced colors flatten every background to the canvas color, so the marker has to differ from the rail's.
    const selected = await colors('API');
    expect(selected.marker, 'the selected marker is not transparent').not.toMatch(/, 0\)$/);
    expect(selected.marker, 'the selected marker differs from the rail background').not.toBe(selected.background);
    expect((await colors('Favorites')).marker, 'the other button has no marker').toMatch(/, 0\)$/);
    await page.locator('.VPNavBar .settings-trigger').click();
    const panel = page.locator('#settings-menu-panel');
    // The pressed switch segment stands out from the panel,
    // since the gear panel is the only cue on pages without the rail.
    const segment = (name: string) =>
      panel
        .getByRole('button', { name, exact: true })
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    const panelBackground = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await segment('On'), 'the pressed On segment differs from the panel background').not.toBe(panelBackground);
  });

  for (const [pagePath, label] of [
    [QUEUE_PAGE, 'an API page'],
    ['/', 'the home page'],
    [SKILLS_PAGE, 'the skills page'],
  ] as const) {
    test(`hiding the version badge keeps the gear at its 32px inset at 960px on ${label}`, async ({ page }) => {
      await page.setViewportSize({ width: 960, height: 800 });
      await open(page, { [PREVIEW_KEY]: 'on' }, false, pagePath);
      const gearEnd = async () => {
        const box = (await page.locator('.VPNavBar .settings-trigger').boundingBox())!;
        return box.x + box.width;
      };
      const withRule = await gearEnd();
      expect(960 - withRule, 'the gear sits 32px from the viewport edge').toBeCloseTo(32, 0);
      // Positive control: show the badge again and the row needs more room, so the gear moves right.
      await page.addStyleTag({ content: '.VPNavBar .content-body > .version-badge { display: flex !important; }' });
      const withoutRule = await gearEnd();
      expect(withoutRule - withRule, 'hiding the badge gives the row room back').toBeGreaterThanOrEqual(16);
      expect(960 - withoutRule, 'with the badge shown the gear loses its 32px inset').toBeLessThan(31);
    });
  }

  test('the title lane is 392px on every page with the preview on and 320px with it off', async ({ page }) => {
    const lane = async () => (await page.locator('.VPNavBar .container > .title').boundingBox())!.width;
    await open(page, { [PREVIEW_KEY]: 'on' });
    for (const path of [QUEUE_PAGE, '/', SKILLS_PAGE, VERSIONS_PAGE]) {
      await page.goto(path);
      expect(await lane(), `${path} with the preview on`).toBe(392);
    }
    const off = await page.context().newPage();
    await open(off, { [PREVIEW_KEY]: 'off' });
    for (const path of [QUEUE_PAGE, '/', SKILLS_PAGE, VERSIONS_PAGE]) {
      await off.goto(path);
      expect((await off.locator('.VPNavBar .container > .title').boundingBox())!.width, `${path} with it off`).toBe(320);
    }
  });

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
    await expect(page.locator('.favorites-section .favorites-link')).toHaveText([
      'Queue · SQS',
      'Topic · SNS',
    ]);
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
    for (const name of ['Off', 'On']) {
      const box = await group.getByRole('button', { name, exact: true }).boundingBox();
      expect(box!.width, `the ${name} segment is at least 44px wide`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `the ${name} segment is at least 44px tall`).toBeGreaterThanOrEqual(44);
    }
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
    const panel = page.locator('#settings-menu-panel');
    for (const name of ['Off', 'On']) {
      const box = await panel.getByRole('group', { name: 'Explorer preview' }).getByRole('button', { name, exact: true }).boundingBox();
      expect(box!.width, `the ${name} segment is at least 44px wide`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `the ${name} segment is at least 44px tall`).toBeGreaterThanOrEqual(44);
    }
    await panel.getByRole('button', { name: 'Off', exact: true }).click();
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

  test('the unfolded rail makes what it covers inert, and Tab wraps between its view buttons', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    const views = page.getByRole('button', { name: /^Views/ });
    const covered = page.locator('.VPSidebar .sidebar-header, .VPSidebar .api-sidebar');
    await expect(covered.first()).toBeAttached();
    expect(await covered.evaluateAll((els) => els.every((el) => !(el as HTMLElement).inert))).toBe(true);
    await views.click();
    await expect(rail(page)).toBeVisible();
    // The Views button, the filter, the Favorites list and the tree leave the accessibility tree and the tab order.
    expect(await covered.evaluateAll((els) => els.length > 0 && els.every((el) => (el as HTMLElement).inert))).toBe(true);
    await expect(rail(page).getByRole('button', { name: 'API' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(rail(page).getByRole('button', { name: 'API' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(rail(page).getByRole('button', { name: 'Favorites' })).toBeFocused();
    await expect(rail(page)).toBeVisible();
    // Folding hands everything back and returns focus to the Views button, with the drawer still open.
    await page.keyboard.press('Escape');
    await expect(rail(page)).toBeHidden();
    await expect(views).toBeFocused();
    expect(await covered.evaluateAll((els) => els.every((el) => !(el as HTMLElement).inert))).toBe(true);
    await expect(views).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.VPSidebar')).toHaveClass(/\bopen\b/);
    await page.keyboard.press('Tab');
    await expect(page.locator('.VPSidebar .nav-filter-input')).toBeFocused();
  });

  test('widening the viewport past 959px folds the rail and gives the sidebar back', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    await page.getByRole('button', { name: /^Views/ }).click();
    const covered = page.locator('.VPSidebar .sidebar-header, .VPSidebar .api-sidebar');
    expect(await covered.evaluateAll((els) => els.length > 0 && els.every((el) => (el as HTMLElement).inert))).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(() => covered.evaluateAll((els) => els.some((el) => (el as HTMLElement).inert))).toBe(false);
    await page.locator('.VPSidebar .nav-filter-input').focus();
    await expect(page.locator('.VPSidebar .nav-filter-input')).toBeFocused();
    await page.locator('.VPSidebar .api-sidebar-link').first().focus();
    await expect(page.locator('.VPSidebar .api-sidebar-link').first()).toBeFocused();
  });

  test('turning the preview off with the rail unfolded gives the sidebar back', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    await page.getByRole('button', { name: /^Views/ }).click();
    const covered = page.locator('.VPSidebar .sidebar-header, .VPSidebar .api-sidebar');
    expect(await covered.evaluateAll((els) => els.length > 0 && els.every((el) => (el as HTMLElement).inert))).toBe(true);
    // The phone menu carries the preview switch. The scrim covers the hamburger, so the clicks are dispatched.
    await page.locator('.VPNavBarHamburger').dispatchEvent('click');
    await page
      .locator('.VPNavScreen')
      .getByRole('group', { name: 'Explorer preview' })
      .getByRole('button', { name: 'Off', exact: true })
      .dispatchEvent('click');
    await expect(page.locator('html')).not.toHaveAttribute('data-explorer-preview', /.*/);
    await expect.poll(() => covered.evaluateAll((els) => els.some((el) => (el as HTMLElement).inert))).toBe(false);
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
    // VitePress moves focus outside the rail on every route change, and the focus rule would fold the rail on
    // its own. A capture listener stops that event, so only the route watcher can fold the rail here.
    await page.evaluate(() => document.addEventListener('focusin', (e) => e.stopPropagation(), true));
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

  test('focus moving out of the unfolded rail folds it and stays where it went', async ({ page }) => {
    await open(page, { [PREVIEW_KEY]: 'on' });
    await page.locator('.VPLocalNav button.menu').click();
    await page.getByRole('button', { name: /^Views/ }).click();
    await expect(rail(page)).toBeVisible();
    const outside = page.locator('.VPNavBarHamburger');
    await outside.focus();
    await expect(rail(page)).toBeHidden();
    await expect(outside).toBeFocused();
    const covered = page.locator('.VPSidebar .sidebar-header, .VPSidebar .api-sidebar');
    expect(await covered.evaluateAll((els) => els.some((el) => (el as HTMLElement).inert))).toBe(false);
  });
});
