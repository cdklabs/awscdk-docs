import { expect, test } from '@playwright/test';
import { API_OVERVIEW, TOPIC_PAGE } from './fixture.js';

// The site sets its text in the Amazon Ember-first system stack and downloads no web font. Asserted on what the
// browser fetched and what it laid out, not on the stylesheet source.
test.describe('typeface', () => {
  for (const path of [TOPIC_PAGE, API_OVERVIEW]) {
    test(`${path} uses the system font stack and fetches no web font`, async ({ page }) => {
      const fontRequests: string[] = [];
      page.on('request', (r) => {
        if (r.resourceType() === 'font') {
          fontRequests.push(r.url());
        }
      });
      await page.goto(path, { waitUntil: 'networkidle' });
      expect(fontRequests).toEqual([]);

      const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      expect(body).toMatch(/^"?Amazon Ember"?, Helvetica, Arial, sans-serif$/);
    });
  }

  test('no page preloads a font', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(0);
  });
});
