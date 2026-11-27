import { expect, test } from '@playwright/test';

// The handwritten pages give Pagefind the same date the page's own content-revised meta states.

const HANDWRITTEN_PAGES = [
  '/',
  '/skills.html',
  '/stability.html',
  '/versions.html',
  '/v2/docs/aws-construct-library.html',
];

test.describe('Pagefind date meta', () => {
  test('each handwritten page is dated by its content-revised instant', async ({ request }) => {
    for (const url of HANDWRITTEN_PAGES) {
      const html = await (await request.get(url)).text();
      const date = /data-pagefind-meta="date:(\d+)"/.exec(html)?.[1];
      const revised = /<meta name="cdk-docs-content-revised" content="([^"]+)"/.exec(html)?.[1];

      expect(revised, url).toBeDefined();
      expect(Number(date), url).toBe(Date.parse(revised!));
    }
  });
});
