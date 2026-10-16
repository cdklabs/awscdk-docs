import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Type-signature hover tooltips (type-tooltips.ts): hovering a
// cross-reference link into the generated API docs fetches
// type-summaries.json and shows an aria-correct tooltip. The summary lookup
// is complete in the fixture, so links may point at types outside the
// fixture's built pages — the tooltip only needs the lookup entry.
test.describe('type hover tooltips', () => {
  test('hovering an API type link shows an aria-correct tooltip', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    // A cross-reference link to a documented type (the Topic construct's
    // metric methods link to aws-cloudwatch MetricOptions). Links at the
    // top of the page (breadcrumb/module links) may have no summary entry,
    // so pick a known type link rather than the first anchor.
    const link = page
      .locator('.VPDoc a[href$="/aws-cdk-lib.aws_cloudwatch.MetricOptions.html"]')
      .first();
    await expect(link).toBeAttached();

    // Scroll the link into view FIRST and let the scroll settle. hover()
    // otherwise scrolls + moves the mouse in one action, and Chromium
    // delivers the async `scroll` event ~1ms AFTER `mouseover` — the
    // theme's scroll listener (which hides tooltips) then cancels the
    // pending hover before the summary fetch resolves. Real users scroll,
    // stop, and then hover, so this is an automation-only race.
    await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await link.hover();

    const tooltip = page.locator('#api-type-tooltip');
    // The tooltip renders only after the first hover lazily fetches and
    // parses the full type-summaries map, so allow more than the default.
    await expect(tooltip).toHaveAttribute('role', 'tooltip', { timeout: 15_000 });
    await expect(tooltip).toHaveAttribute('aria-hidden', 'false');
    await expect(tooltip.locator('.type-tooltip-name')).not.toBeEmpty();
    await expect(link).toHaveAttribute('aria-describedby', 'api-type-tooltip');

    // Moving off the link hides the tooltip again.
    await page.locator('h1').first().hover();
    await expect(tooltip).toHaveAttribute('aria-hidden', 'true');
  });

  test('same-page anchors and the outline never get a preview', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    // Prove the tooltip machinery is live first (and warm the summaries
    // cache) by hovering a genuine cross-page type reference.
    const link = page
      .locator('.VPDoc a[href$="/aws-cdk-lib.aws_cloudwatch.MetricOptions.html"]')
      .first();
    await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await link.hover();
    const tooltip = page.locator('#api-type-tooltip');
    await expect(tooltip).toHaveAttribute('aria-hidden', 'false', { timeout: 15_000 });

    // A heading's `#` permalink anchor: same-page target, no preview.
    // Its href resolves to the current page's own /v2/docs/ pathname,
    // which is exactly the case a preview must not fire on.
    const permalink = page.locator('.VPDoc .header-anchor').first();
    await permalink.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await permalink.hover();
    // Summaries are already cached, so a would-be tooltip appears fast;
    // give it a generous window to (not) show.
    await page.waitForTimeout(500);
    await expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    // No orphaned aria-describedby on the suppressed anchor.
    await expect(permalink).not.toHaveAttribute('aria-describedby', /./);

    // The right-hand "On this page" outline: suppressed regardless of target.
    const outlineLink = page.locator('.VPDocAsideOutline a').first();
    await expect(outlineLink).toBeVisible();
    await outlineLink.hover();
    await page.waitForTimeout(500);
    await expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    await expect(outlineLink).not.toHaveAttribute('aria-describedby', /./);
  });
});
