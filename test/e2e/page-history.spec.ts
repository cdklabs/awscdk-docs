import { expect, test } from '@playwright/test';
import { CFN_QUEUE_PAGE, REPRESENTATIVE_PAGES, TOPIC_PAGE } from './fixture.js';

// Every page states when it was last revised, in the footer for readers and as a `cdk-docs-content-revised` meta
// for machines; a page's own version history is emitted only when the ledger records it, never as an empty meta.

const REVISED_LINE = /^Content revised \d{1,2} [A-Z][a-z]{2} \d{4}$/;

test.describe('page revision date', () => {
  test('every doc page footer carries the revised line, server-rendered', async ({ page }) => {
    // The home page uses the `home` layout, which has no doc footer; its meta is covered below.
    for (const url of [...REPRESENTATIVE_PAGES.filter((u) => u !== '/'), CFN_QUEUE_PAGE]) {
      const response = await page.goto(url);
      const html = await response!.text();
      // Server-rendered, so a reader without JS sees it too.
      expect(html, url).toMatch(/<span class="footer-revised"[^>]*>Content revised /);
      const revised = page.locator('.page-footer-links .footer-revised');
      await expect(revised, url).toHaveCount(1);
      await expect(revised, url).toHaveText(REVISED_LINE);
    }
  });

  test('every page carries exactly one content-revised meta with a full timestamp', async ({ page }) => {
    for (const url of [...REPRESENTATIVE_PAGES, CFN_QUEUE_PAGE]) {
      const response = await page.goto(url);
      const html = await response!.text();
      const metas = html.match(/<meta name="cdk-docs-content-revised" content="[^"]*">/g) ?? [];
      expect(metas, url).toHaveLength(1);
      expect(metas[0], url).toMatch(/content="\d{4}-\d{2}-\d{2}T[\d:.]+Z"/);
    }
  });

  test('the footer date is the meta date, rendered day-only', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const meta = await page.locator('meta[name="cdk-docs-content-revised"]').getAttribute('content');
    const day = new Date(meta!).getUTCDate();
    await expect(page.locator('.page-footer-links .footer-revised')).toContainText(`Content revised ${day} `);
  });

  test('recorded history is present in the head and reader metadata', async ({ page }) => {
    const response = await page.goto(CFN_QUEUE_PAGE);
    const html = await response!.text();
    expect(html).not.toMatch(/cdk-docs-introduced-in/);
    expect(html).toContain('<meta name="cdk-docs-last-changed-in" content="2.252.0">');
    expect(html).toContain('<meta name="cdk-docs-last-changed-at" content="2026-04-30T12:32:40.415Z">');
    expect(html).not.toMatch(/<meta name="cdk-docs-[a-z-]*" content="">/);
    await expect(page.locator('.type-metadata-label', { hasText: 'Type last changed' })).toHaveCount(1);
    await expect(page.locator('.type-metadata-changed')).toHaveText('v2.252.0 · 30 Apr 2026');
  });
});
