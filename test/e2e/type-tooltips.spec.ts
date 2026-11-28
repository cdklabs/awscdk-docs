import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiSidebarAssetPath, TOPIC_PAGE } from './fixture.js';

// Type-signature hover tooltips (type-tooltips.ts): hovering a
// cross-reference link into the generated API docs fetches the
// content-hashed type-summary lookup and shows an aria-correct tooltip. The
// lookup is complete in the fixture, so links may point at types outside the
// fixture's built pages — the tooltip only needs the lookup entry.
test.describe('type hover tooltips', () => {
  test('hovering an API type link shows an aria-correct tooltip', async ({ page }) => {
    const summaryRequests: string[] = [];
    page.on('request', (request) => {
      if (/type-summaries/.test(request.url())) {
        summaryRequests.push(new URL(request.url()).pathname);
      }
    });
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
    // The lookup comes from its content-hashed name, fetched once.
    expect(summaryRequests).toEqual([apiSidebarAssetPath('type-summaries')]);

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

// Previews also open on keyboard focus (`focusin`) and close when focus leaves the link (`focusout`).
// Keyboard focus that scrolls the page does not show a preview yet (see the fixme below).
test.describe('type tooltips on keyboard focus', () => {
  const METRIC_OPTIONS = '.VPDoc a[href$="/aws-cdk-lib.aws_cloudwatch.MetricOptions.html"]';

  /**
   * Move focus onto `link` with the Tab key, from the link just before it.
   * The link is scrolled into view first, so the focus move itself does not
   * scroll the page: a scroll hides the preview (see the hover tests above).
   */
  async function tabTo(page: Page, link: Locator): Promise<void> {
    await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await link.evaluate((target) => {
      const links = [...document.querySelectorAll<HTMLElement>('a[href]')];
      links[links.indexOf(target as HTMLElement) - 1].focus({ preventScroll: true });
    });
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
  }

  test('tabbing to an API type link shows its summary, described by the tooltip', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const link = page.locator(METRIC_OPTIONS).first();
    await tabTo(page, link);

    const tooltip = page.locator('#api-type-tooltip');
    // The first preview of the session fetches the whole summary map.
    await expect(tooltip).toBeVisible({ timeout: 15_000 });
    await expect(tooltip).toHaveAttribute('role', 'tooltip');
    await expect(tooltip).toHaveAttribute('aria-hidden', 'false');
    await expect(tooltip.locator('.type-tooltip-name')).toHaveText('MetricOptions');
    await expect(tooltip.locator('.type-tooltip-kind')).toHaveText('Struct');
    await expect(tooltip.locator('.type-tooltip-summary')).not.toBeEmpty();
    await expect(link).toHaveAttribute('aria-describedby', 'api-type-tooltip');
  });

  test('tabbing on to the next type link moves the tooltip with focus', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const first = page.locator(METRIC_OPTIONS).first();
    await tabTo(page, first);
    const tooltip = page.locator('#api-type-tooltip');
    await expect(tooltip.locator('.type-tooltip-name')).toHaveText('MetricOptions', { timeout: 15_000 });

    // On the Topic page the next link after a metric method's `MetricOptions`
    // parameter is its `Metric` return type.
    await page.keyboard.press('Tab');
    const next = page.locator(':focus');
    await expect(next).toHaveAttribute('href', /\/aws-cdk-lib\.aws_cloudwatch\.Metric\.html$/);
    await expect(tooltip.locator('.type-tooltip-name')).toHaveText('Metric');
    await expect(tooltip).toBeVisible();
    await expect(next).toHaveAttribute('aria-describedby', 'api-type-tooltip');
    await expect(first).not.toHaveAttribute('aria-describedby', /./);
  });

  test('tabbing back to a same-page permalink hides the tooltip', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const link = page.locator(METRIC_OPTIONS).first();
    await tabTo(page, link);
    const tooltip = page.locator('#api-type-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 15_000 });

    // The link just before it is the member's `#` permalink, which never gets a preview.
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator(':focus')).toHaveClass(/member-permalink/);
    await expect(tooltip).toBeHidden();
    await expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    await expect(link).not.toHaveAttribute('aria-describedby', /./);
  });

  test('moving focus off the link hides the tooltip', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const link = page.locator(METRIC_OPTIONS).first();
    await tabTo(page, link);
    const tooltip = page.locator('#api-type-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 15_000 });

    await link.blur();
    await expect(tooltip).toBeHidden();
    await expect(tooltip).toHaveAttribute('aria-hidden', 'true');
    await expect(link).not.toHaveAttribute('aria-describedby', /./);
  });

  test.fixme('Escape hides the tooltip while the link keeps focus', async ({ page }) => {
    // No key handler exists: Escape leaves the tooltip open (WCAG 1.4.13 asks for dismissal).
    await page.goto(TOPIC_PAGE);
    const link = page.locator(METRIC_OPTIONS).first();
    await tabTo(page, link);
    const tooltip = page.locator('#api-type-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(link).toBeFocused();
  });

  test.fixme('tabbing to a type link below the fold shows its tooltip', async ({ page }) => {
    // The scroll that focus causes fires after `focusin`, and the scroll handler hides the pending preview.
    await page.goto(TOPIC_PAGE);
    const link = page.locator(METRIC_OPTIONS).last();
    await expect(link).not.toBeInViewport();
    await link.evaluate((target) => {
      const links = [...document.querySelectorAll<HTMLElement>('a[href]')];
      links[links.indexOf(target as HTMLElement) - 1].focus({ preventScroll: true });
    });
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await expect(page.locator('#api-type-tooltip')).toBeVisible({ timeout: 15_000 });
  });
});
