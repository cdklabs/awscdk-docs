import { expect, test, type Locator, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Independent code-block theme: a second
// tri-state control (Light / Default / Dark) in the ThemePicker, behind
// the navbar's gear-icon Settings dropdown, decouples the code-block
// colors from the site theme. "Default" (the
// out-of-the-box state) follows the Site theme — including "Device" —
// because it removes the data attribute and lets VitePress's stock
// `.dark`-keyed rules drive the already-embedded Shiki dual-theme vars.

/** The first highlighted token span that carries both Shiki palettes. */
function tokenSpan(page: Page): Locator {
  return page.locator('.vp-doc pre.vp-code span[style*="--shiki-light"]').first();
}

/** Read the span's own dual-theme palette (from its inline style vars). */
async function tokenPalette(span: Locator): Promise<{ light: string; dark: string }> {
  return span.evaluate((el) => {
    const hexToRgb = (hex: string) => {
      const raw = hex.replace('#', '');
      const h = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
      const channel = (i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
    };
    const s = getComputedStyle(el);
    return {
      light: hexToRgb(s.getPropertyValue('--shiki-light').trim()),
      dark: hexToRgb(s.getPropertyValue('--shiki-dark').trim()),
    };
  });
}

// Both groups live in the Settings dropdown's panel, so a
// test must open the disclosure before the controls are reachable. The
// panel stays open across clicks — only Escape, an outside click or the
// trigger itself closes it — so one call per test is enough.
async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#settings-menu-panel')).toBeVisible();
}

function siteGroup(page: Page): Locator {
  return page
    .locator('.SettingsMenu .ThemePicker')
    .getByRole('group', { name: 'Site theme' });
}

function codeGroup(page: Page): Locator {
  return page
    .locator('.SettingsMenu .ThemePicker')
    .getByRole('group', { name: 'Code theme' });
}

test.describe('independent code-block theme', () => {
  test('the Code theme control cycles Light -> Dark -> Default', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await openSettings(page);
    const code = codeGroup(page);
    await expect(code).toBeVisible();
    const light = code.getByRole('button', { name: 'Light code blocks' });
    const def = code.getByRole('button', { name: 'Code blocks follow the site theme' });
    const dark = code.getByRole('button', { name: 'Dark code blocks' });

    // Out of the box the code theme is Default (follows the site theme).
    await expect(def).toHaveAttribute('aria-pressed', 'true');

    await light.click();
    await expect(light).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-code-theme', 'light');

    await dark.click();
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-code-theme', 'dark');

    // Default removes the attribute entirely — back to following the site.
    await def.click();
    await expect(def).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).not.toHaveAttribute('data-code-theme');
  });

  test('Default follows the Site theme, including Device', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await openSettings(page);
    const span = tokenSpan(page);
    const palette = await tokenPalette(span);
    expect(palette.light).not.toBe(palette.dark);

    // Explicit site light -> light tokens; site dark -> dark tokens.
    await siteGroup(page).getByRole('button', { name: 'Light site theme' }).click();
    await expect(span).toHaveCSS('color', palette.light);
    await siteGroup(page).getByRole('button', { name: 'Dark site theme' }).click();
    await expect(span).toHaveCSS('color', palette.dark);

    // Device: the code blocks track the OS preference transitively.
    await page.emulateMedia({ colorScheme: 'light' });
    await siteGroup(page).getByRole('button', { name: 'Follow the device theme' }).click();
    await expect(span).toHaveCSS('color', palette.light);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(span).toHaveCSS('color', palette.dark);
  });

  test('decoupling: dark site with light code blocks (and vice-versa)', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await openSettings(page);
    const span = tokenSpan(page);
    const palette = await tokenPalette(span);
    const block = page.locator(".vp-doc div[class*='language-']").first();

    // Site dark + code LIGHT: light tokens on the light surface while the
    // page stays dark.
    await siteGroup(page).getByRole('button', { name: 'Dark site theme' }).click();
    await codeGroup(page).getByRole('button', { name: 'Light code blocks' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(span).toHaveCSS('color', palette.light);
    // Light surface stack (--vp-c-bg-alt #f5f4f1 from custom.css).
    await expect(block).toHaveCSS('background-color', 'rgb(245, 244, 241)');

    // Site light + code DARK: the mirror image.
    await siteGroup(page).getByRole('button', { name: 'Light site theme' }).click();
    await codeGroup(page).getByRole('button', { name: 'Dark code blocks' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(span).toHaveCSS('color', palette.dark);
    // Dark surface stack (--vp-c-bg-alt #10161f from custom.css).
    await expect(block).toHaveCSS('background-color', 'rgb(16, 22, 31)');
  });

  test('a decoupled choice persists across reloads with no wrong-theme flash window', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await openSettings(page);
    await siteGroup(page).getByRole('button', { name: 'Dark site theme' }).click();
    await codeGroup(page).getByRole('button', { name: 'Light code blocks' }).click();

    await page.reload();
    // The panel closes on reload; reopen before asserting on the control.
    await openSettings(page);
    // The pre-hydration bootstrap script (config.mts head) re-applies the
    // stored decoupled choice before the theme even hydrates.
    await expect(page.locator('html')).toHaveAttribute('data-code-theme', 'light');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(
      codeGroup(page).getByRole('button', { name: 'Light code blocks' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const span = tokenSpan(page);
    const palette = await tokenPalette(span);
    await expect(span).toHaveCSS('color', palette.light);

    // Re-choosing Default persists too and re-couples after reload.
    await codeGroup(page).getByRole('button', { name: 'Code blocks follow the site theme' }).click();
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-code-theme');
    await openSettings(page);
    await expect(
      codeGroup(page).getByRole('button', { name: 'Code blocks follow the site theme' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('the settings trigger sits level with the search trigger (alignment fix)', async ({ page }) => {
    // The gear trigger is the picker's control on the nav row, so it is the
    // one that has to sit level with the search trigger; the picker's own
    // groups live in a popover and are off the row entirely.
    await page.goto(TOPIC_PAGE);
    const search = page.locator('.VPNavBar .content-body > .search .nav-search-btn-wait');
    const searchBox = await search.boundingBox();
    const trigger = page.getByRole('button', { name: 'Settings' });
    const box = await trigger.boundingBox();
    expect(box!.height).toBeCloseTo(searchBox!.height, 0);
    expect(
      Math.abs(box!.y + box!.height / 2 - (searchBox!.y + searchBox!.height / 2)),
    ).toBeLessThan(2);
  });

  test('both groups are labeled in visible text inside the panel', async ({ page }) => {
    // The panel has the room the nav row did not, so each group carries a
    // caption rather than relying on the decorative brackets glyph that
    // told the two icon rows apart side by side.
    await page.goto(TOPIC_PAGE);
    await openSettings(page);
    const panel = page.locator('#settings-menu-panel');
    await expect(panel.getByText('Site theme', { exact: true })).toBeVisible();
    await expect(panel.getByText('Code theme', { exact: true })).toBeVisible();
    await expect(panel.locator('.theme-picker-group-glyph')).toBeHidden();
  });

  test('a stored non-default choice is the one shown active on first load', async ({ page }) => {
    // A hydration mismatch the DOM hides. Both groups read their stored value
    // synchronously in setup(), so the client's first render already
    // matches what Vue produced on the server for `class` — and Vue's
    // hydration does not force-patch a plain `class` attribute. The
    // server always renders the middle option active, so without this the
    // picker shows "Device"/"Default" as selected until the reader clicks
    // something, even though `aria-pressed` was already correct.
    //
    // This has to be a browser test: the template markup is right, so
    // nothing readable from source can catch it.
    await page.goto(TOPIC_PAGE);
    await page.evaluate(() => {
      window.localStorage.setItem('vitepress-theme-appearance', 'dark');
      window.localStorage.setItem('cdk-docs-code-theme', 'light');
    });
    await page.reload();
    await openSettings(page);

    // Exactly one active segment per group, and it is the stored one --
    // asserted without clicking anything first, since a click would repaint
    // the display and hide the mismatch.
    const site = siteGroup(page);
    await expect(site.locator('.theme-picker-option.active')).toHaveCount(1);
    await expect(site.getByRole('button', { name: 'Dark site theme' })).toHaveClass(/active/);

    const code = codeGroup(page);
    await expect(code.locator('.theme-picker-option.active')).toHaveCount(1);
    await expect(code.getByRole('button', { name: 'Light code blocks' })).toHaveClass(/active/);

    // The visual state and the programmatic state must agree.
    await expect(site.getByRole('button', { name: 'Dark site theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(code.getByRole('button', { name: 'Light code blocks' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
