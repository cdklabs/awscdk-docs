import { expect, test } from '@playwright/test';
import { SKILLS_PAGE, TOPIC_PAGE } from './fixture.js';

// The Copy Markdown split button at the top of the page: the main button copies the page's Markdown twin, the
// options button opens a menu that links the file. Clipboard contents and focus movement are only observable in a
// real browser.
test.describe('Copy Markdown control', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const twin = TOPIC_PAGE.replace(/\.html$/, '.md');

  test('copies the page Markdown and shows Copied for two seconds', async ({ page, request }) => {
    await page.goto(TOPIC_PAGE);
    const expected = await (await request.get(twin)).text();

    const copy = page.locator('.copy-markdown-main');
    await expect(copy).toHaveText('Copy Markdown');
    await expect(page.getByRole('button', { name: 'Copy Markdown' })).toBeVisible();
    await copy.click();

    await expect(copy).toHaveText('Copied');
    await expect(page.locator('.copy-markdown [role="status"]')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);

    await expect(copy).toHaveText('Copy Markdown', { timeout: 5_000 });
    await expect(page.locator('.copy-markdown [role="status"]')).toHaveText('');
  });

  test('shows Copy failed when the file cannot be fetched and the menu stays usable', async ({ page }) => {
    await page.route(`**${twin}`, (route) => route.fulfill({ status: 404, body: 'missing' }));
    await page.goto(TOPIC_PAGE);

    const copy = page.locator('.copy-markdown-main');
    await copy.click();
    await expect(copy).toHaveText('Copy failed');
    await expect(page.locator('.copy-markdown [role="status"]')).toHaveText('Copy failed');

    await page.getByRole('button', { name: 'More Markdown options' }).click();
    await expect(page.getByRole('menuitem', { name: 'View as Markdown' })).toBeVisible();
  });

  test('the options menu follows the keyboard contract', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const options = page.getByRole('button', { name: 'More Markdown options' });
    const item = page.getByRole('menuitem', { name: 'View as Markdown' });

    await expect(options).toHaveAttribute('aria-haspopup', 'menu');
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    await expect(item).toBeHidden();

    await options.focus();
    await page.keyboard.press('Enter');
    await expect(options).toHaveAttribute('aria-expanded', 'true');
    await expect(item).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(item).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(item).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(item).toBeHidden();
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    await expect(options).toBeFocused();

    await page.keyboard.press('Space');
    await expect(item).toBeFocused();
  });

  test('a click outside closes the menu', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await page.getByRole('button', { name: 'More Markdown options' }).click();
    const item = page.getByRole('menuitem', { name: 'View as Markdown' });
    await expect(item).toBeVisible();

    // A raw mouse click at the page corner: Playwright's element click refuses the nav, which the content overlaps.
    await page.mouse.click(2, 2);
    await expect(item).toBeHidden();
  });

  test('the menu item opens the Markdown file in a new tab instead of downloading it', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await page.getByRole('button', { name: 'More Markdown options' }).click();
    const item = page.getByRole('menuitem', { name: 'View as Markdown' });
    await expect(item).toHaveAttribute('href', twin);
    await expect(item).toHaveAttribute('target', '_blank');
    await expect(item).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(item).not.toHaveAttribute('download');

    // Clicking is what proves it: the browser must show the file, not save it.
    const downloads: unknown[] = [];
    page.on('download', (d) => downloads.push(d));
    const [tab] = await Promise.all([page.context().waitForEvent('page'), item.click()]);
    await tab.waitForLoadState();
    expect(await tab.locator('body').innerText()).toMatch(/^# /);
    expect(downloads).toHaveLength(0);
  });

  test('activating View as Markdown with the keyboard returns focus to the options button', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const options = page.getByRole('button', { name: 'More Markdown options' });
    const popup = page.waitForEvent('popup');
    await options.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await (await popup).close();
    await expect(options).toBeFocused();
  });

  test('a page without a Markdown twin shows no control', async ({ page }) => {
    await page.goto(SKILLS_PAGE);
    await expect(page.locator('.VPNav')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy Markdown' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More Markdown options' })).toHaveCount(0);
  });

  test('the control is kept out of the search index', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.copy-markdown')).toHaveAttribute('data-pagefind-ignore', '');
  });
});
