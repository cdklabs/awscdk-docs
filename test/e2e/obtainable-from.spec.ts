import { expect, test } from '@playwright/test';
import { IQUEUE_PAGE, QUEUE_PAGE, SUBSCRIPTION_FILTER_PAGE } from './fixture.js';

// The `obtainable from` hierarchy row: static factories and constants that
// hand out an instance of the page's type. The unit tests pin the markup; the
// browser checks are the ones the markup cannot answer — that an entry lands
// the reader on the factory's own row, that the overflow disclosure the row
// shares with every other relation row opens and closes here too, and that
// its long `Owner.member` entries keep the two-line promise at desktop width
// and reflow at phone widths instead of widening the page.
test.describe('obtainable from row', () => {
  test('an entry lands on the factory member of the owner page', async ({ page }) => {
    await page.goto(IQUEUE_PAGE);

    const row = page.locator('.inheritance-chain .chain-row#obtainable-from');
    await expect(row).toBeVisible();
    await expect(row.locator('.chain-label')).toHaveText('obtainable from');
    // Both Queue factories, sorted by owner then member name, and nothing
    // else: the row is limited to statics whose declared type IS the page
    // type. The accessible name is what a screen reader or voice user gets;
    // `textContent` would also include the hidden language variants.
    const links = row.locator('a.chain-item');
    await expect(links.nth(0)).toHaveAccessibleName('Queue.fromQueueArn');
    await expect(links.nth(1)).toHaveAccessibleName('Queue.fromQueueAttributes');

    await row.locator('a.chain-item').first().click();
    await expect(page).toHaveURL(new RegExp(`${QUEUE_PAGE.replace(/\./g, '\\.')}#fromqueuearn$`));
    // The target is the member row itself, so the `:target` tint marks the
    // factory the reader asked about. A static method's header is a signature,
    // so the identifier lives in `.sig-name`, not a property's `.member-name`.
    const target = page.locator('.member-row#fromqueuearn');
    await expect(target).toBeVisible();
    await expect(target.locator('.member-signature .sig-name').first()).toHaveText('fromQueueArn');
  });

  test('the Python view shows the Python spelling of each entry', async ({ page }) => {
    // `?lang=python` is applied during hydration, so wait for the active tab
    // before reading, or the canonical TypeScript variant is what gets read.
    await page.goto(`${IQUEUE_PAGE}?lang=python`);
    await expect(page.locator('.lang-tabs').first()).toHaveAttribute('data-active', 'python');

    const links = page.locator('.inheritance-chain .chain-row#obtainable-from a.chain-item');
    await expect(links.nth(0)).toHaveAccessibleName('Queue.from_queue_arn');
    await expect(links.nth(1)).toHaveAccessibleName('Queue.from_queue_attributes');
    // The anchor stays canonical, so the link resolves in every language.
    await expect(links.nth(0)).toHaveAttribute('href', /#fromqueuearn$/);
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
    // `innerText` reads only the active language's variant.
    await expect(row.locator('a.chain-item')).toHaveText([
      'SubscriptionFilter.existsFilter',
      'SubscriptionFilter.notExistsFilter',
      'SubscriptionFilter.numericFilter',
      'SubscriptionFilter.stringFilter',
    ], { useInnerText: true });

    await more.locator('summary').click();
    await expect(more).not.toHaveAttribute('open', '');
    await expect(hidden).toBeHidden();
  });

  test('the row is at most two lines at desktop width', async ({ page }) => {
    // The 70-character budget was tuned on short type names; this row holds
    // the fixture's longest entries, so the two-line promise is measured here
    // too, the same way subclasses.spec.ts measures it on the Construct page.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(SUBSCRIPTION_FILTER_PAGE);

    const lines = await page.locator('.inheritance-chain .chain-row#obtainable-from').evaluate((el) => {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      return (el.getBoundingClientRect().height - pad) / lh;
    });
    expect(lines).toBeLessThanOrEqual(2);
  });

  for (const width of [375, 320]) {
    test(`the row reflows at ${width}px, closed and open`, async ({ page }) => {
      // One `Owner.member` token has no natural break; the `<wbr>` after the
      // dot and `overflow-wrap: anywhere` are what keep it inside the block
      // instead of widening the page (WCAG 1.4.10 Reflow).
      await page.setViewportSize({ width, height: 800 });
      await page.goto(SUBSCRIPTION_FILTER_PAGE);

      const row = page.locator('.inheritance-chain .chain-row#obtainable-from');
      const fits = () => row.evaluate((el) => {
        const block = el.closest('.inheritance-chain')!.getBoundingClientRect();
        const names = [...el.querySelectorAll('.chain-item')].map((a) => a.getBoundingClientRect().right);
        return {
          inside: Math.max(el.getBoundingClientRect().right, ...names) <= block.right + 0.5,
          noScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        };
      });
      expect(await fits()).toEqual({ inside: true, noScroll: true });

      await row.locator('.chain-more summary').click();
      await expect(row.locator('.chain-more')).toHaveAttribute('open', '');
      expect(await fits()).toEqual({ inside: true, noScroll: true });
    });
  }
});
