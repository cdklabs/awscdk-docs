import { expect, test, type Page } from '@playwright/test';
import { apiSidebarAssetPath, chunkBase, QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';

// Per-section sidebar chunks: the
// sidebar fetches a small skeleton plus the chunk of the section holding the
// current page, and fetches every other section's chunk only when the reader
// opens it, navigates into it, or filters the whole corpus.
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
