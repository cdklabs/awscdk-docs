import { expect, Page, test } from '@playwright/test';
import { SKILLS_PAGE, TOPIC_PAGE } from './fixture.js';

// The site links a placeholder `site-overrides.css` that the downstream build replaces with its own file. Whether
// a replacement styles the page, and wins over the theme at equal specificity, only shows in a real browser.

const MISSING_PAGE = '/v2/docs/aws-cdk-lib.aws_s3.NoSuchThing';
const PAGES = ['/', '/versions.html', TOPIC_PAGE, SKILLS_PAGE, MISSING_PAGE];

const STYLESHEET_LINK = /<link\b[^>]*\brel="[^"]*\bstylesheet\b[^"]*"[^>]*>/g;
const OVERRIDES_HREF = 'href="/site-overrides.css"';

/** Serve `css` in place of the shipped placeholder, as the downstream replacement would be. */
async function replaceOverrides(page: Page, css: string): Promise<void> {
  await page.route('**/site-overrides.css', (route) => route.fulfill({ body: css, contentType: 'text/css' }));
}

test.describe('site-overrides.css', () => {
  test('is served at the site root', async ({ request }) => {
    const response = await request.get('/site-overrides.css');
    expect(response.status()).toBe(200);
  });

  test('every page type links it exactly once, after the theme stylesheets', async ({ request }) => {
    for (const url of PAGES) {
      const html = await (await request.get(url)).text();
      const head = html.slice(0, html.indexOf('</head>'));
      const links = [...head.matchAll(STYLESHEET_LINK)].map((m) => m[0]);
      expect(html.split('site-overrides.css').length - 1, url).toBe(1);
      expect(links.filter((link) => link.includes(OVERRIDES_HREF)), url).toHaveLength(1);
      expect(links.length, url).toBeGreaterThan(1);
      expect(links.at(-1), url).toContain(OVERRIDES_HREF);
    }
  });

  test('a replacement file styles the page', async ({ page }) => {
    await replaceOverrides(page, 'body { outline: 1px solid rgb(255, 0, 0); }');
    await page.goto(TOPIC_PAGE);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).outlineColor))
      .toBe('rgb(255, 0, 0)');
  });

  test('a replacement rule beats the theme rule of equal specificity', async ({ page }) => {
    await replaceOverrides(page, ':root { --vp-c-brand-1: rgb(1, 2, 3); }');
    await page.goto(TOPIC_PAGE);
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vp-c-brand-1').trim()),
      )
      .toBe('rgb(1, 2, 3)');
  });

  test('a client-side navigation keeps one link and the replacement styles', async ({ page }) => {
    await replaceOverrides(page, 'body { outline: 1px solid rgb(255, 0, 0); }');
    await page.goto(TOPIC_PAGE);
    await page.locator('.VPNavBar .version-badge').click();
    await expect(page).toHaveURL(/\/versions/);
    await expect(page.locator('head link[href$="site-overrides.css"]')).toHaveCount(1);
    expect(await page.evaluate(() => getComputedStyle(document.body).outlineColor)).toBe('rgb(255, 0, 0)');
  });
});
