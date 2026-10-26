import { expect, test, type Locator, type Page } from '@playwright/test';
import { QUEUE_PAGE, SQS_OVERVIEW_PAGE } from './fixture.js';

// README examples link their types (ADR 2026-10-26-readme-example-type-links): the aws_sqs README
// imports `sqs` through its rosetta fixture, so `sqs.Queue` links to the Queue page, through the same
// `code-type-link` anchors signature fences use.

/** The first README code block that carries a link to the Queue page. */
function linkedBlock(page: Page): Locator {
  return page
    .locator('.vp-doc div[class*="language-"]', { has: page.locator('a.code-type-link[href$="/aws-cdk-lib.aws_sqs.Queue.html"]') })
    .first();
}

test.describe('README example type links', () => {
  test('a type name in an example links to its page, with a quiet dotted underline', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);
    const link = linkedBlock(page).locator('a.code-type-link[href$="/aws-cdk-lib.aws_sqs.Queue.html"]').first();
    await expect(link).toHaveText('Queue');
    const style = await link.evaluate((el) => {
      const s = getComputedStyle(el);
      return { line: s.textDecorationLine, kind: s.textDecorationStyle };
    });
    expect(style).toEqual({ line: 'underline', kind: 'dotted' });

    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${QUEUE_PAGE.replace(/\./g, '\\.')}$`));
  });

  test('the hover preview shows on a README example link', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);
    const link = linkedBlock(page).locator('a.code-type-link').first();
    // Scroll first and let it settle: the theme hides previews on scroll.
    await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await link.hover();
    const tooltip = page.locator('#api-type-tooltip');
    await expect(tooltip).toHaveAttribute('aria-hidden', 'false', { timeout: 15_000 });
    await expect(tooltip.locator('.type-tooltip-name')).not.toBeEmpty();
  });

  test('the copy button copies the example text unchanged', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(SQS_OVERVIEW_PAGE);
    const block = linkedBlock(page);
    const code = await block.locator('pre code').evaluate((el) => el.textContent ?? '');
    await block.hover();
    const copy = block.locator('button.copy');
    await copy.click();
    await expect(copy).toHaveClass(/copied/);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    // VitePress copies the code text; the anchors add no characters to it.
    expect(copied.trimEnd()).toBe(code.trimEnd());
    expect(copied).not.toContain('href');
    expect(copied).toContain('new sqs.Queue(');
  });

  test('an inline code span naming a type of the README module links to it', async ({ page }) => {
    // The aws_sns README names `TopicPolicy` in its prose.
    await page.goto('/v2/docs/aws-cdk-lib.aws_sns-readme.html');
    const inline = page.locator('.vp-doc p a[href$="/aws-cdk-lib.aws_sns.TopicPolicy.html"] > code').first();
    await expect(inline).toHaveText('TopicPolicy');
  });

  test('a keyboard focus on an example link draws a visible ring', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);
    const link = linkedBlock(page).locator('a.code-type-link').first();
    await link.focus();
    const outline = await link.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('solid');
  });
});
