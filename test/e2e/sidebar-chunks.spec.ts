import { expect, test, type Page } from '@playwright/test';
import { apiSidebarAssetPath, chunkBase, QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';

// Per-section sidebar chunks: the
// sidebar fetches a small skeleton plus the chunk of the section holding the
// current page, and fetches every other section's chunk only when its closed
// heading stays in view for a moment, the reader opens it or navigates into it,
// or the filter searches the whole corpus.
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

  /** Resolves once the sidebar has stopped scrolling, so the load-time reveal is done. */
  async function scrollSettled(page: Page) {
    const top = () => page.evaluate(() => document.querySelector('.VPSidebar')?.scrollTop ?? 0);
    let last = -1;
    await expect.poll(async () => {
      const now = await top();
      const still = now === last;
      last = now;
      return still;
    }, { intervals: [150] }).toBe(true);
  }

  /** Chunk of each closed section heading, split by whether the heading is in the viewport now. */
  async function sectionChunksByView(page: Page): Promise<{ inView: string[]; outOfView: string[] }> {
    const skeleton = await (await page.request.get(apiSidebarAssetPath('sidebar'))).json();
    const chunkOf = new Map<string, string>(
      skeleton.flatMap((root: { items: { text: string; chunk?: string }[] }) =>
        root.items.filter((s) => s.chunk).map((s) => [s.text, s.chunk!])),
    );
    // The sidebar scroller clips its rows, so "in view" is inside its box, below its header, and in the window.
    const seen = await page.evaluate(() => {
      const scroller = document.querySelector('.VPSidebar')!;
      const area = scroller.getBoundingClientRect();
      // The sticky header paints over the top of the scroller.
      const header = scroller.querySelector('.sidebar-header')?.getBoundingClientRect();
      const top = Math.max(0, area.top, header?.bottom ?? 0);
      const bottom = Math.min(window.innerHeight, area.bottom);
      return Array.from(document.querySelectorAll<HTMLElement>('.api-sidebar-group[aria-expanded="false"]')).map((button) => {
        const box = button.getBoundingClientRect();
        return {
          text: button.querySelector('.api-sidebar-text')?.textContent ?? '',
          inView: box.bottom > top && box.top < bottom && box.height > 0,
        };
      });
    });
    const pick = (inView: boolean) =>
      seen.filter((h) => h.inView === inView && chunkOf.has(h.text)).map((h) => chunkBase(chunkOf.get(h.text)!));
    return { inView: pick(true), outOfView: pick(false) };
  }

  test('a cold load fetches the skeleton, the current page\'s chunk, and only sections in view', async ({ page }) => {
    const urls = recordSidebarRequests(page);
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active .api-sidebar-name')).toHaveText('Topic');

    expect(urls.filter((u) => u.endsWith(apiSidebarAssetPath('sidebar')))).toHaveLength(1);
    expect(chunks(urls).map(chunkBase)[0]).toBe('sns');
    // The skeleton is far smaller than one section's items: it holds no leaves.
    const skeleton = await (await page.request.get(apiSidebarAssetPath('sidebar'))).json();
    const sections = skeleton.flatMap((root: { items: unknown[] }) => root.items);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s: { items?: unknown }) => s.items === undefined)).toBe(true);
    // Other sections still render as closed groups the reader can open.
    await expect(page.getByRole('button', { name: 'SQS', exact: true })).toBeVisible();

    // Closed headings in view once the reveal settles load; the rest, including any it scrolled past, do not.
    await scrollSettled(page);
    const { inView, outOfView } = await sectionChunksByView(page);
    expect(inView.length).toBeGreaterThan(0);
    expect(outOfView.length).toBeGreaterThan(0);
    await expect.poll(() => inView.filter((name) => !chunks(urls).map(chunkBase).includes(name))).toEqual([]);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(chunks(urls).map(chunkBase).filter((name) => outOfView.includes(name))).toEqual([]);
  });

  // Fails every request for the chunk, so a load that still needs it cannot render its items.
  async function refuseChunk(page: Page, name: string) {
    await page.route('**/api-sidebar/chunks/**', (route) =>
      chunkBase(new URL(route.request().url()).pathname) === name ? route.abort() : route.continue());
  }

  const named = (urls: string[], name: string) => chunks(urls).map(chunkBase).filter((n) => n === name);
  const queueGroup = (page: Page) => page.locator('.api-sidebar li.api-sidebar-item').filter({
    has: page.getByRole('button', { name: 'Queue', exact: true }),
  });

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true });

    test('a closed section in view loads before it is tapped, so the tap renders at once', async ({ page }) => {
      const urls = recordSidebarRequests(page);
      const loaded = page.waitForResponse((response) => chunkBase(new URL(response.url()).pathname) === 'sqs');
      await page.goto(TOPIC_PAGE);
      await expect(page.locator('.api-sidebar-nav')).toBeVisible();
      const sqs = page.getByRole('button', { name: 'SQS', exact: true });
      await expect(sqs).toBeInViewport();
      await expect(sqs).toHaveAttribute('aria-expanded', 'false');
      // Nothing touches the heading: being in view is enough.
      await loaded;

      await refuseChunk(page, 'sqs');
      await sqs.tap();
      await expect(sqs).toHaveAttribute('aria-expanded', 'true');
      await expect(queueGroup(page).first()).toBeVisible();
      expect(named(urls, 'sqs')).toHaveLength(1);
    });
  });

  test('scrolling straight past a closed section fetches nothing', async ({ page }) => {
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
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active')).toBeInViewport();
    await scrollSettled(page);
    const { outOfView } = await sectionChunksByView(page);
    const skeleton = await (await page.request.get(apiSidebarAssetPath('sidebar'))).json();
    const target = skeleton
      .flatMap((root: { items: { text: string; chunk?: string }[] }) => root.items)
      .find((s: { chunk?: string }) => s.chunk && outOfView.at(-1) === chunkBase(s.chunk));
    expect(target).toBeDefined();

    const { swept, rested } = await page.evaluate(async (text) => {
      const labels = Array.from(document.querySelectorAll<HTMLElement>('.api-sidebar-group .api-sidebar-text'));
      const button = labels.find((label) => label.textContent === text)!.closest('button')!;
      const container = button.closest<HTMLElement>('.VPSidebar')!;
      const start = container.scrollTop;
      const fetches = () => [...(window as unknown as { sidebarFetches: string[] }).sidebarFetches];
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      button.scrollIntoView({ block: 'center', behavior: 'instant' });
      // Scrolls away halfway through the preload delay.
      await wait(50);
      container.scrollTo({ top: start, behavior: 'instant' });
      await wait(300);
      const before = fetches();
      // Control: the same heading, left in view, does load.
      button.scrollIntoView({ block: 'center', behavior: 'instant' });
      await wait(300);
      return { swept: before, rested: fetches() };
    }, target.text);
    const chunkNamesOf = (list: string[]) => list.filter((url) => url.includes('/api-sidebar/chunks/')).map(chunkBase);
    const name = chunkBase(target.chunk);
    expect(chunkNamesOf(swept)).not.toContain(name);
    expect(chunkNamesOf(rested)).toContain(name);
  });

  test('opening a section whose early load failed fetches its chunk again and renders its items', async ({ page }) => {
    const urls = recordSidebarRequests(page);
    await refuseChunk(page, 'sqs');
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    const sqs = page.getByRole('button', { name: 'SQS', exact: true });
    await expect(sqs).toHaveAttribute('aria-expanded', 'false');
    // The in-view load fails, so the section is still unloaded when it is opened.
    await expect.poll(() => named(urls, 'sqs')).toHaveLength(1);
    await page.unroute('**/api-sidebar/chunks/**');
    await sqs.click();
    await expect(sqs).toHaveAttribute('aria-expanded', 'true');
    // Its items arrive from the chunk: the Queue resource appears under it.
    const queue = page.locator('.api-sidebar li.api-sidebar-item').filter({
      has: page.getByRole('button', { name: 'Queue', exact: true }),
    });
    await expect(queue.first()).toBeVisible();
    expect(named(urls, 'sqs')).toHaveLength(2);
    // Closing and reopening does not refetch.
    await sqs.click();
    await sqs.click();
    await expect(queue.first()).toBeVisible();
    expect(named(urls, 'sqs')).toHaveLength(2);
  });

  test('navigating into another section loads its chunk and reveals the active page', async ({ page }) => {
    const urls = recordSidebarRequests(page);
    await refuseChunk(page, 'sqs');
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active .api-sidebar-name')).toHaveText('Topic');
    // The in-view load fails, so the section is still unloaded when the reader navigates into it.
    await expect.poll(() => named(urls, 'sqs')).toHaveLength(1);
    await page.unroute('**/api-sidebar/chunks/**');
    // Client-side navigation to a page whose section is still unloaded.
    await page.evaluate((href) => {
      const a = document.createElement('a');
      a.href = href;
      document.body.appendChild(a);
      a.click();
    }, QUEUE_PAGE);
    await expect(page).toHaveURL(new RegExp(QUEUE_PAGE.replace('.', '\\.')));
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active .api-sidebar-name')).toHaveText('Queue');
    expect(named(urls, 'sqs')).toHaveLength(2);
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
