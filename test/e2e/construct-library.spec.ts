import { expect, test, type Page } from '@playwright/test';
import { API_OVERVIEW, CONSTRUCT_LIBRARY_PAGE } from './fixture.js';

const LANGUAGES = [
  { radio: 'TypeScript', id: 'ts', marker: 'queueName' },
  { radio: 'Python', id: 'python', marker: 'queue_name' },
  { radio: 'Java', id: 'java', marker: 'Builder.create' },
  { radio: 'C#', id: 'dotnet', marker: 'new CfnQueueProps' },
  { radio: 'Go', id: 'go', marker: 'awssqs.NewCfnQueue' },
] as const;

function navSlider(page: Page) {
  return page.getByRole('radiogroup', { name: 'Select programming language' });
}

function examples(page: Page) {
  return page.locator('.vp-doc .lang-tabs', { has: page.locator('.lang-variant div[class*="language-"]') });
}

async function expectOnlyVisible(page: Page, lang: string) {
  const groups = examples(page);
  await expect(groups).toHaveCount(2);
  for (const group of await groups.all()) {
    for (const { id } of LANGUAGES) {
      const variant = group.locator(`.lang-variant[data-lang="${id}"]`);
      if (id === lang) await expect(variant).toBeVisible();
      else await expect(variant).toBeHidden();
    }
  }
}

test.describe('construct library overview', () => {
  for (const path of [API_OVERVIEW, CONSTRUCT_LIBRARY_PAGE]) {
    test(`renders the authored overview at ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'AWS Construct Library' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Construct levels' })).toBeVisible();
    });

    test(`code examples follow ?lang=python and back to TypeScript at ${path}`, async ({ page }) => {
      await page.goto(`${path}?lang=python`);
      await expectOnlyVisible(page, 'python');
      await expect(examples(page).first().locator('.lang-variant[data-lang="python"]')).toContainText('queue_name');

      await navSlider(page).getByRole('radio', { name: 'TypeScript' }).click();
      await expectOnlyVisible(page, 'ts');
      await expect(examples(page).first().locator('.lang-variant[data-lang="ts"]')).toContainText('queueName');
    });

    test(`code examples follow every language in the navbar slider at ${path}`, async ({ page }) => {
      await page.goto(path);
      for (const { radio, id, marker } of LANGUAGES) {
        await navSlider(page).getByRole('radio', { name: radio, exact: true }).click();
        await expectOnlyVisible(page, id);
        await expect(examples(page).first().locator(`.lang-variant[data-lang="${id}"]`)).toContainText(marker);
      }
    });
  }
});
