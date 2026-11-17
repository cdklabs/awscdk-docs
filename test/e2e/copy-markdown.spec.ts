import { expect, test, type Page } from '@playwright/test';
import { SKILLS_PAGE, SQS_OVERVIEW_PAGE, TOPIC_PAGE } from './fixture.js';

// The Copy Markdown split button at the top of the page: the main button copies the page's Markdown twin, the
// options button opens a menu that links the file. Clipboard contents and focus movement are only observable in a
// real browser.
test.describe('Copy Markdown control', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const twin = TOPIC_PAGE.replace(/\.html$/, '.md');

  // The control is server-rendered, so its buttons exist before Vue hydrates. A click that lands first hits no
  // handler. `data-ready` is set in onMounted, so waiting for it removes the race on a slow runner.
  const open = async (page: Page, path: string = TOPIC_PAGE) => {
    await page.goto(path);
    await page.locator('.copy-markdown[data-ready]').waitFor();
  };

  test('copies the page Markdown and shows Copied for two seconds', async ({ page, request }) => {
    await open(page);
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

  test('a second copy within two seconds re-announces: the live region empties, then fills again', async ({ page }) => {
    await open(page);
    const status = page.locator('.copy-markdown [role="status"]');
    const copy = page.locator('.copy-markdown-main');
    await copy.click();
    await expect(status).toHaveText('Copied');

    // Record every text the live region takes from here on, with a timestamp. A single tick between the empty
    // state and the refill would also log both texts, so the test measures how long the region stayed empty.
    await page.evaluate(() => {
      const node = document.querySelector('.copy-markdown [role="status"]')!;
      const seen: { text: string; at: number }[] = [];
      (window as unknown as { __statusSeen: typeof seen }).__statusSeen = seen;
      new MutationObserver(() => seen.push({ text: node.textContent ?? '', at: performance.now() })).observe(node, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    await copy.click();
    // The region already reads "Copied" from the first click, so wait on the log: the refill has happened only
    // once the observer has seen "Copied" again.
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { __statusSeen: { text: string }[] }).__statusSeen.some((e) => e.text === 'Copied'),
        ),
      )
      .toBe(true);
    const seen = await page.evaluate(
      () => (window as unknown as { __statusSeen: { text: string; at: number }[] }).__statusSeen,
    );
    const emptied = seen.find((entry) => entry.text === '');
    const refilled = seen.filter((entry) => entry.text === 'Copied').pop();
    expect(emptied).toBeDefined();
    expect(refilled).toBeDefined();
    // The component waits 100 ms between the two; allow some timer slack.
    expect(refilled!.at - emptied!.at).toBeGreaterThanOrEqual(80);
  });

  test('a copy that finishes after the reader navigates does not mark the next page', async ({ page }) => {
    // Hold the twin back so the copy is still in flight when the route changes.
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    await page.route(`**${twin}`, async (route) => {
      await gate;
      await route.continue();
    });
    await open(page);
    const copy = page.locator('.copy-markdown-main');
    await copy.click();

    await page.evaluate((href) => {
      const link = document.createElement('a');
      link.href = href;
      document.querySelector('.VPContent')!.appendChild(link);
      link.click();
    }, SQS_OVERVIEW_PAGE);
    await expect(page).toHaveURL(new RegExp(`${SQS_OVERVIEW_PAGE}$`));

    const done = page.waitForResponse((response) => response.url().endsWith(twin));
    release();
    await done;
    // Past the 100 ms re-announce delay, so a stale result would be on screen by now.
    await page.waitForTimeout(300);
    await expect(copy).toHaveText('Copy Markdown');
    await expect(page.locator('.copy-markdown [role="status"]')).toHaveText('');
  });

  test('a slow first copy that fails does not overwrite a second copy that succeeded', async ({ page }) => {
    // The first twin request waits behind a gate and then 404s; the second goes through at once.
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let calls = 0;
    await page.route(`**${twin}`, async (route) => {
      calls += 1;
      if (calls === 1) {
        await gate;
        await route.fulfill({ status: 404, body: 'missing' });
      } else {
        await route.continue();
      }
    });
    await open(page);
    const copy = page.locator('.copy-markdown-main');
    await copy.click();
    await copy.click();
    await expect(copy).toHaveText('Copied');

    const done = page.waitForResponse((response) => response.url().endsWith(twin) && response.status() === 404);
    release();
    await done;
    await page.waitForTimeout(300);
    await expect(copy).toHaveText('Copied');
  });

  test('shows Copy failed when the file cannot be fetched and the menu stays usable', async ({ page }) => {
    await page.route(`**${twin}`, (route) => route.fulfill({ status: 404, body: 'missing' }));
    await open(page);

    const copy = page.locator('.copy-markdown-main');
    await copy.click();
    await expect(copy).toHaveText('Copy failed');
    await expect(page.locator('.copy-markdown [role="status"]')).toHaveText('Copy failed');

    await page.getByRole('button', { name: 'More Markdown options' }).click();
    await expect(page.getByRole('menuitem', { name: 'View as Markdown' })).toBeVisible();
  });

  test('the options menu follows the keyboard contract', async ({ page }) => {
    await open(page);
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

  test('Tab and Shift+Tab leave the open menu closed and move focus on', async ({ page }) => {
    await open(page);
    const options = page.getByRole('button', { name: 'More Markdown options' });
    const item = page.getByRole('menuitem', { name: 'View as Markdown' });

    await options.focus();
    await page.keyboard.press('Enter');
    await expect(item).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(item).toBeHidden();
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);

    await options.focus();
    await page.keyboard.press('Enter');
    await expect(item).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(item).toBeHidden();
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  });

  test('client-side navigation resets the menu and the result', async ({ page }) => {
    await open(page);
    const copy = page.locator('.copy-markdown-main');
    await copy.click();
    await expect(copy).toHaveText('Copied');
    await page.getByRole('button', { name: 'More Markdown options' }).click();
    await expect(page.getByRole('menuitem', { name: 'View as Markdown' })).toBeVisible();

    // Follow an in-site link through the router (no full page load), well inside the 2 s result window.
    await page.evaluate((href) => {
      const link = document.createElement('a');
      link.href = href;
      document.querySelector('.VPContent')!.appendChild(link);
      link.click();
    }, SQS_OVERVIEW_PAGE);
    await expect(page).toHaveURL(new RegExp(`${SQS_OVERVIEW_PAGE}$`));

    await expect(copy).toHaveText('Copy Markdown', { timeout: 1_000 });
    await expect(page.locator('.copy-markdown [role="status"]')).toHaveText('');
    await expect(page.getByRole('menuitem', { name: 'View as Markdown' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'More Markdown options' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('a click outside closes the menu', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'More Markdown options' }).click();
    const item = page.getByRole('menuitem', { name: 'View as Markdown' });
    await expect(item).toBeVisible();

    // A raw mouse click at the page corner: Playwright's element click refuses the nav, which the content overlaps.
    await page.mouse.click(2, 2);
    await expect(item).toBeHidden();
  });

  test('the menu item opens the Markdown file in a new tab against the e2e server', async ({ page }) => {
    await open(page);
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
    await open(page);
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
