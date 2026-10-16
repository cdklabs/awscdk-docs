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
    // of that list, so Java precedes C# / .NET even though the config array
    // lists dotnet first, and Golang comes last.
    const options = slider.getByRole('radio');
    await expect(options).toHaveCount(5);
    // The visible abbreviation leads the accessible name rather than being
    // replaced by it, so the name reads "<abbreviation> <language>".
    await expect(options.nth(0)).toHaveAccessibleName('TS TypeScript');
    await expect(options.nth(1)).toHaveAccessibleName('Py Python');
    await expect(options.nth(2)).toHaveAccessibleName('Ja Java');
    await expect(options.nth(3)).toHaveAccessibleName('C# C# / .NET');
    await expect(options.nth(4)).toHaveAccessibleName('Go Golang');
    await expect(options.nth(0)).toHaveAttribute('aria-checked', 'true');
    // Selecting a language reflects into ?lang= without touching the path.
    await slider.getByRole('radio', { name: 'Python' }).click();
    await expect(options.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/[?&]lang=python/);
    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sns\.Topic/);
    // Switching to Go does the same: ?lang=go, path untouched.
    await slider.getByRole('radio', { name: 'Golang' }).click();
    await expect(options.nth(4)).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/[?&]lang=go/);
    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sns\.Topic/);
    // The retired switcher stays gone.
    await expect(page.locator('.language-switcher')).toHaveCount(0);
  });

  test('every segment shows its abbreviation and keeps its full accessible name', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    const java = slider.getByRole('radio', { name: 'Java' });
    const badge = java.locator('.language-abbr');
    await expect(badge).toHaveText('Ja');
    await expect(badge.locator('*')).toHaveCount(0);
    await expect(java).toHaveAttribute('title', 'Java');
    const paint = await badge.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        mask: s.maskImage !== 'none' ? s.maskImage : s.webkitMaskImage,
        background: s.backgroundImage,
        before: getComputedStyle(el, '::before').content,
      };
    });
    expect(paint.mask).toBe('none');
    expect(paint.background).toBe('none');
    expect(paint.before).toMatch(/^(none|normal|"")$/);
    const abbrs = await slider.locator('.language-abbr').allInnerTexts();
    expect(abbrs.length).toBe(await slider.getByRole('radio').count());
    expect(abbrs.every((a) => a.trim().length > 0)).toBe(true);
    expect(new Set(abbrs).size).toBe(abbrs.length);
    // Selecting it still activates Java through the shared state.
    await java.click();
    await expect(java).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/[?&]lang=java/);
  });

  test('the checked segment keeps its full accessible name where the label is unpainted', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
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
  });

  test('renders at the same height as the search box', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    await expect(slider).toBeVisible();
    const search = page.locator('.VPNavBar .blog-search .nav-search-btn-wait');
    await expect(search).toBeVisible();
    const sliderBox = await slider.boundingBox();
    const searchBox = await search.boundingBox();
    expect(sliderBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    // Same rendered height, sitting on a common horizontal center line.
    expect(sliderBox!.height).toBeCloseTo(searchBox!.height, 0);
    expect(sliderBox!.y + sliderBox!.height / 2).toBeCloseTo(
      searchBox!.y + searchBox!.height / 2,
      0,
    );
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

  test('the search trigger does not move when the language changes', async ({
    page,
  }) => {
    // A slider that renders the full label only for the ACTIVE segment tracks
    // whichever label is selected. The search trigger is centered in the region
    // between the slider and the fixed-width right controls, so a large
    // label-width delta ("TypeScript" vs "Java") shifts the button by half of
    // it. Only visible at >=1280px, where the label is shown at all.
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

    // Java is the shortest label in the enabled set, so switching to it from
    // TypeScript is the widest swing the row can produce.
    await slider.getByRole('radio', { name: 'Java' }).click();
    await expect(slider.getByRole('radio', { name: 'Java' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const after = await search.boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
  });
});
