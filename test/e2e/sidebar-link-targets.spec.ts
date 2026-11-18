import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Raw anchors built from stored page links name the served `.html` file.
//
// The sidebar, the favorites list and the symbol index store links without
// `.html`. The host answers an extensionless path with `404.html` (a 404
// status and a `404` title until the client swaps the page in), so an anchor
// opened in a fresh tab (middle-click, "open in new tab", a copied link) has
// to carry the suffix itself. The e2e server mirrors the host: an
// extensionless path is a 404.
test.describe('sidebar links open as real page URLs', () => {
  /** A page href is either a file (`.html`) or a directory (trailing `/`). */
  const PAGE_FILE = /(\.html|\/)$/;

  async function waitForSidebar(page: Page) {
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  /**
   * Open a dozen collapsed groups, outermost first, so leaves from several
   * sections (not only the active one) are rendered. The whole tree is too
   * large to open within one test's budget, and every leaf is rendered by the
   * same component, so a sample across groups is what the assertion needs.
   */
  async function expandSome(page: Page) {
    for (let round = 0; round < 12; round++) {
      // An element handle, not a locator: a `[aria-expanded="false"]` locator
      // re-resolves after the click to one of the children it just revealed.
      const target = await page
        .locator('.api-sidebar .api-sidebar-group[aria-expanded="false"]')
        .first()
        .elementHandle({ timeout: 1000 })
        .catch(() => null);
      if (!target) {
        return;
      }
      await target.scrollIntoViewIfNeeded();
      await target.click();
      await expect.poll(() => target.getAttribute('aria-expanded')).toBe('true');
    }
  }

  async function sidebarHrefs(page: Page, atLeast: number): Promise<string[]> {
    const hrefs = await page.locator('.api-sidebar a.api-sidebar-link').evaluateAll((anchors) =>
      anchors.map((a) => a.getAttribute('href') ?? ''),
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(atLeast);
    return hrefs;
  }

  /**
   * Open `href` in a fresh tab and record every distinct `document.title` from
   * the first script tick until the load event, polling every 100 ms plus a
   * MutationObserver on `<head>` so a swap between two polls cannot slip
   * through.
   */
  async function titlesWhileLoading(context: BrowserContext, href: string) {
    const tab = await context.newPage();
    await tab.addInitScript(() => {
      const seen: string[] = [];
      const note = () => {
        const title = document.title;
        if (seen[seen.length - 1] !== title) {
          seen.push(title);
        }
      };
      (window as unknown as { __titles: string[] }).__titles = seen;
      note();
      const poll = setInterval(note, 100);
      const observer = new MutationObserver(note);
      const watchHead = () => {
        if (document.head) {
          observer.observe(document.head, { childList: true, subtree: true, characterData: true });
        } else {
          setTimeout(watchHead, 0);
        }
      };
      watchHead();
      window.addEventListener('load', () => {
        note();
        clearInterval(poll);
      });
    });
    const response = await tab.goto(href, { waitUntil: 'load' });
    const titles = await tab.evaluate(() => (window as unknown as { __titles: string[] }).__titles);
    await tab.close();
    return { status: response?.status(), titles };
  }

  test('every sidebar anchor names a page file, not a bare stored link', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);
    await expandSome(page);

    const hrefs = await sidebarHrefs(page, 20);
    const bare = hrefs.filter((href) => !PAGE_FILE.test(href));
    expect(bare).toEqual([]);
    // The links still point at the generated pages, with the base applied.
    expect(hrefs).toContain(TOPIC_PAGE);
  });

  test('a sidebar link opened in a fresh tab never shows the 404 title', async ({ page, context }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    // Take a leaf the sidebar rendered for the current section other than the
    // page itself, so the fresh tab is a real cross-page open.
    const href = (await sidebarHrefs(page, 2)).find((h) => h !== TOPIC_PAGE) ?? TOPIC_PAGE;
    const { status, titles } = await titlesWhileLoading(context, href);

    // Every title seen while loading, so a failure names the bad one.
    expect(titles.filter((t) => /^404\b/.test(t))).toEqual([]);
    expect(status).toBe(200);
  });

  test('a starred page links to its file', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await page.locator('.favorite-star-button').click();
    const link = page.locator('.favorites-section .favorites-link');
    await expect(link).toHaveAttribute('href', TOPIC_PAGE);
  });

  test('the version badge links to the versions page file', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.VPNavBar .version-badge')).toHaveAttribute('href', /\/versions\.html$/);
  });

  test('the 404 page links only to files or directories', async ({ page }) => {
    await page.goto('/this/page/does/not/exist.html');
    const hrefs = await page.locator('.not-found-link').evaluateAll((anchors) =>
      anchors.map((a) => a.getAttribute('href') ?? ''),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((href) => !PAGE_FILE.test(href))).toEqual([]);
  });

  test('the e2e server answers an extensionless page path with 404, like the host', async ({ request }) => {
    const response = await request.get(TOPIC_PAGE.replace(/\.html$/, ''));
    expect(response.status()).toBe(404);
  });
});
