import { expect, test } from '@playwright/test';
import { API_OVERVIEW, CONSTRUCT_LIBRARY_PAGE } from './fixture.js';

test.describe('construct library overview', () => {
  for (const path of [API_OVERVIEW, CONSTRUCT_LIBRARY_PAGE]) {
    test(`renders the authored overview at ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'AWS Construct Library' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Construct levels' })).toBeVisible();
    });
  }
});
