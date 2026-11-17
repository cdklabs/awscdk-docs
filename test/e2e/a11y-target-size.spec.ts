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
