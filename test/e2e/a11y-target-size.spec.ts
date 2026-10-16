import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { REPRESENTATIVE_PAGES } from './fixture.js';

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
});
