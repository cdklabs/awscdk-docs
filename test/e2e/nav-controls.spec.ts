import { expect, test, type Page } from '@playwright/test';
import { SKILLS_PAGE, TOPIC_PAGE } from './fixture.js';

// Navbar layout: the language slider takes the leading slot, the search box
// is centered in the nav row, and the two tri-state theme groups sit behind
// the gear-icon Settings dropdown — inlined, they are six icon buttons in
// the row and crowd the search. The medium-view duplicate
// appearance switch (VitePress's "extra" flyout copy, shown 768-1279px)
// stays hidden — exactly one appearance control is reachable at every
// breakpoint.
test.describe('navbar layout', () => {
  test('the Settings dropdown picker cycles Light -> Dark -> Device', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const trigger = page.getByRole('button', { name: 'Settings' });
    await expect(trigger).toBeVisible();
    // Closed by default: the panel holds the controls, so nothing of the
    // picker is in the row until the disclosure is opened.
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.ThemePicker:visible')).toHaveCount(0);
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const picker = page.locator('.SettingsMenu .ThemePicker');
    await expect(picker).toBeVisible();
    // Each icon button carries a descriptive aria-label like "Light site
    // theme" so its name stays unique next to the Code theme group.
    const site = picker.getByRole('group', { name: 'Site theme' });
    const light = site.getByRole('button', { name: 'Light site theme' });
    const device = site.getByRole('button', { name: 'Follow the device theme' });
    const dark = site.getByRole('button', { name: 'Dark site theme' });
    await expect(light).toBeVisible();
    await expect(device).toBeVisible();
    await expect(dark).toBeVisible();

    await light.click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(light).toHaveAttribute('aria-pressed', 'true');

    await dark.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(dark).toHaveAttribute('aria-pressed', 'true');

    // Device follows the (emulated) OS preference and reacts live.
    await page.emulateMedia({ colorScheme: 'light' });
    await device.click();
    await expect(device).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('the theme choice persists across reloads (including Device)', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const trigger = page.getByRole('button', { name: 'Settings' });
    await trigger.click();
    const site = page
      .locator('.SettingsMenu .ThemePicker')
      .getByRole('group', { name: 'Site theme' });
    await site.getByRole('button', { name: 'Dark site theme' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    // The panel is closed again after the reload, so reopen before
    // asserting the restored state is reflected in the control.
    await trigger.click();
    await expect(
      site.getByRole('button', { name: 'Dark site theme' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.emulateMedia({ colorScheme: 'light' });
    await site.getByRole('button', { name: 'Follow the device theme' }).click();
    await page.reload();
    await trigger.click();
    await expect(
      site.getByRole('button', { name: 'Follow the device theme' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('slider leads, search centers, settings trigger sits right', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    // The pagefind plugin replaces VPNavBarSearch with its own component;
    // the `.search` passthrough class from VPNavBar survives the swap.
    const body = page.locator('.VPNavBar .content-body');
    const search = body.locator('> .search');
    const searchButton = search.locator('.nav-search-btn-wait');
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    const picker = body.locator('> .SettingsMenu');
    await expect(slider).toBeVisible();
    const bodyBox = await body.boundingBox();
    const searchBox = await searchButton.boundingBox();
    const sliderBox = await slider.boundingBox();
    const pickerBox = await picker.boundingBox();
    // Order: slider (leading, former search slot) < search < settings.
    expect(sliderBox!.x + sliderBox!.width).toBeLessThan(searchBox!.x);
    expect(searchBox!.x + searchBox!.width).toBeLessThan(pickerBox!.x);
    // The search trigger is centered within its flex region — i.e. it
    // sits in the middle of the gap between the slider and whatever
    // control follows it, not pinned against the slider.
    const searchRegion = await search.boundingBox();
    const regionCenter = searchRegion!.x + searchRegion!.width / 2;
    const buttonCenter = searchBox!.x + searchBox!.width / 2;
    expect(Math.abs(buttonCenter - regionCenter)).toBeLessThan(8);
    // And the whole row fits: the trigger's right edge stays inside the
    // nav row (no overflow pushing controls off-viewport).
    expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(
      bodyBox!.x + bodyBox!.width + 1,
    );
    // Switching via the slider flips the page's language tabs too (shared
    // language-state, no forked state).
    await slider.getByRole('radio', { name: 'Python' }).click();
    await expect(page).toHaveURL(/[?&]lang=python/);
    const firstTabGroup = page.locator('.lang-tabs').first();
    await expect(firstTabGroup).toHaveAttribute('data-active', 'python');
  });

  test('exactly one appearance control at the medium breakpoint, row fits', async ({ page }) => {
    // 768-1279px is where VitePress renders the "extra navigation" (…)
    // flyout with its own embedded appearance switch — the historical
    // duplicate that stays removed.
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.VPNavBarAppearance')).toBeHidden();
    await expect(page.locator('.VPNavBarExtra .item.appearance')).toBeHidden();
    const trigger = page.getByRole('button', { name: 'Settings' });
    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(1000);
    await trigger.click();
    // Exactly one picker is reachable: the panel's. The stock switch and
    // the flyout duplicate are hidden above, and the nav-screen copy is
    // display:none at this width.
    await expect(page.locator('.ThemePicker:visible')).toHaveCount(1);
    await page
      .locator('.SettingsMenu .ThemePicker')
      .getByRole('group', { name: 'Site theme' })
      .getByRole('button', { name: 'Dark site theme' })
      .click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  for (const width of [768, 800, 960]) {
    test(`the row stays inside the viewport at ${width}px`, async ({ page }) => {
      // Below 960px the title shares the row with the controls and yields its
      // width; from 960px it is the fixed sidebar lane and the badge and gear
      // give up their gaps instead. Either way the gear, which sits last, must
      // end inside the viewport and the bar must not scroll sideways.
      await page.setViewportSize({ width, height: 800 });
      await page.goto(TOPIC_PAGE);
      const wrapper = page.locator('.VPNavBar .wrapper');
      const gear = page.getByRole('button', { name: 'Settings' });
      const badge = page.locator('.VPNavBar .content-body > .version-badge');
      await expect(gear).toBeVisible();
      await expect(badge).toBeVisible();
      const gearBox = await gear.boundingBox();
      expect(gearBox!.x + gearBox!.width).toBeLessThanOrEqual(width);
      const overflows = (element: Element) => element.scrollWidth > element.clientWidth + 1;
      expect(await wrapper.evaluate(overflows)).toBe(false);

      // Positive control at the narrowest width, where the title at its natural size does not fit beside the
      // controls: undo the rule that makes room and the bar must overflow again. Wider rows hold the title as is.
      if (width === 768) {
        await page.locator('.VPNavBar .container > .title').evaluate((element) => {
          (element as HTMLElement).style.flexShrink = '0';
        });
        expect(await wrapper.evaluate(overflows)).toBe(true);
      }
    });
  }

  test('at 768px the title truncates instead of the controls', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto(TOPIC_PAGE);
    const label = page.locator('.VPNavBarTitle .title > span');
    await expect(label).toHaveText('AWS CDK Reference');
    const clipped = await label.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(clipped).toBe(true);
    const labelBox = await label.boundingBox();
    const search = await page.locator('.VPNavBar .content-body > .search').boundingBox();
    expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(search!.x);
  });

  test('row fits at 1280px, the tightest desktop width', async ({ page }) => {
    // 1280px is where the desktop layout starts and the social links
    // reappear in the row, making it the tightest desktop width. Guard it
    // explicitly: the settings trigger must stay inside the viewport, the
    // document must not overflow horizontally, and the search trigger must
    // keep a usable width. Folding the six theme buttons into one gear is
    // what gives this row its slack.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(TOPIC_PAGE);
    const picker = page.locator('.VPNavBar .content-body > .SettingsMenu');
    await expect(picker).toBeVisible();
    const pickerBox = await picker.boundingBox();
    expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(1280);
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBe(1280);
    const searchButton = page.locator(
      '.VPNavBar .content-body > .search .nav-search-btn-wait',
    );
    await expect(searchButton).toBeVisible();
    // The trigger absorbs the squeeze, so it is where a future width change
    // shows up first. What must hold is that its label and shortcut hint still
    // fit — an exact pixel floor encodes one platform's font metrics, so the
    // clipping check is the guard and the width is only a collapse tripwire.
    const clipped = (btn: Element) =>
      [btn, ...btn.querySelectorAll('*')].some((el) => el.scrollWidth > el.clientWidth + 1);
    expect(await searchButton.evaluate(clipped)).toBe(false);
    const searchBox = await searchButton.boundingBox();
    expect(searchBox!.width).toBeGreaterThanOrEqual(120);

    // Positive control: a guard that cannot fail is not a guard. Squeezing the
    // trigger must flip the check the assertion above relies on.
    await searchButton.evaluate((el) => {
      (el as HTMLElement).style.maxWidth = '60px';
    });
    expect(await searchButton.evaluate(clipped)).toBe(true);
    await searchButton.evaluate((el) => {
      (el as HTMLElement).style.maxWidth = '';
    });
  });

  test('the disclosure closes on Escape and on an outside click', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const trigger = page.getByRole('button', { name: 'Settings' });
    const panel = page.locator('#settings-menu-panel');
    await expect(trigger).toHaveAttribute('aria-controls', 'settings-menu-panel');

    // Escape closes and returns focus to the trigger.
    await trigger.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();

    // A click outside closes it, and focus is never trapped: the rest of
    // the navbar stays reachable while the panel is open.
    await trigger.click();
    await expect(panel).toBeVisible();
    // The site title is outside the SettingsMenu subtree. VPNavBar renders
    // it in both the title bar and the nav-bar content, so pick one.
    await page.locator('.VPNavBar .title').first().click();
    await expect(panel).toBeHidden();

    // Enter on the focused trigger toggles it (a real <button>).
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
  });

  test('the mobile nav screen keeps a direct picker row (no nested dropdown)', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(TOPIC_PAGE);
    // The navbar dropdown is hidden below 768px; the hamburger screen
    // carries the picker itself, one tap deep rather than two.
    await expect(page.locator('.VPNavBar .content-body > .SettingsMenu')).toBeHidden();
    await page.locator('.VPNavBarHamburger').click();
    const picker = page.locator('.VPNavScreen .ThemePicker');
    await expect(picker).toBeVisible();
    await expect(page.locator('.VPNavScreen .SettingsMenu')).toHaveCount(0);
    await picker
      .getByRole('group', { name: 'Site theme' })
      .getByRole('button', { name: 'Dark site theme' })
      .click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('keyboard: arrow keys move and select within the slider', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    await slider.getByRole('radio', { name: 'TypeScript' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(slider.getByRole('radio', { name: 'Python' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(slider.getByRole('radio', { name: 'Python' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(
      slider.getByRole('radio', { name: 'TypeScript' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});

// The nav row's geometry must not depend on the page. VitePress
// keys four geometry rules on its own `has-sidebar` class, and in this repo
// that class is set on /api/** but NOT on / (layout: home) or /skills
// (themeConfig.sidebar is keyed only on /api/). The row's left inset is
// therefore var(--vp-sidebar-width) on reference pages and
// `32px + title width` elsewhere — a 97px difference that lands on the
// LEADING control, the language slider, and half of which lands on the
// flex-centered search trigger.
//
// This is the first navbar assertion in the suite that crosses pages. Every
// other one runs against TOPIC_PAGE alone, i.e. only the has-sidebar state,
// which is exactly why none of them could see this.
test.describe('navbar geometry is page-independent', () => {
  // Every desktop width the split occurs at: 1280px is the tightest desktop
  // width, 1440px is where VitePress switches to its centered tier, and
  // 1600px is past it. Below 960px both page types are already identical.
  const WIDTHS = [1280, 1440, 1600];
  const PAGES = ['/', SKILLS_PAGE, TOPIC_PAGE];

  // Read the x of each control the row's inset can move. The gear is
  // included because it does NOT move today: asserting it locks in that the
  // fix does not start moving the right-hand end of the row.
  async function controlOrigins(page: Page) {
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    const searchButton = page.locator(
      '.VPNavBar .content-body > .search .nav-search-btn-wait',
    );
    const gear = page.locator('.VPNavBar .content-body > .SettingsMenu');
    await expect(slider).toBeVisible();
    await expect(searchButton).toBeVisible();
    await expect(gear).toBeVisible();
    return {
      slider: (await slider.boundingBox())!.x,
      search: (await searchButton.boundingBox())!.x,
      gear: (await gear.boundingBox())!.x,
    };
  }

  for (const width of WIDTHS) {
    test(`slider, search trigger and gear sit at the same x on every page at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const measured: Record<string, Awaited<ReturnType<typeof controlOrigins>>> = {};
      for (const path of PAGES) {
        await page.goto(path);
        measured[path] = await controlOrigins(page);
      }
      const reference = measured[TOPIC_PAGE];
      for (const path of PAGES) {
        for (const control of ['slider', 'search', 'gear'] as const) {
          expect(
            Math.abs(measured[path][control] - reference[control]),
            `${control} x on ${path} vs ${TOPIC_PAGE} at ${width}px`,
          ).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  test('one continuous divider under the bar on every page', async ({ page }) => {
    // Every page draws the line from one element, un-inset, with the title
    // lane's border transparent.
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of PAGES) {
      await page.goto(path);
      const dividerInset = await page
        .locator('.VPNavBar .divider')
        .evaluate((el) => getComputedStyle(el).paddingLeft);
      expect(dividerInset, `divider padding-left on ${path}`).toBe('0px');
      const titleBorder = await page
        .locator('.VPNavBarTitle > a.title')
        .evaluate((el) => getComputedStyle(el).borderBottomColor);
      expect(titleBorder, `title border-bottom-color on ${path}`).toBe('rgba(0, 0, 0, 0)');
      // Positive geometry, so this cannot pass by the line not being drawn:
      // the one segment reaches both edges of the viewport.
      const line = await page.locator('.VPNavBar .divider-line').boundingBox();
      expect(Math.round(line!.x), `divider line left on ${path}`).toBe(0);
      expect(Math.round(line!.x + line!.width), `divider line right on ${path}`).toBe(1280);
    }
  });

  test('the site title holds the secondary text color in every state', async ({
    page,
  }) => {
    // The nav links keep their brand-color hover — asserted here so the
    // title's pin cannot be widened into pinning the whole row.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(TOPIC_PAGE);
    const title = page.locator('.VPNavBarTitle > a.title');
    const secondary = await page
      .locator('html')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--vp-c-text-2').trim());
    const colorOf = () => title.evaluate((el) => getComputedStyle(el).color);
    const expected = await page.evaluate((token) => {
      const probe = document.createElement('span');
      probe.style.color = token;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    }, secondary);

    expect(await colorOf()).toBe(expected);
    await title.hover();
    expect(await colorOf()).toBe(expected);
    const box = (await title.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    expect(await colorOf()).toBe(expected);
    await page.mouse.up();

    const navLink = page.locator('.VPNavBarMenuLink').first();
    const navIdle = await navLink.evaluate((el) => getComputedStyle(el).color);
    await navLink.hover();
    await expect
      .poll(() => navLink.evaluate((el) => getComputedStyle(el).color))
      .not.toBe(navIdle);
  });

  test('below 960px the pages stay identical, as they already are', async ({ page }) => {
    // The stock rules are all @media (min-width: 960px) and so are the new
    // ones; this is the floor that proves neither tier leaked downward.
    await page.setViewportSize({ width: 900, height: 800 });
    const insets: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      insets.push(
        await page
          .locator('.VPNavBar .content')
          .evaluate((el) => getComputedStyle(el).paddingLeft),
      );
    }
    expect(new Set(insets).size).toBe(1);
  });

  test('the home button holds one background color across hydration', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      (window as unknown as { __bg: string[] }).__bg = [];
      const start = performance.now();
      const sample = () => {
        const lane = document.querySelector('.VPNavBar > .wrapper > .container > .title');
        if (lane) (window as unknown as { __bg: string[] }).__bg.push(getComputedStyle(lane).backgroundColor);
        if (performance.now() - start < 1500) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    await page.goto(TOPIC_PAGE);
    await page.waitForTimeout(1600);
    const samples = await page.evaluate(() => (window as unknown as { __bg: string[] }).__bg);
    const [pageBackground, altSurface] = await page.evaluate(() =>
      ['--vp-c-bg', '--vp-c-bg-alt'].map((token) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = `var(${token})`;
        document.body.appendChild(probe);
        const resolved = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return resolved;
      }),
    );

    expect(samples.length).toBeGreaterThan(30);
    expect(new Set(samples)).toEqual(new Set([pageBackground]));
    expect(pageBackground).not.toBe(altSurface);
  });

  test('the landing page keeps a transparent bar over the hero', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('.VPNavBar')).toHaveClass(/\bhome\b/);
    await expect
      .poll(() =>
        page
          .locator('.VPNavBar > .wrapper > .container > .title')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .toBe('rgba(0, 0, 0, 0)');
  });

  test('the home button changes color in one step when leaving the landing page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const lane = '.VPNavBar > .wrapper > .container > .title';
    await expect
      .poll(() => page.locator(lane).evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgba(0, 0, 0, 0)');

    await page.evaluate((sel) => {
      (window as unknown as { __nav: string[] }).__nav = [];
      const start = performance.now();
      const sample = () => {
        const el = document.querySelector(sel);
        if (el) (window as unknown as { __nav: string[] }).__nav.push(getComputedStyle(el).backgroundColor);
        if (performance.now() - start < 1500) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, lane);

    await page.locator('.VPNavBarMenuLink[href="/v2/"]').first().click();
    await page.waitForTimeout(1600);

    const samples = await page.evaluate(() => (window as unknown as { __nav: string[] }).__nav);
    const pageBackground = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--vp-c-bg)';
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return resolved;
    });

    expect(samples.length).toBeGreaterThan(30);
    await expect(page.locator('.VPNavBar')).not.toHaveClass(/\bhome\b/);
    expect(new Set(samples)).toEqual(new Set(['rgba(0, 0, 0, 0)', pageBackground]));
  });
});
