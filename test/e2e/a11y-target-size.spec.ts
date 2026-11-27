import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { REPRESENTATIVE_PAGES, TOPIC_PAGE } from './fixture.js';

// Gates WCAG 2.5.8 target size (minimum) across the audited page set.
//
// `target-size` ships DISABLED in axe-core, so it is enabled by name here. The
// main audit runs the default rule set and would never evaluate it.
//
// It carries the `@a11y` tag, so it runs in the accessibility gate and is
// excluded from the browser e2e suite, exactly as the audit is.
test.describe('target size (WCAG 2.5.8) @a11y', () => {
  // Same budget as the audit: an API reference page carries thousands of
  // nodes, and the suite's default timeout is an order of magnitude short.
  test.describe.configure({ timeout: 300_000 });

  for (const pagePath of REPRESENTATIVE_PAGES) {
    test(`every target meets the 24px floor on ${pagePath}`, async ({ page }) => {
      await page.goto(pagePath);

      // Audit the hydrated page: the sidebar controls this rule covers mount
      // client-side, so a server-rendered shell has none of them.
      await expect(page.locator('.VPNav')).toBeVisible();
      const apiSidebar = page.locator('.api-sidebar');
      if (await apiSidebar.count()) {
        await expect(apiSidebar.locator('.api-sidebar-nav')).toBeVisible();
      }

      const results = await new AxeBuilder({ page })
        .options({ rules: { 'target-size': { enabled: true } } })
        .withRules(['target-size'])
        .analyze();

      // Name the offending selector and the size axe measured: a bare count
      // does not say which control shrank.
      const detail = results.violations
        .flatMap((violation) => violation.nodes)
        .map((node) => `${node.target.join(' ')} — ${node.failureSummary ?? ''}`)
        .join('\n');

      expect(detail, `target-size violations on ${pagePath}:\n${detail}`).toBe('');
    });
  }

  // The "View as Markdown" row exists only while the menu is open (it is `display: none` otherwise), so the scan
  // above never measures it. Open the menu first, then scan, on desktop and at a phone width where 44px applies.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 800 }]) {
    test(`the open Copy Markdown menu meets the 24px floor at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(TOPIC_PAGE);
      await expect(page.locator('.VPNav')).toBeVisible();
      await page.locator('.copy-markdown[data-ready]').waitFor();
      await page.getByRole('button', { name: 'More Markdown options' }).click();
      await expect(page.getByRole('menuitem', { name: 'View as Markdown' })).toBeVisible();

      const results = await new AxeBuilder({ page })
        .options({ rules: { 'target-size': { enabled: true } } })
        .withRules(['target-size'])
        .analyze();
      const detail = results.violations
        .flatMap((violation) => violation.nodes)
        .map((node) => `${node.target.join(' ')} — ${node.failureSummary ?? ''}`)
        .join('\n');

      expect(detail, `target-size violations with the menu open:\n${detail}`).toBe('');
    });
  }

  // The mobile hamburger menu exists only while it is open below 768px, so the page scans above never measure its
  // language, theme and navigation rows. Open it at a phone width, then scan only the menu.
  test('the open mobile menu meets the 24px floor at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.VPNav')).toBeVisible();
    await page.locator('.VPNavBarHamburger').click();
    await expect(page.locator('.VPNavScreen .NavStylePicker')).toBeVisible();
    // The menu fades in; scan it once the transition has finished, not at partial opacity.
    await expect.poll(() => page.locator('.VPNavScreen').evaluate((el) => el.getAnimations({ subtree: true }).length === 0 && getComputedStyle(el).opacity === '1')).toBe(true);

    const results = await new AxeBuilder({ page })
      .include('.VPNavScreen')
      .options({ rules: { 'target-size': { enabled: true } } })
      .withRules(['target-size'])
      .analyze();
    const detail = results.violations
      .flatMap((violation) => violation.nodes)
      .map((node) => `${node.target.join(' ')} — ${node.failureSummary ?? ''}`)
      .join('\n');

    expect(detail, `target-size violations with the mobile menu open:\n${detail}`).toBe('');
  });

  // Across 768-1279px the bar's language options keep only 4px side padding, and below 1100px TypeScript paints
  // just "TS", so the narrowest option there is two letters wide. The page scans above run at the default width,
  // where neither applies. Scan the bar's picker in both states.
  for (const width of [1000, 1100]) {
    test(`the bar's language options meet the 24px floor at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(TOPIC_PAGE);
      const picker = page.locator('.VPNavBar .language-toggle');
      await expect(picker).toBeVisible();

      const results = await new AxeBuilder({ page })
        .include('.VPNavBar .language-toggle')
        .options({ rules: { 'target-size': { enabled: true } } })
        .withRules(['target-size'])
        .analyze();
      const detail = results.violations
        .flatMap((violation) => violation.nodes)
        .map((node) => `${node.target.join(' ')} — ${node.failureSummary ?? ''}`)
        .join('\n');

      expect(detail, `target-size violations in the bar's language picker at ${width}px:\n${detail}`).toBe('');
      // axe passes a target it could not measure, so check the narrowest option directly too.
      const widths = await picker.getByRole('radio').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
      expect(widths).toHaveLength(5);
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(24);
    });
  }

  // The sidebar filter's hint button exists only while a query is active and the symbol index has loaded, so the
  // scans above (empty filter) never evaluate it.
  test('the filter hint button meets target size and contrast while a query is active', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.VPNav')).toBeVisible();
    await expect(page.locator('.api-sidebar .api-sidebar-nav')).toBeVisible();

    const headerHeight = () =>
      page.evaluate(() => document.querySelector('.VPSidebar .sidebar-header')!.getBoundingClientRect().height);
    const emptyHeight = await headerHeight();

    await page.getByRole('textbox', { name: 'Filter navigation in the sidebar' }).fill('Queue');
    await expect(page.locator('.nav-filter-hint').getByRole('button')).toBeVisible();

    // The status row is reserved at 24px, so showing the hint must not grow the pinned header (a taller header
    // would cover the tree targets under it).
    expect(await headerHeight()).toBe(emptyHeight);

    // Scoped to the hint. With a query active the tree pins group headings under the header, and a tree link scrolled
    // under them is reported as obscured. The height check above shows the hint does not cause that.
    // The hint's label sits on a muted token, so contrast is checked in both themes.
    const scan = async () => {
      const results = await new AxeBuilder({ page })
        .include('.nav-filter-hint')
        .options({ rules: { 'target-size': { enabled: true } } })
        .withRules(['target-size', 'color-contrast'])
        .analyze();
      return results.violations
        .flatMap((violation) => violation.nodes)
        .map((node) => `${node.target.join(' ')} — ${node.failureSummary ?? ''}`)
        .join('\n');
    };

    const lightDetail = await scan();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const darkDetail = await scan();
    const detail = [lightDetail && `light:\n${lightDetail}`, darkDetail && `dark:\n${darkDetail}`]
      .filter(Boolean)
      .join('\n');

    expect(detail, `axe violations on the filter hint:\n${detail}`).toBe('');
  });
});
