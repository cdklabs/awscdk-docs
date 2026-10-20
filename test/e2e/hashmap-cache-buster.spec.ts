import { expect, test } from '@playwright/test';
import { QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';

// A page whose chunk is missing from the in-memory hashmap (a link into another shard) makes the VitePress router
// fetch hashmap.json and retry with it. The fixture is a single build that knows every page, so the spec drops one
// entry to reach that path, and serves a stale map on the bare URL as a browser holding an earlier deploy would.
const QUEUE_KEY = 'v2_docs_aws-cdk-lib.aws_sqs.queue.md';

test.describe('hashmap.json fallback', () => {
  test('a page missing from the hashmap loads through the cache-busted hashmap.json', async ({ page }) => {
    const fetched: string[] = [];
    await page.route(/\/hashmap\.json(\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      fetched.push(url.search);
      if (url.search) {
        return route.fallback();
      }
      const current = (await (await route.fetch()).json()) as Record<string, string>;
      const stale = Object.fromEntries(Object.keys(current).map((key) => [key, 'STALEMAP']));
      return route.fulfill({ json: stale });
    });

    await page.goto(TOPIC_PAGE);
    await expect(page.locator('h1')).toContainText('Topic');
    await page.evaluate(
      ({ key, href }) => {
        delete (window as unknown as { __VP_HASH_MAP__: Record<string, string> }).__VP_HASH_MAP__[key];
        const link = document.createElement('a');
        link.href = href;
        link.textContent = 'cross-shard link';
        link.id = 'cross-shard-link';
        document.querySelector('.vp-doc')!.append(link);
      },
      { key: QUEUE_KEY, href: QUEUE_PAGE },
    );
    await page.locator('#cross-shard-link').click();

    await expect(page).toHaveURL(new RegExp(`${QUEUE_PAGE.replace(/\./g, '\\.')}$`));
    await expect(page.locator('h1')).toContainText('Queue');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toMatch(/^\?v=[A-Za-z0-9._-]+$/);
  });
});
