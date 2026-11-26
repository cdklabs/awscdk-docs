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

  test('the control sits at the top of the page, above the content', async ({ page }) => {
    await open(page, SQS_OVERVIEW_PAGE);
    await expect(page.locator('.copy-markdown')).toBeInViewport();
    // The position is a bit field. Test the FOLLOWING bit (4) by arithmetic; lint bans bitwise operators.
    const aboveHeading = await page.evaluate(() => {
      const control = document.querySelector('.copy-markdown')!;
      const h1 = document.querySelector('.vp-doc h1')!;
      return Math.floor(control.compareDocumentPosition(h1) / Node.DOCUMENT_POSITION_FOLLOWING) % 2 === 1;
    });
    expect(aboveHeading).toBe(true);
  });

  test('on a type page the control is the first action of the chip row', async ({ page }) => {
    // Teleported on hydration, so a selector assertion alone could pass
    // against a copy left behind in `doc-before`.
    await open(page);
    await expect(page.locator('.type-header-row .type-action-copy .copy-markdown')).toHaveCount(1);
    await expect(page.locator('.copy-markdown')).toHaveCount(1);
    await expect(page.locator('.copy-markdown')).not.toHaveClass(/standalone/);
    // The split button keeps its two parts adjacent, main part first.
    const main = (await page.locator('.copy-markdown-main').boundingBox())!;
    const options = (await page.locator('.copy-markdown-options').boundingBox())!;
    expect(options.x).toBeGreaterThan(main.x);
    expect(Math.abs(options.y - main.y)).toBeLessThanOrEqual(1);
  });

  test('an API page with no chip row keeps the control above the content', async ({ page }) => {
    await open(page, SQS_OVERVIEW_PAGE);
    await expect(page.locator('.type-header-row')).toHaveCount(0);
    await expect(page.locator('.copy-markdown')).toHaveClass(/standalone/);
  });

  test('a client-side navigation between type pages re-finds the row', async ({ page }) => {
    await open(page);
    await page.locator('.vp-doc a[href$="aws-cdk-lib.aws_sns.TopicBase.html"]').first().click();
    await expect(page.locator('.vp-doc h1')).toHaveText('TopicBase');
    await expect(page.locator('.type-header-row .type-action-copy .copy-markdown')).toHaveCount(1);
    await expect(page.locator('.copy-markdown')).toHaveCount(1);
  });

  test('copies the page Markdown and shows Copied, then restores the label', async ({ page, request }) => {
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

    // Log every text the button and the live region take from here on. A retrying assertion would miss a stale
    // "Copied" that the 2 s reset clears inside its 5 s window, but the log keeps it.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __textSeen: string[] }).__textSeen = seen;
      const read = () => {
        seen.push(document.querySelector('.copy-markdown-main')?.textContent ?? '');
        seen.push(document.querySelector('.copy-markdown [role="status"]')?.textContent ?? '');
      };
      read();
      new MutationObserver(read).observe(document.body, { childList: true, characterData: true, subtree: true });
    });

    const done = page.waitForResponse((response) => response.url().endsWith(twin));
    release();
    await done;
    // Past the 100 ms re-announce delay, so a stale result would have been logged by now.
    await page.waitForTimeout(300);
    const seen = await page.evaluate(() => (window as unknown as { __textSeen: string[] }).__textSeen);
    expect(seen).not.toContain('Copied');
    expect(seen).not.toContain('Copy failed');
    expect(await copy.textContent()).toBe('Copy Markdown');
  });

  test('a slow first copy that fails does not overwrite a second copy that succeeded', async ({ page }) => {
    // The first twin request waits behind a gate and then 404s; the second goes through at once.
    // Stub the clipboard so Chromium's own write queue cannot decide the outcome. Each write still waits for its
    // blob, so a failed fetch rejects that write. The real clipboard round trip is covered by the first test.
    await page.addInitScript(() => {
      const win = window as unknown as { __settled: number };
      win.__settled = 0;
      navigator.clipboard.write = async (items) => {
        try {
          await items[0].getType('text/plain');
        } finally {
          win.__settled += 1;
        }
      };
    });
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

    release();
    // Both writes have settled: the page has handled the 404, so a stale "Copy failed" would be on its way.
    await expect.poll(() => page.evaluate(() => (window as unknown as { __settled: number }).__settled)).toBe(2);
    await page.waitForTimeout(150); // past the 100 ms re-announce delay
    expect(await copy.textContent()).toBe('Copied');
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
    // Focus moved on past the control, in document order, and not back to the top of the page.
    expect(
      await page.evaluate(() => {
        const root = document.querySelector('.copy-markdown')!;
        const active = document.activeElement!;
        // Test DOCUMENT_POSITION_FOLLOWING (4) by arithmetic; lint bans bitwise operators.
        const following = Math.floor(root.compareDocumentPosition(active) / Node.DOCUMENT_POSITION_FOLLOWING) % 2 === 1;
        return active !== document.body && !root.contains(active) && following;
      }),
    ).toBe(true);

    await options.focus();
    await page.keyboard.press('Enter');
    await expect(item).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(item).toBeHidden();
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    await expect(options).toBeFocused();
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

  test('clicking Copy Markdown closes an open menu', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'More Markdown options' }).click();
    const item = page.getByRole('menuitem', { name: 'View as Markdown' });
    await expect(item).toBeVisible();

    await page.locator('.copy-markdown-main').click();
    await expect(item).toBeHidden();
    await expect(page.getByRole('button', { name: 'More Markdown options' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('moving focus outside the control closes the open menu', async ({ page }) => {
    await open(page);
    const options = page.getByRole('button', { name: 'More Markdown options' });
    await options.click();
    await expect(page.getByRole('menuitem', { name: 'View as Markdown' })).toBeVisible();

    // Script moves focus, as a screen reader or the search hotkey would, with no pointer press.
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '#';
      link.id = 'focus-target';
      document.body.appendChild(link);
      link.focus();
    });
    await expect(page.locator('#focus-target')).toBeFocused();
    await expect(page.getByRole('menuitem', { name: 'View as Markdown' })).toBeHidden();
    await expect(options).toHaveAttribute('aria-expanded', 'false');
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
    page.context().on('page', (opened) => opened.on('download', (d) => downloads.push(d)));
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

  test('Space on the View as Markdown item activates it without scrolling the page', async ({ page }) => {
    await open(page);
    const options = page.getByRole('button', { name: 'More Markdown options' });
    const popup = page.waitForEvent('popup');
    await options.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'View as Markdown' })).toBeFocused();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Space');
    await (await popup).close();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
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
