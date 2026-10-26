import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// The accessibility checks that density can move, at the two non-default
// levels: target size (WCAG 2.5.8, disabled in axe by default, so enabled by
// name) and contrast. The full audit (a11y-audit.spec.ts) covers Balanced.
// One class page is enough: every tokenized area (rows, headers, outline,
// sidebar, tables) renders on it.
test.describe('layout density levels stay accessible @a11y', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const level of ['compact', 'spacious'] as const) {
    test(`${level}: 24px targets and contrast on ${QUEUE_PAGE}`, async ({ page }) => {
      await page.addInitScript((value) => {
        window.localStorage.setItem('cdk-docs-density', value);
      }, level);
      await page.goto(QUEUE_PAGE);
      await expect(page.locator('html')).toHaveAttribute('data-density', level);
      await expect(page.locator('.VPNav')).toBeVisible();
      await expect(page.locator('.api-sidebar .api-sidebar-nav')).toBeVisible();

      const results = await new AxeBuilder({ page })
        .options({ rules: { 'target-size': { enabled: true } } })
        .withRules(['target-size', 'color-contrast'])
        .analyze();

      // Code-block token colors come from the vendored Shiki theme, so
      // contrast is exempt inside `pre code` here as in the main audit.
      const nodes = [];
      for (const violation of results.violations) {
        for (const node of violation.nodes) {
          const selector = String(node.target[node.target.length - 1] ?? '');
          const inCode = violation.id === 'color-contrast'
            && await page.evaluate((sel) => !!document.querySelector(sel)?.closest('pre code'), selector);
          if (!inCode) nodes.push(`${violation.id}: ${node.target.join(' ')} — ${node.failureSummary ?? ''}`);
        }
      }
      expect(nodes.join('\n'), `violations at ${level}:\n${nodes.join('\n')}`).toBe('');
    });
  }
});
