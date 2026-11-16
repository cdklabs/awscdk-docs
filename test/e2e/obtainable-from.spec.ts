import { expect, test } from '@playwright/test';
import { IQUEUE_PAGE, QUEUE_PAGE, SUBSCRIPTION_FILTER_PAGE } from './fixture.js';

// The `obtainable from` hierarchy row: static factories and constants that
// hand out an instance of the page's type. The unit tests pin the markup; the
// browser checks are the ones the markup cannot answer — that an entry lands
// the reader on the factory's own row, and that the overflow disclosure the
// row shares with every other relation row opens and closes here too.
test.describe('obtainable from row', () => {
  test('an entry lands on the factory member of the owner page', async ({ page }) => {
    await page.goto(IQUEUE_PAGE);

    const row = page.locator('.inheritance-chain .chain-row#obtainable-from');
    await expect(row).toBeVisible();
    await expect(row.locator('.chain-label')).toHaveText('obtainable from');
    // Both Queue factories, in member order, and nothing else: the row is
    // limited to statics whose declared type IS the page type.
    await expect(row.locator('a.chain-item')).toHaveText(['Queue.fromQueueArn', 'Queue.fromQueueAttributes']);

    await row.locator('a.chain-item').first().click();
    await expect(page).toHaveURL(new RegExp(`${QUEUE_PAGE.replace(/\./g, '\\.')}#fromqueuearn$`));
    // The target is the member row itself, so the `:target` tint marks the
    // factory the reader asked about.
    const target = page.locator('.member-row#fromqueuearn');
    await expect(target).toBeVisible();
    await expect(target.locator('.member-name').first()).toHaveText('fromQueueArn');
  });

  test('the row is the last relation of the block', async ({ page }) => {
    await page.goto(IQUEUE_PAGE);

    const labels = await page.locator('.inheritance-chain .chain-row .chain-label').allTextContents();
    expect(labels.length).toBeGreaterThan(1);
    expect(labels[labels.length - 1]).toBe('obtainable from');
  });

  test('the overflow disclosure opens and closes', async ({ page }) => {
    await page.goto(SUBSCRIPTION_FILTER_PAGE);

    const row = page.locator('.inheritance-chain .chain-row#obtainable-from');
    const more = row.locator('.chain-more');
    await expect(more).toBeAttached();
    const hidden = more.locator('a.chain-item').first();
    await expect(hidden).toBeHidden();

    await more.locator('summary').click();
    await expect(more).toHaveAttribute('open', '');
    await expect(hidden).toBeVisible();
    // Every one of the four factories is reachable once the row is open.
    await expect(row.locator('a.chain-item')).toHaveText([
      'SubscriptionFilter.existsFilter',
      'SubscriptionFilter.notExistsFilter',
      'SubscriptionFilter.numericFilter',
      'SubscriptionFilter.stringFilter',
    ]);

    await more.locator('summary').click();
    await expect(more).not.toHaveAttribute('open', '');
    await expect(hidden).toBeHidden();
  });
});
