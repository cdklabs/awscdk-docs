import { expect, test } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// Layout density foundation (ADR 2026-10-23-layout-density): a stored density
// choice drives a `data-density` attribute on <html>. `balanced` (today's
// values) is the ABSENCE of the attribute; `compact`/`spacious` set it. A
// pre-hydration bootstrap script in config.mts applies a stored non-default
// choice before first paint, so a reload never flashes the wrong spacing.
test.describe('layout density attribute', () => {
  test('a stored compact choice sets data-density before first paint', async ({ page }) => {
    // Seed the stored choice before any document loads, so the bootstrap
    // script in <head> runs against it on the very first navigation — the
    // pre-paint path, not a post-hydration client write.
    await page.addInitScript(() => {
      window.localStorage.setItem('cdk-docs-density', 'compact');
    });
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  });

  test('the default (balanced) carries no attribute', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('html')).not.toHaveAttribute('data-density');
  });

  test('an unknown stored value leaves no attribute (falls back to balanced)', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('cdk-docs-density', 'cozy');
    });
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('html')).not.toHaveAttribute('data-density');
  });

  test('built output: the pre-hydration bootstrap script ships in <head>', async ({ page }) => {
    // The density bootstrap must be inline in the document the server sends,
    // ahead of hydration — not injected by client JS — or it cannot apply
    // before first paint. Read the raw served HTML, not the live DOM. The
    // build MINIFIES the inline script (renames the local var, drops spaces,
    // may rewrite the `if` as `&&`), so assert on the stable literals only:
    // the storage key, the two applied values, and the attribute written.
    const response = await page.goto(QUEUE_PAGE);
    const html = await response!.text();
    expect(html).toContain('localStorage.getItem("cdk-docs-density")');
    expect(html).toContain('"compact"');
    expect(html).toContain('"spacious"');
    expect(html).toMatch(/setAttribute\("data-density",\s*\w+\)/);
  });

  test('built output: the --density-* tokens resolve on :root in the built CSS', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    // The token layer survives the build: the Balanced values are readable from
    // the document root. Asserting a representative token from each tokenized
    // area. Balanced raises member-row padding and the table margin above the
    // foundation's original values.
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        memberRowPadY: s.getPropertyValue('--density-member-row-pad-y').trim(),
        outlineFont: s.getPropertyValue('--density-outline-font').trim(),
        sidebarIndent: s.getPropertyValue('--density-sidebar-indent').trim(),
        tableMargin: s.getPropertyValue('--density-table-margin').trim(),
        sectionHeaderFont: s.getPropertyValue('--density-section-header-font').trim(),
        memberNameFont: s.getPropertyValue('--density-member-name-font').trim(),
        memberProseFont: s.getPropertyValue('--density-member-prose-font').trim(),
      };
    });
    expect(tokens.memberRowPadY).toBe('13px');
    expect(tokens.outlineFont).toBe('14px');
    expect(tokens.sidebarIndent).toBe('12px');
    expect(tokens.tableMargin).toBe('18px');
    // The built CSS is minified, which drops a leading zero.
    expect(tokens.memberNameFont).toBe('.9375rem');
    expect(tokens.memberProseFont).toBe('.875rem');
    expect(tokens.sectionHeaderFont).toBe('1.4rem');
  });

  test('a Properties/Methods section header has more space above than below', async ({ page }) => {
    // Sections read as separate blocks because the heading carries more margin
    // above than below. Measured on the rendered Queue page's `## Methods`
    // heading rather than on the token, so it survives the build.
    await page.goto(QUEUE_PAGE);
    const heading = page.locator('h2#methods');
    await expect(heading).toBeVisible();
    const margins = await heading.evaluate((el) => {
      const s = getComputedStyle(el);
      return { top: parseFloat(s.marginTop), bottom: parseFloat(s.marginBottom) };
    });
    expect(margins.top).toBeGreaterThan(margins.bottom);
  });
});
