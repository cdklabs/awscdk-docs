import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';
import { MAX_RECOVERY_RELOADS, RECOVER_GLOBAL } from '../../docs/.vitepress/asset-recovery.js';

// While a deploy rolls out host by host, a page's asset request can reach a host that serves the other build and get a
// 404, while a later request reaches one that has the file. These specs fail matching assets on the first document
// load only, or on every load, and expect the page to recover by reloading.

const STYLESHEET = /\/assets\/style\.[\w-]+\.css$/;
const METADATA_CHUNK = /\/assets\/chunks\/metadata\.[\w-]+\.js$/;
const TOPIC_CHUNK = /\/assets\/v2_docs_aws-cdk-lib\.aws_sns\.Topic\.md\.[\w-]+(\.lean)?\.js$/;
const QUEUE_CHUNK = /\/assets\/v2_docs_aws-cdk-lib\.aws_sqs\.Queue\.md\.[\w-]+(\.lean)?\.js$/;

/** Counts top-level document requests, the first included. Client-side navigations make none. */
function countDocumentLoads(page: Page): () => number {
  let loads = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads++;
  });
  return () => loads;
}

/** Answers requests matching `pattern` with a 404 while `failing()` holds. Returns the number of failed requests. */
async function failAssets(page: Page, pattern: RegExp, failing: () => boolean): Promise<() => number> {
  let failed = 0;
  await page.route(pattern, (route) => {
    if (!failing()) return route.fallback();
    failed++;
    return route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>404</title>' });
  });
  return () => failed;
}

/** The theme stylesheet is applied once its root custom properties resolve. */
async function themeStylesApplied(page: Page): Promise<boolean> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vp-c-brand-1').trim() !== '');
}

test.describe('asset recovery', () => {
  test('the recovery script runs before the stylesheet and module tags in the page head', async ({ request }) => {
    const html = await (await request.get(TOPIC_PAGE)).text();
    const script = html.indexOf(`window.${RECOVER_GLOBAL}`);
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(html.indexOf('rel="preload stylesheet"'));
    expect(script).toBeLessThan(html.indexOf('<script type="module"'));
  });

  test('a page whose stylesheet fails on the first load reloads with the stylesheet applied', async ({ page }) => {
    const loads = countDocumentLoads(page);
    const failed = await failAssets(page, STYLESHEET, () => loads() <= 1);

    await page.goto(TOPIC_PAGE);

    await expect.poll(() => loads()).toBe(2);
    await expect.poll(() => themeStylesApplied(page)).toBe(true);
    await expect(page.locator('h1')).toContainText('Topic');
    expect(failed()).toBeGreaterThan(0);
  });

  test('a page whose metadata chunk fails on the first load reloads hydrated', async ({ page }) => {
    const loads = countDocumentLoads(page);
    await failAssets(page, METADATA_CHUNK, () => loads() <= 1);

    await page.goto(TOPIC_PAGE);

    await expect.poll(() => loads()).toBe(2);
    await expect
      .poll(() => page.evaluate(() => Boolean((document.querySelector('#app') as { __vue_app__?: unknown })?.__vue_app__)))
      .toBe(true);
    await expect(page.locator('h1')).toContainText('Topic');
  });

  test('a page whose own chunk fails on the first load shows the page, not the not-found view', async ({ page }) => {
    const loads = countDocumentLoads(page);
    await failAssets(page, TOPIC_CHUNK, () => loads() <= 1);

    await page.goto(TOPIC_PAGE);

    await expect.poll(() => loads()).toBe(2);
    await expect(page.locator('h1')).toContainText('Topic');
    await expect(page.locator('.not-found-title')).toHaveCount(0);
  });

  test('a client-side navigation whose page chunk fails lands on the page after a reload', async ({ page }) => {
    const loads = countDocumentLoads(page);
    await failAssets(page, QUEUE_CHUNK, () => loads() <= 1);
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('h1')).toContainText('Topic');

    await page.evaluate((href) => {
      const link = document.createElement('a');
      link.href = href;
      link.id = 'queue-link';
      link.textContent = 'Queue';
      document.querySelector('.vp-doc')!.append(link);
    }, QUEUE_PAGE);
    await page.locator('#queue-link').click();

    await expect(page).toHaveURL(new RegExp(`${QUEUE_PAGE.replace(/\./g, '\\.')}$`));
    await expect.poll(() => loads()).toBe(2);
    await expect(page.locator('h1')).toContainText('Queue');
    await expect(page.locator('.not-found-title')).toHaveCount(0);
  });

  test('the not-found page for a missing address does not reload', async ({ page }) => {
    const loads = countDocumentLoads(page);

    await page.goto('/v2/docs/no-such-page.html');

    await expect(page.locator('.not-found-title')).toContainText('does not exist');
    await page.waitForTimeout(1500);
    expect(loads()).toBe(1);
  });

  test('a page whose stylesheet never loads stops reloading after the attempt limit', async ({ page }) => {
    const loads = countDocumentLoads(page);
    await failAssets(page, STYLESHEET, () => true);

    await page.goto(TOPIC_PAGE);

    await expect.poll(() => loads(), { timeout: 10_000 }).toBe(1 + MAX_RECOVERY_RELOADS);
    await page.waitForTimeout(2500);
    expect(loads()).toBe(1 + MAX_RECOVERY_RELOADS);
    await expect(page.locator('h1')).toContainText('Topic');
  });
});
