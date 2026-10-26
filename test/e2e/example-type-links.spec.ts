import { expect, test } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// Type links skip strings and comments (ADR 2026-10-26-no-type-links-in-literals). The Queue page's example
// creates `new sqs.Queue(this, 'Queue')`: the class links, the construct id string does not.
// The e2e fixture site has no aws_s3 pages, so Queue stands in for Bucket.
test.describe('example type links skip strings and comments', () => {
  test('on the built Queue page no type link sits next to a quote, and the real class still links', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const links = page.locator('.vp-doc div[class*="language-"] a.code-type-link');
    expect(await links.count()).toBeGreaterThan(0);
    const report = await links.evaluateAll((anchors) => anchors.map((a) => {
      // The line's text up to the link: a quote right before it means the link starts inside a string.
      const line = a.closest('.line');
      const range = document.createRange();
      range.setStart(line ?? a, 0);
      range.setEndBefore(a);
      return {
        name: a.textContent,
        quoteBefore: /['"`]$/.test(range.toString()),
        inLiteral: !!a.closest('.code-nolink'),
      };
    }));
    expect(report.filter((r) => r.quoteBefore || r.inLiteral)).toEqual([]);
    expect(report.map((r) => r.name)).toContain('Queue');
    // The construct id string is still there, just not linked.
    const strings = page.locator('.vp-doc div[class*="language-"] .code-nolink', { hasText: 'Queue' });
    expect(await strings.count()).toBeGreaterThan(0);
    // Marking strings never changes the code text: the spaces between keywords survive.
    const text = await page.locator('.vp-doc div[class*="language-"] pre code').first().textContent();
    expect(text).toContain('import * as ');
    expect(text).not.toMatch(/declareconst|import\*as/);
  });
});
