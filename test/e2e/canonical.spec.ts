import { expect, test } from '@playwright/test';
import { CFN_QUEUE_PAGE, REPRESENTATIVE_PAGES, TOPIC_PAGE } from './fixture.js';

// Every page carries one canonical link, and its href is one of the absolute URLs the served `sitemap.xml` lists.

const CANONICAL = /<link[^>]+rel="canonical"[^>]*>/g;
const HREF = /href="([^"]+)"/;

async function canonicals(page: import('@playwright/test').Page, url: string): Promise<string[]> {
  const response = await page.goto(url);
  const html = await response!.text();
  return [...html.matchAll(CANONICAL)].map((match) => HREF.exec(match[0])![1]);
}

test.describe('canonical links', () => {
  test('every page carries exactly one, and it is the URL the sitemap lists for that page', async ({ page, request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text();
    const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
    expect(locs.size).toBeGreaterThan(10);

    for (const url of [...REPRESENTATIVE_PAGES, CFN_QUEUE_PAGE]) {
      const hrefs = await canonicals(page, url);
      expect(hrefs, url).toHaveLength(1);
      expect(locs, url).toContain(hrefs[0]);
    }
  });

  test('the home page canonicalizes to the bare site URL, with no language query anywhere', async ({ page }) => {
    const [home] = await canonicals(page, '/');
    expect(home.endsWith('/')).toBe(true);

    for (const url of [TOPIC_PAGE, CFN_QUEUE_PAGE]) {
      const [href] = await canonicals(page, url);
      expect(href, url).not.toContain('?');
      expect(href, url).toMatch(/\.html$/);
    }
  });

  test('the Markdown twin stays advertised alongside it', async ({ page }) => {
    const response = await page.goto(CFN_QUEUE_PAGE);
    const html = await response!.text();
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('type="text/markdown"');
  });
});
