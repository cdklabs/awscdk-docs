import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAILING_IMPACTS, REPRESENTATIVE_PAGES } from './fixture.js';

// Automated accessibility gate.
//
// Audits the REAL rendered page in Chromium, not generated markup: the navbar
// filter, language toggle, lazy API sidebar and type tooltips mount
// client-side, so their DOM only exists after hydration. The threshold and page
// list live in ./fixture so the unit suite can pin them without Playwright.

type Impact = (typeof FAILING_IMPACTS)[number];

function isFailing(impact: string | null | undefined): impact is Impact {
  return !!impact && (FAILING_IMPACTS as readonly string[]).includes(impact);
}

// Token colors inside code blocks come from the vendored Shiki theme, not from
// this repo, so color-contrast is exempt there and nowhere else. The check asks
// the PAGE whether the node sits inside `pre code`, node by node, because the
// selector text axe reports depends on what Shiki emits.
async function isCodeToken(page: Page, target: readonly unknown[]): Promise<boolean> {
  const selector = String(target[target.length - 1] ?? '');
  if (!selector) return false;
  return page.evaluate((sel) => !!document.querySelector(sel)?.closest('pre code'), selector);
}

// The `@a11y` tag is what separates this gate from the browser e2e suite:
// both live in test/e2e/ and share the fixture build, but they are distinct
// gates and a failure has to be attributable to one of them. The e2e task
// runs everything EXCEPT this tag; the audit task runs only this tag.
test.describe('accessibility audit (axe-core) @a11y', () => {
  // A full axe pass over an API reference page takes minutes, not seconds:
  // measured 1.6 min on the API overview and 1.1-1.2 min on the class and
  // module pages, against 1.0 s for the home page. The size difference is
  // the point — these pages carry thousands of nodes — so the suite's
  // 30 s default is not a margin to tune, it is an order of magnitude short.
  test.describe.configure({ timeout: 300_000 });

  for (const pagePath of REPRESENTATIVE_PAGES) {
    test(`no critical or serious violations on ${pagePath}`, async ({ page }) => {
      await page.goto(pagePath);

      // Audit the hydrated page, not the server-rendered shell. The navbar
      // controls are the last thing to mount on every page; on an API page
      // the lazy sidebar also has to finish its fetch, or axe inspects the
      // loading state instead of the tree the reader actually gets.
      await expect(page.locator('.VPNav')).toBeVisible();
      const apiSidebar = page.locator('.api-sidebar');
      if (await apiSidebar.count()) {
        await expect(apiSidebar.locator('.api-sidebar-nav')).toBeVisible();
      }

      // `label-content-name-mismatch` (WCAG 2.5.3) ships disabled in axe's
      // default set as experimental; Lighthouse runs it and it caught real
      // defects here, so it is switched on alongside the defaults.
      const results = await new AxeBuilder({ page })
        .options({ rules: { 'label-content-name-mismatch': { enabled: true } } })
        .analyze();

      const advisory = results.violations.filter((v) => !isFailing(v.impact));

      // Drop only the exempt NODES, not the whole violation: a failure that
      // hits both a code token and something else must still fail on the
      // something else.
      const failing: typeof results.violations = [];
      for (const violation of results.violations.filter((v) => isFailing(v.impact))) {
        const nodes = [];
        for (const node of violation.nodes) {
          if (violation.id === 'color-contrast' && (await isCodeToken(page, node.target))) continue;
          nodes.push(node);
        }
        if (nodes.length) failing.push({ ...violation, nodes });
      }

      if (advisory.length) {
        console.log(
          `${pagePath}: ${advisory.length} non-gating violation(s): ` +
            advisory.map((v) => `${v.id} (${v.impact})`).join(', '),
        );
      }

      // Name the rule, its impact and one offending selector per violation:
      // a bare count tells whoever sees this in CI nothing about what broke.
      const detail = failing
        .map((v) => {
          const where = v.nodes[0]?.target?.join(' ') ?? 'unknown target';
          return `${v.id} (${v.impact}) — ${v.help} — first at: ${where}`;
        })
        .join('\n');

      expect(detail, `axe-core found gating violations on ${pagePath}:\n${detail}`).toBe('');
    });
  }
});
