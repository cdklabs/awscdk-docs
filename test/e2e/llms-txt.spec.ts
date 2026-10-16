import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// The site-scoped llms.txt: served at the site root beside sitemap.xml, advertised from every page's <head>, and
// every module it lists resolves to a Markdown twin on this same server — asserted by fetching, not by shape alone.
test.describe('site-scoped llms.txt', () => {
  test('every page advertises the index as a text/plain alternate, beside its own twin', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const index = page.locator('head link[rel="alternate"][type="text/plain"]');
    await expect(index).toHaveCount(1);
    await expect(index).toHaveAttribute('href', '/llms.txt');
    await expect(page.locator('head link[rel="alternate"][type="text/markdown"]')).toHaveCount(1);
  });

  test('the index is plain text in the llms.txt shape and lists module overviews', async ({ request }) => {
    const response = await request.get('/llms.txt');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');
    const body = await response.text();
    expect(body.startsWith('# AWS CDK Reference\n\n> ')).toBe(true);
    expect(body).toContain('sitemap.xml');
    expect(body).toContain('\n## Modules\n');
    expect(body.match(/^- \[.+\]\(https?:\/\/.+-readme\.md\): \S+$/gm)?.length ?? 0).toBeGreaterThan(0);
  });

  test('every listed module twin resolves on this server as Markdown', async ({ request, baseURL }) => {
    const body = await (await request.get('/llms.txt')).text();
    const links = [...body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => new URL(m[1]));
    const site = new URL(links[0].href);
    // Links are absolute to the production site; the fixture serves the same tree at its own origin and base.
    const local = (u: URL) => `${baseURL}${u.pathname.replace(/^\/cdk\/api\//, '/')}`;
    const twins = links.filter((u) => u.pathname.endsWith('-readme.md'));
    expect(twins.length).toBeGreaterThan(0);
    // The fixture is pruned to a few services, so probe the ones it kept rather than all 600+.
    const kept = twins.filter((u) => /aws_sns|aws_sqs|constructs-readme|aws-cdk-lib-readme/.test(u.pathname));
    expect(kept.length).toBeGreaterThan(0);
    for (const u of kept) {
      const res = await request.get(local(u));
      expect(res.status(), local(u)).toBe(200);
      expect(res.headers()['content-type']).toContain('text/markdown');
    }
    const sitemap = links.find((u) => u.pathname.endsWith('/sitemap.xml'))!;
    expect(sitemap.origin).toBe(site.origin);
    expect((await request.get(local(sitemap))).status()).toBe(200);
  });
});
