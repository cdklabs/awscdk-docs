import { expect, test } from '@playwright/test';
import { API_OVERVIEW, SKILLS_PAGE, TOPIC_PAGE } from './fixture.js';

// `/sitemap.xml` is a crawler's one authoritative list of every page. It is served as XML, every `<loc>` is an
// absolute URL under the public site prefix, and the authored pages sit in it next to the generated ones.
test.describe('sitemap', () => {
  const SITE = 'https://docs.aws.amazon.com/cdk/api/';

  test('is served as XML and lists the generated and authored pages as absolute public URLs', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');

    const body = await response.text();
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toMatch(/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"[ >]/);

    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(10);
    for (const loc of locs) expect(loc.startsWith(SITE)).toBe(true);
    expect(new Set(locs).size).toBe(locs.length);

    for (const page of [TOPIC_PAGE, API_OVERVIEW, SKILLS_PAGE]) {
      expect(locs).toContain(new URL(page.replace(/^\//, ''), SITE).href);
    }
    // The home page is the bare site URL, and the canonical tree carries no language query variants.
    expect(locs).toContain(SITE);
    expect(locs.some((loc) => loc.includes('?lang='))).toBe(false);
  });

  test('excluded sources and the Markdown twins stay out of it', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text();
    expect(body).not.toContain('/adr/');
    expect(body).not.toContain('construct-library.html');
    expect(body).not.toMatch(/<loc>[^<]*\.md<\/loc>/);
  });
});
