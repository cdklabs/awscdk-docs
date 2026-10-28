import { expect, test, type Locator, type Page } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// The Layout density picker (ADR 2026-10-23-layout-density): a third tri-state
// group in the Settings menu, after Site theme and Code theme. Spacious /
// Balanced / Compact (loosest to tightest) set the `--density-*` presets in
// density.css.
//
// The e2e fixture site keeps aws_sqs and aws_sns, not aws_s3, so the built
// Queue page stands in for Bucket: it has the same member rows and outline.

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const panel = page.locator('#settings-menu-panel');
  await expect(panel).toBeVisible();
  return panel.getByRole('group', { name: 'Layout' });
}

/** Rendered heights of the first member row, outline entry and sidebar item. */
async function heights(page: Page): Promise<{ row: number; outline: number; sidebar: number }> {
  return page.evaluate(() => {
    const h = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el.getBoundingClientRect().height;
    };
    return {
      row: h('.member-list .member-row'),
      outline: h('.VPDocAsideOutline a.outline-link'),
      sidebar: h('.api-sidebar-link'),
    };
  });
}

test.describe('layout density picker', () => {
  test('sits after Site theme and Code theme, labeled Layout, in Spacious / Balanced / Compact order', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const layout = await openSettings(page);
    await expect(layout).toBeVisible();
    await expect(page.locator('#settings-menu-panel .theme-picker-group-label')).toHaveText([
      'Site theme',
      'Code theme',
      'Layout',
    ]);
    const names = await layout.getByRole('button').evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label')),
    );
    expect(names).toEqual(['Spacious layout', 'Balanced layout', 'Compact layout']);
    // Out of the box the layout is Balanced, with no attribute.
    await expect(layout.getByRole('button', { name: 'Balanced layout' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).not.toHaveAttribute('data-density');
    // Each segment is at least a 24px target (WCAG 2.5.8).
    for (const box of await layout.getByRole('button').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()),
    )) {
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
  });

  test('a choice applies at once, is stored, and survives a reload', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const layout = await openSettings(page);
    await layout.getByRole('button', { name: 'Spacious layout' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'spacious');
    expect(await page.evaluate(() => localStorage.getItem('cdk-docs-density'))).toBe('spacious');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'spacious');
    const again = await openSettings(page);
    await expect(again.getByRole('button', { name: 'Spacious layout' })).toHaveAttribute('aria-pressed', 'true');

    await again.getByRole('button', { name: 'Balanced layout' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-density');
  });

  test('Compact is never looser than Balanced, and Spacious is looser', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(QUEUE_PAGE);
    const layout = await openSettings(page);
    const balanced = await heights(page);

    await layout.getByRole('button', { name: 'Compact layout' }).click();
    const compact = await heights(page);

    await layout.getByRole('button', { name: 'Spacious layout' }).click();
    const spacious = await heights(page);

    // Sidebar: Compact is tighter, Spacious looser.
    expect(compact.sidebar).toBeLessThan(balanced.sidebar);
    expect(spacious.sidebar).toBeGreaterThan(balanced.sidebar);
    // Sidebar items keep a 24px target at every level.
    for (const level of [compact, balanced, spacious]) expect(level.sidebar).toBeGreaterThanOrEqual(24);
    // Member rows: Spacious is taller. Compact keeps today's rows, which are
    // Balanced's until Balanced is loosened in its own step.
    expect(spacious.row).toBeGreaterThan(balanced.row);
    expect(compact.row).toBeLessThanOrEqual(balanced.row);
    // Outline: Compact <= Balanced <= Spacious (Compact's 24px floor can meet
    // a tight Balanced).
    expect(compact.outline).toBeLessThanOrEqual(balanced.outline);
    expect(balanced.outline).toBeLessThanOrEqual(spacious.outline);
  });

  test('the sidebar link reads the settled font, line height and padding per level', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(QUEUE_PAGE);
    const layout = await openSettings(page);
    const read = () =>
      page.evaluate(() => {
        const el = document.querySelector('.api-sidebar a.api-sidebar-link')!;
        const s = getComputedStyle(el);
        // Group headings carry the caret, whose box follows the same line
        // token, so a group row is never taller than a link row.
        const group = document.querySelector('.api-sidebar button.api-sidebar-group')!.getBoundingClientRect().height;
        const link = el.getBoundingClientRect().height;
        return { font: s.fontSize, line: s.lineHeight, padding: s.paddingTop, groupNoTaller: group <= link + 0.5 };
      });
    // Balanced: 14px x 1.4 with 3px padding, 25.6px items.
    expect(await read()).toEqual({ font: '14px', line: '19.6px', padding: '3px', groupNoTaller: true });
    await layout.getByRole('button', { name: 'Compact layout' }).click();
    // Compact: one font step down, same line and padding, 24.2px items.
    expect(await read()).toEqual({ font: '13px', line: '18.2px', padding: '3px', groupNoTaller: true });
    await layout.getByRole('button', { name: 'Spacious layout' }).click();
    // Spacious: the roomy pre-density line and padding, 38.4px items.
    expect(await read()).toEqual({ font: '14px', line: '22.4px', padding: '8px', groupNoTaller: true });
  });

  test('body prose, code blocks and the navbar do not change with the level', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const layout = await openSettings(page);
    const read = () =>
      page.evaluate(() => {
        const font = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).fontSize : null;
        };
        return {
          prose: font('.vp-doc p'),
          code: font('.vp-doc pre code'),
          navbar: document.querySelector('.VPNavBar')!.getBoundingClientRect().height,
        };
      });
    const before = await read();
    await layout.getByRole('button', { name: 'Compact layout' }).click();
    expect(await read()).toEqual(before);
    await layout.getByRole('button', { name: 'Spacious layout' }).click();
    expect(await read()).toEqual(before);
  });

  test('keyboard: Tab reaches the group and Enter selects a level', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const layout = await openSettings(page);
    // Tab order follows the visual order: Spacious, then Balanced, then Compact.
    const spacious = layout.getByRole('button', { name: 'Spacious layout' });
    await spacious.focus();
    await expect(spacious).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-density', 'spacious');
    await page.keyboard.press('Tab');
    await expect(layout.getByRole('button', { name: 'Balanced layout' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.locator('html')).not.toHaveAttribute('data-density');
  });

  test('the mobile nav screen picker includes the Layout group', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(QUEUE_PAGE);
    await page.locator('.VPNavBarHamburger').click();
    const layout = page.locator('.VPNavScreen .ThemePicker').getByRole('group', { name: 'Layout' });
    await expect(layout).toBeVisible();
    await layout.getByRole('button', { name: 'Compact layout' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  });
});
