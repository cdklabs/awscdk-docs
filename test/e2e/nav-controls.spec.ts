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
    // With its only item hidden the flyout has nothing to show, so the
    // whole flyout, trigger included, is hidden too.
    await expect(page.locator('.VPNavBarExtra')).toBeHidden();
    await expect(page.getByRole('button', { name: 'extra navigation' })).toBeHidden();
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

  for (const width of [768, 1000, 1279]) {
    test(`no empty "extra navigation" flyout at ${width}px`, async ({ page }) => {
      // The flyout's only content is the hidden appearance item, so its
      // trigger would open an empty menu. It must be neither visible nor
      // focusable, on the home page and on an API page.
      await page.setViewportSize({ width, height: 800 });
      for (const path of ['/', TOPIC_PAGE]) {
        await page.goto(path);
        await expect(page.locator('.VPNavBarExtra')).toBeHidden();
        await expect(page.getByRole('button', { name: 'extra navigation' })).toBeHidden();
      }
    });
  }

  test('tabbing at 1000px skips straight from the badge to the Settings gear', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(TOPIC_PAGE);
    const focusedNavControls: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest('.VPNavBar')) return null;
        return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
      });
      if (label === null) continue;
      focusedNavControls.push(label);
      if (label === 'Settings') break;
    }
    expect(focusedNavControls).toContain('Settings');
    expect(focusedNavControls).not.toContain('extra navigation');
  });

  for (const width of [768, 800, 900, 960, 1024, 1099, 1100, 1279]) {
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

      if (width === 768) {
        await page.locator('.VPNavBar .container > .title').evaluate((element) => {
          const title = element as HTMLElement;
          title.style.flexShrink = '0';
          title.style.width = '500px';
        });
        expect(await wrapper.evaluate(overflows)).toBe(true);
      }
    });
  }

  const titleWidths = [
    [320, 'logo'],
    [360, 'logo'],
    [390, 'short'],
    [430, 'full'],
    [768, 'logo'],
    [960, 'full'],
    [1280, 'full'],
  ] as const;

  for (const [width, visibleLabel] of titleWidths) {
    test(`the title uses its ${visibleLabel} form at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ['/', TOPIC_PAGE]) {
        await page.goto(path);
        const title = page.locator('.VPNavBarTitle > a.title');
        const full = title.locator('.nav-site-title-full');
        const short = title.locator('.nav-site-title-short');

        await expect(title).toHaveAccessibleName('AWS CDK Reference');
        await expect(title).toHaveAttribute('href', '/');
        if (visibleLabel === 'full') {
          await expect(full).toBeVisible();
        } else {
          await expect(full).toBeHidden();
        }
        if (visibleLabel === 'short') {
          await expect(short).toBeVisible();
        } else {
          await expect(short).toBeHidden();
        }

        const visibleTextClips = await title.evaluate((element) =>
          [...element.querySelectorAll<HTMLElement>('.nav-site-title-full, .nav-site-title-short')]
            .filter((part) => getComputedStyle(part).display !== 'none')
            .some((part) => part.scrollWidth > part.clientWidth + 1),
        );
        expect(visibleTextClips, `${path} at ${width}px`).toBe(false);

        const titleBox = (await title.boundingBox())!;
        const content = page.locator('.VPNavBar .content');
        const contentBox = (await content.boundingBox())!;
        const contentPadding = await content.evaluate((el) =>
          parseFloat(getComputedStyle(el).paddingLeft),
        );
        expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(
          contentBox.x + contentPadding + 1,
        );
        if (width < 768) {
          expect(titleBox.height).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }

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

  // Every width the one-row layout has to hold at: the desktop tiers, both
  // sides of each tab-padding step (1280/1279 is covered above, 1100/1099 and
  // 1024/960 here), both sides of the 960px title lane, both sides of the
  // 768px phone switch, and two phone widths.
  const ROW_WIDTHS = [1440, 1359, 1280, 1180, 1100, 1099, 1024, 960, 959, 900, 768, 767, 375, 320];

  for (const theme of ['light', 'dark'] as const) {
    test(`no horizontal scroll and no overlapping bar controls at any width (${theme})`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem('vitepress-theme-appearance', t), theme);
      for (const width of ROW_WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(TOPIC_PAGE);
        await expect(page.locator('.VPNavBar .content-body > .search')).toBeVisible();
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth, `scroll width at ${width}px`).toBe(width);
        // The painted boxes of the title link and every visible control in the
        // row, left to right; each must end before the next one starts.
        const boxes = await page.evaluate(() => {
          const nodes = [
            document.querySelector('.VPNavBar .VPNavBarTitle > a.title'),
            ...document.querySelectorAll('.VPNavBar .content-body > *'),
          ];
          return nodes
            .filter((el): el is HTMLElement => el instanceof HTMLElement)
            .map((el) => ({ name: el.className.split(' ')[0] || el.tagName, box: el.getBoundingClientRect() }))
            .filter(({ box }) => box.width > 0 && box.height > 0)
            .map(({ name, box }) => ({ name, left: box.left, right: box.right }))
            .sort((a, b) => a.left - b.left);
        });
        expect(boxes.length, `controls at ${width}px`).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < boxes.length; i++) {
          expect(
            boxes[i].left,
            `${boxes[i - 1].name} overlaps ${boxes[i].name} at ${width}px (${theme})`,
          ).toBeGreaterThanOrEqual(boxes[i - 1].right - 1);
        }
        expect(boxes[boxes.length - 1].right, `last control at ${width}px`).toBeLessThanOrEqual(width);
      }
    });
  }

  // A single-language build renders no language toggle, so the rules gated on
  // `.content-body:has(> .language-toggle)` do not apply and the search keeps
  // its label and padding at 768-959px. The fixture is multi-language, so the
  // toggle is removed from the DOM before the row is measured.
  test('a single-language bar fits, does not overlap and keeps 44px targets', async ({ page }) => {
    for (const width of [959, 800, 768, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(TOPIC_PAGE);
      await page.locator('.VPNavBar .language-toggle').evaluateAll((els) => els.forEach((el) => el.remove()));
      await expect(page.locator('.VPNavBar .language-toggle')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `scroll width at ${width}px`).toBe(
        width,
      );
      const boxes = await page.evaluate(() => {
        const nodes = [
          document.querySelector('.VPNavBar .VPNavBarTitle > a.title'),
          ...document.querySelectorAll('.VPNavBar .content-body > *'),
        ];
        return nodes
          .filter((el): el is HTMLElement => el instanceof HTMLElement)
          .map((el) => ({ name: el.className.split(' ')[0] || el.tagName, box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && box.height > 0)
          .map(({ name, box }) => ({ name, left: box.left, right: box.right }))
          .sort((a, b) => a.left - b.left);
      });
      expect(boxes.length, `controls at ${width}px`).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].left, `${boxes[i - 1].name} overlaps ${boxes[i].name} at ${width}px`).toBeGreaterThanOrEqual(
          boxes[i - 1].right - 1,
        );
      }
      expect(boxes[boxes.length - 1].right, `last control at ${width}px`).toBeLessThanOrEqual(width);
      const atLeast44 = async (name: string, selector: string) => {
        const box = (await page.locator(selector).boundingBox())!;
        expect(box, `${name} is painted at ${width}px`).not.toBeNull();
        expect(Math.round(box.width), `${name} width at ${width}px`).toBeGreaterThanOrEqual(44);
        expect(Math.round(box.height), `${name} height at ${width}px`).toBeGreaterThanOrEqual(44);
      };
      await atLeast44('logo link', '.VPNavBar .VPNavBarTitle > a.title');
      await atLeast44('version', '.VPNavBar .content-body > .version-badge');
      await atLeast44('search', '.VPNavBar .content-body > .search .nav-search-btn-wait');
      const search = page.locator('.VPNavBar .content-body > .search .nav-search-btn-wait');
      if (width >= 768) {
        await atLeast44('gear', '.VPNavBar .content-body > .SettingsMenu .settings-trigger');
        // Without the toggle the search stays a labeled pill, not a 44px disc.
        await expect(search.locator('.search-tip')).toBeVisible();
        expect(await search.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('20px');
        expect((await search.boundingBox())!.width).toBeGreaterThan(44);
      } else {
        await expect(search.locator('.search-tip')).toBeHidden();
      }
    }
  });

  test('from 768px up the bar is one row and the first tab reads TS below 1100px', async ({ page }) => {
    for (const width of [1099, 1024, 960, 900, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(TOPIC_PAGE);
      const tabs = page.getByRole('radiogroup', { name: 'Select programming language' }).getByRole('radio');
      await expect(tabs).toHaveCount(5);
      const tops = new Set(
        (await tabs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))),
      );
      expect(tops.size, `tabs on one line at ${width}px`).toBe(1);
      await expect(tabs.first().locator('.language-abbr')).toHaveText('TS');
      await expect(tabs.first().locator('.language-abbr')).toBeVisible();
      await expect(page.locator('.VPNavBar .VPNavBarHamburger')).toBeHidden();
    }
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(TOPIC_PAGE);
      const tabs = page.getByRole('radiogroup', { name: 'Select programming language' }).getByRole('radio');
      await expect(tabs).toHaveCount(5);
      // The painted text is the full name on every tab: the badge is out of the
      // paint and the name is in flow (both forms sit in the markup).
      const painted = await tabs.evaluateAll((els) =>
        els.map((el) =>
          [...el.querySelectorAll<HTMLElement>('span')]
            .filter((span) => span.getBoundingClientRect().width > 1)
            .map((span) => span.textContent?.trim())
            .join(''),
        ),
      );
      expect(painted).toEqual(['TypeScript', 'Python', 'Java', 'C#', 'Go']);
      await expect(page.locator('.VPNavBar .content-body > .search .metaKey')).toBeVisible();
    }
  });

  for (const width of [768, 375, 320]) {
    test(`every bar, dropdown and menu control is at least 44x44px at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(TOPIC_PAGE);
      const atLeast44 = async (name: string, selector: string) => {
        const boxes = await page.locator(selector).evaluateAll((els) =>
          els
            .map((el) => el.getBoundingClientRect())
            .filter((box) => box.width > 0 && box.height > 0)
            // Whole pixels: a laid-out 44px box can report 43.9999 mid-paint.
            .map((box) => ({ width: Math.round(box.width), height: Math.round(box.height) })),
        );
        expect(boxes.length, `${name} is painted at ${width}px`).toBeGreaterThan(0);
        for (const box of boxes) {
          expect(box.width, `${name} width at ${width}px`).toBeGreaterThanOrEqual(44);
          expect(box.height, `${name} height at ${width}px`).toBeGreaterThanOrEqual(44);
        }
      };
      await atLeast44('logo link', '.VPNavBar .VPNavBarTitle > a.title');
      await atLeast44('version', '.VPNavBar .content-body > .version-badge');
      await atLeast44('search', '.VPNavBar .content-body > .search .nav-search-btn-wait');
      if (width >= 768) {
        await atLeast44('gear', '.VPNavBar .content-body > .SettingsMenu .settings-trigger');
        await atLeast44('tabs', '.VPNavBar .language-toggle .language-option');
        // The gear still opens the dropdown here, so its pickers grow too.
        await page.getByRole('button', { name: 'Settings' }).click();
        await expect(page.locator('#settings-menu-panel')).toBeVisible();
        await atLeast44('dropdown theme options', '.VPNavBar .SettingsMenu .theme-picker-option');
        await atLeast44('dropdown navigation options', '.VPNavBar .SettingsMenu .nav-style-option');
      } else {
        await atLeast44('menu button', '.VPNavBar .VPNavBarHamburger');
        await page.locator('.VPNavBarHamburger').click();
        await expect(page.locator('.VPNavScreen')).toBeVisible();
        await atLeast44('menu languages', '.VPNavScreen .language-toggle .language-option');
        await atLeast44('menu theme options', '.VPNavScreen .ThemePicker .theme-picker-option');
        await atLeast44('menu navigation options', '.VPNavScreen .NavStylePicker .nav-style-option');
        // The picker groups grow with their 44px segments and wrap inside the
        // menu instead of overflowing it.
        const menu = (await page.locator('.VPNavScreen .container').boundingBox())!;
        for (const box of await page
          .locator('.VPNavScreen .theme-picker-group, .VPNavScreen .nav-style-group')
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))) {
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.right).toBeLessThanOrEqual(menu.x + menu.width + 1);
        }
      }
    });
  }

  for (const [theme, edge, bar, focus] of [
    ['light', 'rgb(101, 104, 113)', 'rgb(255, 255, 255)', 'rgb(0, 108, 224)'],
    ['dark', 'rgb(164, 164, 173)', 'rgb(22, 29, 38)', 'rgb(66, 180, 255)'],
  ] as const) {
    test(`the search box is an outlined pill on the bar, an icon below 960px, bare below 768px (${theme})`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem('vitepress-theme-appearance', t), theme);
      const search = page.locator('.VPNavBar .content-body > .search .nav-search-btn-wait');
      const paint = (el: Element) => {
        const s = getComputedStyle(el);
        return {
          border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
          radius: s.borderTopLeftRadius,
          fill: s.backgroundColor,
          ring: s.boxShadow,
        };
      };

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(TOPIC_PAGE);
      expect(await search.evaluate(paint)).toEqual({
        border: `1px solid ${edge}`,
        radius: '20px',
        fill: bar,
        ring: 'none',
      });
      const box = (await search.boundingBox())!;
      expect(box.height).toBeCloseTo(40, 0);
      // The shortcut chip takes the same edge, so it reads as part of the box.
      expect(
        await search.locator('.metaKey').evaluate((el) => getComputedStyle(el).borderTopColor),
      ).toBe(edge);
      await search.hover();
      await expect
        .poll(() => search.evaluate((el) => getComputedStyle(el).borderTopColor))
        .toBe(focus);
      expect((await search.evaluate(paint)).ring).toBe(`${focus} 0px 0px 0px 1px`);

      // Tablet: the pill is a 44px disc holding only the icon.
      await page.setViewportSize({ width: 800, height: 800 });
      await page.goto(TOPIC_PAGE);
      expect((await search.evaluate(paint)).border).toBe(`1px solid ${edge}`);
      const disc = (await search.boundingBox())!;
      expect(disc.width).toBeCloseTo(44, 0);
      expect(disc.height).toBeCloseTo(44, 0);
      await expect(search.locator('.metaKey')).toBeHidden();

      // Phone: the plugin's bare icon, no edge and no fill.
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(TOPIC_PAGE);
      const phone = await search.evaluate(paint);
      // `border: 0` leaves the color in the computed style; the width and style
      // are what remove the edge.
      expect(phone.border).toMatch(/^0px none /);
      expect(phone.radius).toBe('0px');
      expect(phone.fill).toBe('rgba(0, 0, 0, 0)');
      expect(phone.ring).toBe('none');
      expect((await search.boundingBox())!.width).toBeCloseTo(48, 0);
      // Hover (and the sticky hover after a tap) must not bring the ring back.
      await search.hover();
      await search.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      expect((await search.evaluate(paint)).ring).toBe('none');
    });
  }

  test('keyboard focus draws the ring inside a tab and outside the search box', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(TOPIC_PAGE);
    const ring = (el: Element) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineOffset}`;
    };
    const tab = page.getByRole('radiogroup', { name: 'Select programming language' }).getByRole('radio', {
      name: 'TypeScript',
    });
    await tab.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(tab).toBeFocused();
    expect(await tab.evaluate(ring)).toBe('solid 2px -3px');

    // The search ring applies to each of its shapes: outside the pill from
    // 960px and the disc at 768-959px, inset on the bare full-height icon
    // below 768px; in every case the whole ring stays inside the viewport.
    for (const [width, offset] of [
      [1280, 2],
      [800, 2],
      [375, -2],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(TOPIC_PAGE);
      const search = page.locator('.VPNavBar .content-body > .search .nav-search-btn-wait');
      await search.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(search).toBeFocused();
      expect(await search.evaluate(ring), `search ring at ${width}px`).toBe(`solid 2px ${offset}px`);
      const box = (await search.boundingBox())!;
      // Outer edge of the ring: the box edge plus the offset plus the 2px line.
      const reach = offset + 2;
      expect(box.x - reach, `ring inside the viewport at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width + reach, `ring inside the viewport at ${width}px`).toBeLessThanOrEqual(width);
      expect(box.y - reach, `ring inside the viewport at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height + reach, `ring inside the viewport at ${width}px`).toBeLessThanOrEqual(800);
    }
  });

  for (const [theme, muted, hoverText] of [
    ['light', 'rgb(66, 70, 80)', 'rgb(15, 20, 26)'],
    // Dark idle ink equals the primary text, so hover lightens it further.
    ['dark', 'rgb(198, 198, 205)', 'rgb(235, 235, 240)'],
  ] as const) {
    test(`idle tabs, the search label, the version and the gear share one muted ink (${theme})`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem('vitepress-theme-appearance', t), theme);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(TOPIC_PAGE);
      const color = (el: Element) => getComputedStyle(el).color;
      const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
      expect(await slider.getByRole('radio', { name: 'Python' }).evaluate(color)).toBe(muted);
      expect(await page.locator('.VPNavBar .content-body > .search .nav-search-btn-wait').evaluate(color)).toBe(muted);
      expect(await page.locator('.VPNavBar .content-body > .search .search-tip').evaluate(color)).toBe(muted);
      expect(await page.locator('.VPNavBar .content-body > .version-badge').evaluate(color)).toBe(muted);
      expect(await page.getByRole('button', { name: 'Settings' }).evaluate(color)).toBe(muted);
      // Hovering an idle tab, the version or the gear fills it and paints it
      // in the bar's hover text, which is darker than the idle ink in light
      // mode and lighter in dark mode.
      const python = slider.getByRole('radio', { name: 'Python' });
      await python.hover();
      await expect.poll(() => python.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await expect.poll(() => python.evaluate(color)).toBe(hoverText);
      const gear = page.getByRole('button', { name: 'Settings' });
      await gear.hover();
      await expect.poll(() => gear.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await expect.poll(() => gear.evaluate(color)).toBe(hoverText);
      const version = page.locator('.VPNavBar .content-body > .version-badge');
      await version.hover();
      await expect.poll(() => version.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await expect.poll(() => version.evaluate(color)).toBe(hoverText);
      // The search button's own ink follows too (its label and chip keep the
      // muted ink; the pill's hover cue is the brand ring).
      const searchBtn = page.locator('.VPNavBar .content-body > .search .nav-search-btn-wait');
      await searchBtn.hover();
      await expect.poll(() => searchBtn.evaluate(color)).toBe(hoverText);
      // The open gear keeps the hover fill and text with the pointer elsewhere.
      await gear.click();
      await expect(gear).toHaveAttribute('aria-expanded', 'true');
      await page.mouse.move(0, 0);
      await expect.poll(() => gear.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await expect.poll(() => gear.evaluate(color)).toBe(hoverText);
    });
  }

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
  // width, 1440px is where VitePress switches to its centered tier, 1600px is
  // past it, and 1920px and 2560px are in the wide tier (wide-layout.css),
  // where the layout max width changes under both page types at once.
  const WIDTHS = [1280, 1440, 1600, 1920, 2560];
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

  test('the desktop title has primary color, clear spacing, and focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(TOPIC_PAGE);
      const title = page.locator('.VPNavBarTitle > a.title');
      const primary = await page
        .locator('html')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--vp-c-text-1').trim());
      const colorOf = () => title.evaluate((el) => getComputedStyle(el).color);
      const expected = await page.evaluate((token) => {
        const probe = document.createElement('span');
        probe.style.color = token;
        document.body.appendChild(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      }, primary);

      expect(await colorOf()).toBe(expected);
      await title.hover();
      expect(await colorOf()).toBe(expected);
      const box = (await title.boundingBox())!;
      await page.mouse.move(box.x + 10, box.y + box.height / 2);
      await page.mouse.down();
      expect(await colorOf()).toBe(expected);
      await page.mouse.up();

      const contrast = await title.evaluate((el) => {
        const channels = (value: string) =>
          (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const luminance = (value: string) => {
          const linear = channels(value).map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        const style = getComputedStyle(el);
        const foreground = luminance(style.color);
        let surface: Element | null = el;
        let background = style.backgroundColor;
        while (surface && background === 'rgba(0, 0, 0, 0)') {
          surface = surface.parentElement;
          if (surface) background = getComputedStyle(surface).backgroundColor;
        }
        const backgroundLuminance = luminance(background);
        return (Math.max(foreground, backgroundLuminance) + 0.05) /
          (Math.min(foreground, backgroundLuminance) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }

    const title = page.locator('.VPNavBarTitle > a.title');
    const logoBox = (await title.locator('img.logo').boundingBox())!;
    const labelBox = (await title.locator('.nav-site-title-full').boundingBox())!;
    const gap = labelBox.x - (logoBox.x + logoBox.width);
    expect(gap).toBeGreaterThanOrEqual(12);
    expect(gap).toBeLessThanOrEqual(16);

    await title.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(title).toBeFocused();
    const focus = await title.evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(focus.style).not.toBe('none');
    expect(focus.width).toBeGreaterThanOrEqual(2);

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
