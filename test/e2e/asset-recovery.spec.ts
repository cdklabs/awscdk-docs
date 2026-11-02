import { expect, test, type Page, type Request } from '@playwright/test';
import { QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';

// A rollout can send a page's asset request to a host on another build, which answers 404, while a later request
// reaches a host that has the file. The recovery script's check that a host serves the file is a fetch().

const isCheck = (request: Request): boolean => request.resourceType() === 'fetch';

/** Counts top-level document requests. A client-side navigation makes none. */
function countLoads(page: Page): () => number {
  let loads = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads++;
  });
  return () => loads;
}

async function fail(page: Page, asset: RegExp, failing: (request: Request) => boolean): Promise<void> {
  await page.route(asset, (route) =>
    failing(route.request()) ? route.fulfill({ status: 404, body: 'not found' }) : route.fallback(),
  );
}

test.describe('asset recovery', () => {
  test('a page whose chunk fails to load renders after one reload', async ({ page }) => {
    const loads = countLoads(page);
    await fail(page, /\/assets\/v2_docs_aws-cdk-lib\.aws_sns\.Topic\.md\./, (r) => loads() === 1 && !isCheck(r));

    await page.goto(TOPIC_PAGE);

    await expect.poll(loads).toBe(2);
    await expect(page.locator('h1')).toContainText('Topic');
  });

  test('a client-side navigation whose page chunk fails to load renders after one reload', async ({ page }) => {
    const loads = countLoads(page);
    await fail(page, /\/assets\/v2_docs_aws-cdk-lib\.aws_sqs\.Queue\.md\./, () => loads() === 1);
    await page.goto(TOPIC_PAGE);
    await page.evaluate((href) => {
      const link = document.createElement('a');
      link.href = href;
      link.id = 'queue-link';
      link.textContent = 'Queue';
      document.querySelector('.vp-doc')!.append(link);
    }, QUEUE_PAGE);

    await page.locator('#queue-link').click();

    await expect.poll(loads).toBe(2);
    await expect(page.locator('h1')).toContainText('Queue');
  });

  test('a page does not reload when no host serves the failed file', async ({ page }) => {
    const loads = countLoads(page);
    await fail(page, /\/assets\/style\./, () => true);

    await page.goto(TOPIC_PAGE);

    await page.waitForTimeout(1000);
    expect(loads()).toBe(1);
  });

  test('the 404 page for a missing address does not reload', async ({ page }) => {
    const loads = countLoads(page);

    await page.goto('/v2/docs/no-such-page.html');

    await expect(page.locator('.not-found-title')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(loads()).toBe(1);
  });

  test('a page whose file keeps failing after a successful check stops after two reloads', async ({ page }) => {
    const loads = countLoads(page);
    await fail(page, /\/assets\/style\./, (r) => !isCheck(r));

    await page.goto(TOPIC_PAGE);

    await expect.poll(loads).toBe(3);
    await page.waitForTimeout(1000);
    expect(loads()).toBe(3);
  });
});
