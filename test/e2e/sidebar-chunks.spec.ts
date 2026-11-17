import { expect, test, type Page } from '@playwright/test';
import { apiSidebarAssetPath, chunkBase, QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';

// Per-section sidebar chunks: the
// sidebar fetches a small skeleton plus the chunk of the section holding the
// current page, and fetches every other section's chunk only when the reader
// opens it, rests focus or the pointer on its heading, navigates into it,
// or filters the whole corpus.
test.describe('per-section sidebar chunks', () => {
  function recordSidebarRequests(page: Page): string[] {
    const urls: string[] = [];
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (path.includes('/api-sidebar/')) urls.push(path);
    });
    return urls;
  }

  const chunks = (urls: string[]) => urls.filter((u) => u.includes('/api-sidebar/chunks/'));

  test('a cold load fetches the skeleton and only the current page\'s chunk', async ({ page }) => {
    const urls = recordSidebarRequests(page);
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active .api-sidebar-name')).toHaveText('Topic');

    expect(urls.filter((u) => u.endsWith(apiSidebarAssetPath('sidebar')))).toHaveLength(1);
    expect(chunks(urls).map(chunkBase)).toEqual(['sns']);
    // The skeleton is far smaller than one section's items: it holds no leaves.
    const skeleton = await (await page.request.get(apiSidebarAssetPath('sidebar'))).json();
    const sections = skeleton.flatMap((root: { items: unknown[] }) => root.items);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s: { items?: unknown }) => s.items === undefined)).toBe(true);
    // Other sections still render as closed groups the reader can open.
    await expect(page.getByRole('button', { name: 'SQS', exact: true })).toBeVisible();
  });

  // Holds every request for one chunk until the returned release is called.
  async function holdChunk(page: Page, name: string): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api-sidebar/chunks/**', async (route) => {
      if (chunkBase(new URL(route.request().url()).pathname) === name) await held;
      await route.continue();
    });
    return release;
  }

  // Fails any further request for the chunk, so a click that still needs it cannot render its items.
  async function refuseChunk(page: Page, name: string) {
    await page.unroute('**/api-sidebar/chunks/**');
    await page.route('**/api-sidebar/chunks/**', (route) =>
      chunkBase(new URL(route.request().url()).pathname) === name ? route.abort() : route.continue());
  }

  const named = (urls: string[], name: string) => chunks(urls).map(chunkBase).filter((n) => n === name);

  for (const trigger of ['hover', 'focus'] as const) {
    test(`${trigger} on a closed section fetches its chunk once, before the click`, async ({ page }) => {
      const urls = recordSidebarRequests(page);
      const releaseSqs = await holdChunk(page, 'sqs');
      await page.goto(TOPIC_PAGE);
      await expect(page.locator('.api-sidebar-nav')).toBeVisible();
      const sqs = page.getByRole('button', { name: 'SQS', exact: true });
      await expect(sqs).toHaveAttribute('aria-expanded', 'false');

      await sqs[trigger]();
      await expect.poll(() => named(urls, 'sqs')).toHaveLength(1);
      // The other intent signal, outlasting the preload delay while the first fetch is still held.
      await (trigger === 'hover' ? sqs.focus() : sqs.hover());
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
      expect(named(urls, 'sqs')).toHaveLength(1);
      const loaded = page.waitForResponse((response) => chunkBase(new URL(response.url()).pathname) === 'sqs');
      releaseSqs();
      await loaded;

      await refuseChunk(page, 'sqs');
      await sqs.click();
      await expect(sqs).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.api-sidebar li.api-sidebar-item').filter({
        has: page.getByRole('button', { name: 'Queue', exact: true }),
      }).first()).toBeVisible();
      expect(named(urls, 'sqs')).toHaveLength(1);
    });
  }

  for (const pass of ['pointer', 'focus'] as const) {
    test(`a ${pass} passing over a closed section without resting fetches nothing`, async ({ page }) => {
    // Record fetches in the page itself, at the moment they start.
      await page.addInitScript(() => {
        const started: string[] = [];
        (window as unknown as { sidebarFetches: string[] }).sidebarFetches = started;
        const original = window.fetch.bind(window);
        window.fetch = (input, init) => {
          started.push(String(input instanceof Request ? input.url : input));
          return original(input, init);
        };
      });
      await page.goto(TOPIC_PAGE);
      await expect(page.locator('.api-sidebar-nav')).toBeVisible();
      await expect(page.getByRole('button', { name: 'SQS', exact: true })).toHaveAttribute('aria-expanded', 'false');

      const { swept, rested } = await page.evaluate(async (kind) => {
        const labels = Array.from(document.querySelectorAll<HTMLElement>('.api-sidebar-group .api-sidebar-text'));
        const button = labels.find((label) => label.textContent === 'SQS')!.closest('button')!;
        const fetches = () => [...(window as unknown as { sidebarFetches: string[] }).sidebarFetches];
        const enter = () => (kind === 'pointer' ? button.dispatchEvent(new MouseEvent('mouseenter')) : button.focus());
        enter();
        // Leaves halfway through the preload delay; timer order makes this deterministic.
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (kind === 'pointer') button.dispatchEvent(new MouseEvent('mouseleave'));
        else button.blur();
        // Scheduled after the preload delay, so this runs after any preload that was not cancelled.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const before = fetches();
        // Control: the same event, left to rest, does start the preload.
        enter();
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { swept: before, rested: fetches() };
      }, pass);
      const chunkNamesOf = (urls: string[]) => urls.filter((url) => url.includes('/api-sidebar/chunks/')).map(chunkBase);
      expect(chunkNamesOf(swept)).toEqual(['sns']);
      expect(chunkNamesOf(rested)).toContain('sqs');
    });
  }

  test('opening another section fetches its chunk and renders its items', async ({ page }) => {
    const urls = recordSidebarRequests(page);
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    const sqs = page.getByRole('button', { name: 'SQS', exact: true });
    await expect(sqs).toHaveAttribute('aria-expanded', 'false');
    await sqs.click();
    await expect(sqs).toHaveAttribute('aria-expanded', 'true');
    // Its items arrive from the chunk: the Queue resource appears under it.
    const queue = page.locator('.api-sidebar li.api-sidebar-item').filter({
      has: page.getByRole('button', { name: 'Queue', exact: true }),
    });
    await expect(queue.first()).toBeVisible();
    expect(chunks(urls).map(chunkBase)).toEqual(['sns', 'sqs']);
    // Closing and reopening does not refetch.
    await sqs.click();
    await sqs.click();
    await expect(queue.first()).toBeVisible();
    expect(chunks(urls)).toHaveLength(2);
  });

  test('navigating into another section loads its chunk and reveals the active page', async ({ page }) => {
    const urls = recordSidebarRequests(page);
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active .api-sidebar-name')).toHaveText('Topic');
    // Client-side navigation to a page whose section is still unloaded.
    await page.evaluate((href) => {
      const a = document.createElement('a');
      a.href = href;
      document.body.appendChild(a);
      a.click();
    }, QUEUE_PAGE);
    await expect(page).toHaveURL(new RegExp(QUEUE_PAGE.replace('.', '\\.')));
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active .api-sidebar-name')).toHaveText('Queue');
    expect(chunks(urls).map(chunkBase)).toEqual(['sns', 'sqs']);
    // The skeleton was fetched once for the whole session.
    expect(urls.filter((u) => u.endsWith(apiSidebarAssetPath('sidebar')))).toHaveLength(1);
  });

  test('the symbol filter loads every section so it still searches the whole corpus', async ({ page }) => {
    const urls = recordSidebarRequests(page);
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    await page.getByRole('textbox', { name: 'Filter navigation in the sidebar' }).fill('Queue');
    // A match from a section that was not loaded on arrival.
    await expect(page.locator('.api-sidebar a.api-sidebar-link', { hasText: /^Queue$/ }).first()).toBeVisible();
    const skeleton = await (await page.request.get(apiSidebarAssetPath('sidebar'))).json();
    const all = skeleton.flatMap((root: { items: { chunk: string }[] }) => root.items.map((s) => s.chunk)).sort();
    expect(chunks(urls).map((u) => u.replace('/api-sidebar/chunks/', '')).sort()).toEqual(all);
  });

  test('a query typed while the skeleton is still loading also loads every section', async ({ page }) => {
    const urls = recordSidebarRequests(page);
    // Hold the skeleton response until the reader has typed: the filter input
    // is usable before the sidebar is ready, so the query is already active
    // when the tree arrives.
    let releaseSkeleton!: () => void;
    const held = new Promise<void>((resolve) => (releaseSkeleton = resolve));
    await page.route(`**${apiSidebarAssetPath('sidebar')}`, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(TOPIC_PAGE);
    const filter = page.getByRole('textbox', { name: 'Filter navigation in the sidebar' });
    await filter.fill('Queue');
    await expect(page.locator('.api-sidebar-nav')).toHaveCount(0);
    releaseSkeleton();
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    // The match lives in a section other than the page's own.
    await expect(page.locator('.api-sidebar a.api-sidebar-link', { hasText: /^Queue$/ }).first()).toBeVisible();
    const skeleton = await (await page.request.get(apiSidebarAssetPath('sidebar'))).json();
    const all = skeleton.flatMap((root: { items: { chunk: string }[] }) => root.items.map((s) => s.chunk)).sort();
    expect(chunks(urls).map((u) => u.replace('/api-sidebar/chunks/', '')).sort()).toEqual(all);
  });
});
