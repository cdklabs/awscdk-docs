import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Global language slider (LanguageToggle.vue): reads and writes the shared
// client-side language state instead of rewriting the URL path. It renders
// as a segmented radio-group slider of per-language glyph icons and leads
// the nav row. The fixture is a five-language build
// (ts + python + dotnet + java + go), so the slider must render exactly the
// enabled languages and drive the shared state — while the retired
// path-rewriting LanguageSwitcher must be gone everywhere.
test.describe('language toggle', () => {
  test('renders the enabled languages and drives the shared state', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    await expect(slider).toBeVisible();
    // Exactly the build-enabled set, as radio segments, rendered in the
    // LANGUAGES canonical order (ts, python, java, dotnet, go) — NOT
    // docgen.config.json array order. The slider filters the enabled set out
    // of that list, so Java precedes C# even though the config array
    // lists dotnet first, and Go comes last.
    const options = slider.getByRole('radio');
    await expect(options).toHaveCount(5);
    // Each option is named by its language alone: the badges are not
    // painted from 1100px, so they are not part of the name either.
    await expect(options.nth(0)).toHaveAccessibleName('TypeScript');
    await expect(options.nth(1)).toHaveAccessibleName('Python');
    await expect(options.nth(2)).toHaveAccessibleName('Java');
    await expect(options.nth(3)).toHaveAccessibleName('C#');
    await expect(options.nth(4)).toHaveAccessibleName('Go');
    await expect(options.nth(0)).toHaveAttribute('aria-checked', 'true');
    // Selecting a language reflects into ?lang= without touching the path.
    await slider.getByRole('radio', { name: 'Python' }).click();
    await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/[?&]lang=python/);
    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sns\.Topic/);
    // Switching to Go does the same: ?lang=go, path untouched.
    await slider.getByRole('radio', { name: 'Go', exact: true }).click();
    await expect(options.nth(4)).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/[?&]lang=go/);
    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sns\.Topic/);
    // The retired switcher stays gone.
    await expect(page.locator('.language-switcher')).toHaveCount(0);
  });

  test('every option shows its language by name, with no two-letter badge', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    const options = slider.getByRole('radio');
    await expect(options).toHaveCount(5);
    // The painted text of every option, checked or not, is its full label.
    await expect(options).toHaveText(['TypeScript', 'Python', 'Java', 'C#', 'Go'], { useInnerText: true });
    // No badge is painted anywhere in the bar.
    const badges = slider.locator('.language-abbr');
    await expect(badges).toHaveCount(5);
    for (const display of await badges.evaluateAll((els) => els.map((el) => getComputedStyle(el).display))) {
      expect(display).toBe('none');
    }
    const java = slider.getByRole('radio', { name: 'Java' });
    await expect(java).toHaveAttribute('title', 'Java');
    // innerText counts clipped text, so check that every unchecked name is
    // actually painted at full width rather than visually hidden.
    const hiddenWidths = await slider
      .locator('.language-option:not(.active) .visually-hidden')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(hiddenWidths).toHaveLength(4);
    for (const width of hiddenWidths) {
      expect(width).toBeGreaterThan(10);
    }
    // Selecting it still activates Java through the shared state.
    await java.click();
    await expect(java).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/[?&]lang=java/);
  });

  test('under 1100px TypeScript reads TS and keeps its full accessible name', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1099, height: 900 });
    await page.goto(TOPIC_PAGE);
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    const checked = slider.getByRole('radio', { name: 'TypeScript' });
    await expect(checked).toHaveAttribute('aria-checked', 'true');
    await expect(checked).toHaveAccessibleName('TS TypeScript');
    const label = checked.locator('.language-label');
    await expect(label).toHaveCount(1);
    const box = await label.evaluate((el) => {
      const s = getComputedStyle(el);
      return { display: s.display, width: el.getBoundingClientRect().width };
    });
    expect(box.display).not.toBe('none');
    expect(box.width).toBeLessThanOrEqual(1);
    // The badge text "TS" is what is painted; the other options keep their
    // full names.
    await expect(checked.locator('.language-abbr')).toBeVisible();
    await expect(checked.locator('.language-abbr')).toHaveText('TS');
    const radios = slider.getByRole('radio');
    for (const [i, name] of ['Python', 'Java', 'C#', 'Go'].entries()) {
      await expect(radios.nth(i + 1)).toHaveText(name, { useInnerText: true });
    }
    // innerText counts clipped text, so check that the four unchecked names
    // are painted at real width in this band too.
    const idleWidths = await slider
      .locator('.language-option:not(.active) .visually-hidden')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(idleWidths).toHaveLength(4);
    for (const width of idleWidths) {
      expect(width).toBeGreaterThan(10);
    }
    // Unchecked, TypeScript still reads "TS" and keeps its full name.
    await slider.getByRole('radio', { name: 'Python' }).click();
    // The newly selected name is painted at real width as well.
    expect(
      await slider.getByRole('radio', { name: 'Python' }).locator('.language-label').evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(10);
    await expect(slider.getByRole('radio').nth(0)).toHaveAccessibleName('TS TypeScript');
    const ts = slider.getByRole('radio').nth(0);
    await expect(ts.locator('.language-abbr')).toBeVisible();
    await expect(ts.locator('.language-abbr')).toHaveText('TS');
    expect(await ts.locator('.visually-hidden').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  });

  for (const [theme, brand] of [
    ['light', 'rgb(0, 108, 224)'],
    ['dark', 'rgb(66, 180, 255)'],
  ] as const) {
    test(`the bar marks the selected language in the brand color (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('vitepress-theme-appearance', t), theme);
      await page.goto(TOPIC_PAGE);
      const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
      const selected = slider.getByRole('radio', { name: 'TypeScript' });
      await expect(selected).toHaveAttribute('aria-checked', 'true');
      const paint = (el: Element) => {
        const s = getComputedStyle(el);
        return {
          color: s.color,
          underline: `${s.borderBottomWidth} ${s.borderBottomStyle} ${s.borderBottomColor}`,
          fill: s.backgroundColor,
        };
      };
      // The tabs sit on the bar with no track, so the cue is the brand text
      // color plus a 3px underline in the same color; the idle tabs carry the
      // same border transparent, so selecting never changes a tab's size.
      expect(await selected.evaluate(paint)).toEqual({
        color: brand,
        underline: `3px solid ${brand}`,
        fill: 'rgba(0, 0, 0, 0)',
      });
      const idle = await slider.getByRole('radio', { name: 'Python' }).evaluate(paint);
      expect(idle.color).not.toBe(brand);
      expect(idle.underline).toBe('3px solid rgba(0, 0, 0, 0)');
      expect(idle.fill).toBe('rgba(0, 0, 0, 0)');
      // Hovering the selected tab keeps it as is; hovering an idle one fills it.
      await selected.hover();
      expect((await selected.evaluate(paint)).fill).toBe('rgba(0, 0, 0, 0)');
      const python = slider.getByRole('radio', { name: 'Python' });
      await python.hover();
      await expect.poll(() => python.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)',
      );
    });
  }

  for (const [theme, rowFill, rowText, hoverFill] of [
    ['light', 'rgb(0, 108, 224)', 'rgb(255, 255, 255)', 'rgb(233, 235, 237)'],
    ['dark', 'rgb(66, 180, 255)', 'rgb(15, 20, 26)', 'rgb(42, 51, 64)'],
  ] as const) {
    test(`the phone menu stacks the languages as one segmented control (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('vitepress-theme-appearance', t), theme);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(TOPIC_PAGE);
      await page.locator('.VPNavBarHamburger').click();
      const group = page
        .locator('.VPNavScreen')
        .getByRole('radiogroup', { name: 'Select programming language' });
      await expect(group).toBeVisible();
      const rows = group.getByRole('radio');
      // The menu always shows the full names, TypeScript included.
      await expect(rows).toHaveText(['TypeScript', 'Python', 'Java', 'C#', 'Go'], { useInnerText: true });
      const layout = await group.evaluate((el) => {
        const s = getComputedStyle(el);
        return { direction: s.flexDirection, radius: s.borderTopLeftRadius, edge: s.borderTopWidth };
      });
      expect(layout).toEqual({ direction: 'column', radius: '8px', edge: '1px' });
      const groupBox = (await group.boundingBox())!;
      let previousBottom = -Infinity;
      for (const row of await rows.all()) {
        const box = (await row.boundingBox())!;
        // One full-width row per language, stacked top to bottom, each 48px high.
        expect(Math.round(box.height)).toBeGreaterThanOrEqual(48);
        expect(box.width).toBeGreaterThanOrEqual(groupBox.width - 2);
        expect(box.y).toBeGreaterThanOrEqual(previousBottom - 1);
        previousBottom = box.y + box.height;
      }
      // The group must grow to hold every row: its overflow is hidden, so a
      // fixed track height would clip the list to its first row.
      const groupBottom = await group.evaluate((el) => el.getBoundingClientRect().bottom);
      const lastBottom = await rows.last().evaluate((el) => el.getBoundingClientRect().bottom);
      expect(lastBottom).toBeLessThanOrEqual(groupBottom + 0.5);
      // The selected row is filled; the others are not.
      const fill = (el: Element) => getComputedStyle(el).backgroundColor;
      expect(await rows.nth(0).evaluate(fill)).toBe(rowFill);
      expect(await rows.nth(0).evaluate((el) => getComputedStyle(el).color)).toBe(rowText);
      expect(await rows.nth(1).evaluate(fill)).toBe('rgba(0, 0, 0, 0)');
      // Hovering an idle row paints the hover fill.
      await rows.nth(2).hover();
      await expect.poll(() => rows.nth(2).evaluate(fill)).toBe(hoverFill);
      // The hovered row keeps the muted text the contrast suite measures on that fill.
      const idleText = await rows.nth(3).evaluate((el) => getComputedStyle(el).color);
      expect(await rows.nth(2).evaluate((el) => getComputedStyle(el).color)).toBe(idleText);
      // Arrow keys move focus and selection together, so keyboard focus sits
      // on the filled row. Its ring is drawn in the row's text color so it
      // stays visible against the fill.
      const ring = (el: Element) => {
        const s = getComputedStyle(el);
        return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`;
      };
      await rows.nth(0).focus();
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(1)).toBeFocused();
      await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true');
      expect(await rows.nth(1).evaluate(ring)).toBe(`solid 2px ${rowText} -4px`);
    });
  }

  test('the tabs span the bar and center on the search box', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    await expect(slider).toBeVisible();
    const search = page.locator('.VPNavBar .blog-search .nav-search-btn-wait');
    await expect(search).toBeVisible();
    const row = page.locator('.VPNavBar .content-body');
    const sliderBox = (await slider.boundingBox())!;
    const searchBox = (await search.boundingBox())!;
    const rowBox = (await row.boundingBox())!;
    // The tab group is as tall as the control row, so the selected underline
    // sits on the bar's bottom edge, while the search keeps its own 40px.
    expect(sliderBox.height).toBeCloseTo(rowBox.height, 0);
    expect(sliderBox.y).toBeCloseTo(rowBox.y, 0);
    expect(searchBox.height).toBeLessThan(sliderBox.height);
    // Both still share one horizontal center line.
    expect(sliderBox.y + sliderBox.height / 2).toBeCloseTo(searchBox.y + searchBox.height / 2, 0);
    // Every tab fills the group's height, so the underline reaches the edge.
    for (const box of await slider.getByRole('radio').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()),
    )) {
      expect(box.height).toBeCloseTo(sliderBox.height, 0);
      expect(box.bottom).toBeCloseTo(sliderBox.y + sliderBox.height, 0);
    }
  });

  test('canonical /v2/docs/ deep links resolve (zero link breakage)', async ({ page }) => {
    const response = await page.goto(TOPIC_PAGE);
    expect(response?.ok()).toBe(true);
    await expect(page.locator('h1')).toContainText('Topic');
  });

  test('no per-language page tree is served', async ({ page }) => {
    // The path-based /v2/modules/<lang>/ trees are retired: only the
    // canonical tree exists, so a python-prefixed path must 404.
    const res = await page.request.get(
      '/v2/modules/python/aws-cdk-lib/aws-sns/Topic.html',
    );
    expect(res.status()).toBe(404);
  });

  test('a stored language preference leaves the URL alone', async ({ page }) => {
    // Language is shared state, not a route: a preference held in
    // localStorage must not rewrite the path on load.
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      ['cdk-docs-language', 'python'] as const,
    );
    await page.goto(TOPIC_PAGE);
    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sns\.Topic/);
  });

  for (const [where, width] of [['bar', 1280], ['phone menu', 375]] as const) {
    test(`forced colors still mark the selected language in the ${where}`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await page.setViewportSize({ width, height: 812 });
      await page.goto(TOPIC_PAGE);
      let scope = page.locator('.VPNavBar');
      if (where === 'phone menu') {
        await page.locator('.VPNavBarHamburger').click();
        scope = page.locator('.VPNavScreen');
      }
      const picker = scope.getByRole('radiogroup', { name: 'Select programming language' });
      await expect(picker).toBeVisible();
      const decoration = (el: Element) => getComputedStyle(el).textDecorationLine;
      // Forced colors drops the fill and the inset underline, so the selected
      // label is underlined in the system text color; the others are not.
      expect(await picker.getByRole('radio', { name: 'TypeScript' }).evaluate(decoration)).toBe('underline');
      expect(await picker.getByRole('radio', { name: 'Python' }).evaluate(decoration)).toBe('none');
    });
  }

  test('the search trigger does not move when the language changes', async ({
    page,
  }) => {
    // Every option paints its own label, so the slider's width must not
    // depend on which one is selected. The search trigger is centered in the
    // region between the slider and the fixed-width right controls, so any
    // width change there would shift the button by half of it.
    //
    // Off-center is acceptable; MOVING is the bug. So this measures the
    // trigger's bounding-box x across a switch rather than its centeredness.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(TOPIC_PAGE);

    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    const search = page.locator('.VPNavBar .content-body > .search .nav-search-btn-wait');
    await expect(search).toBeVisible();

    // TypeScript is the default: the longest label in the enabled set.
    await expect(slider.getByRole('radio', { name: 'TypeScript' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const before = await search.boundingBox();

    // Go is the shortest label in the enabled set, so switching to it from
    // TypeScript is the widest swing the row can produce.
    await slider.getByRole('radio', { name: 'Go', exact: true }).click();
    await expect(slider.getByRole('radio', { name: 'Go', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const after = await search.boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
  });
});
