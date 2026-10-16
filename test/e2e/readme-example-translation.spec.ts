import { expect, test } from '@playwright/test';
import { SQS_OVERVIEW_PAGE } from './fixture.js';

// README example translation. The code examples in a
// (sub)module README are authored in TypeScript; their per-language
// translations ship in the package's jsii-rosetta tablet and the docgen
// emits them as `<LanguageTabs>` variant groups, so they flip with the
// shared language state exactly like a type page's example does.
//
// This needs a browser (AGENTS.md rule 7): the variant markup renders
// INSIDE the README's `v-pre` container, where the Vue component is never
// compiled — the markup is present in the HTML either way, so only a real
// page load can tell a working toggle from a dead one.

const STORAGE_KEY = 'cdk-docs-language';

function navSlider(page: import('@playwright/test').Page) {
  return page.getByRole('radiogroup', { name: 'Select programming language' });
}

test.describe('README example translation', () => {
  test('README examples render as language variant groups, TypeScript active by default', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    const groups = page.locator('.lang-tabs');
    // A compiled group means the component ran: markup inside `v-pre`
    // would leave the raw tag behind with no `data-active` attribute.
    expect(await groups.count()).toBeGreaterThan(0);
    await expect(groups.first()).toHaveAttribute('data-active', 'ts');
    await expect(page.locator('.lang-tabs .lang-variant[data-lang="ts"]').first()).toBeVisible();
    await expect(page.locator('.lang-tabs .lang-variant[data-lang="go"]').first()).toBeHidden();
  });

  test('switching to Go shows the Go translation of a README example, not the TypeScript', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    const queueGroup = page.locator('.lang-tabs', { hasText: 'new sqs.Queue(this,' }).first();
    await expect(queueGroup).toBeVisible();

    await navSlider(page).getByRole('radio', { name: 'Golang' }).click();

    await expect(queueGroup).toHaveAttribute('data-active', 'go');
    const goVariant = queueGroup.locator('.lang-variant[data-lang="go"]');
    await expect(goVariant).toBeVisible();
    await expect(goVariant).toContainText('sqs.NewQueue(this, jsii.String("Queue"))');
    await expect(queueGroup.locator('.lang-variant[data-lang="ts"]')).toBeHidden();
    // The whole page moved together, and the choice is shareable.
    await expect(page).toHaveURL(/[?&]lang=go/);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('go');
  });

  test('?lang=python selects the Python translation on first load', async ({ page }) => {
    await page.goto(`${SQS_OVERVIEW_PAGE}?lang=python`);

    const queueGroup = page.locator('.lang-tabs', { hasText: 'sqs.Queue(self,' }).first();
    await expect(queueGroup).toHaveAttribute('data-active', 'python');
    await expect(queueGroup.locator('.lang-variant[data-lang="python"]'))
      .toContainText('sqs.Queue(self, "Queue")');
  });

  test('README prose is still shielded and code is still highlighted', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    // Lifting the fences out of the README's `v-pre` container must not
    // cost them the shared highlighter's treatment: a highlighted fence
    // carries VitePress's `vp-code` class and its copy button.
    const firstCode = page.locator('.lang-tabs .lang-variant[data-lang="ts"] pre.vp-code').first();
    await expect(firstCode).toBeVisible();
    // No uncompiled component tag leaked into the rendered text.
    await expect(page.locator('#VPContent')).not.toContainText('<LanguageTabs');
  });
});
