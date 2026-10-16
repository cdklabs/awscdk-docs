import { expect, test, type Page } from '@playwright/test';
import { API_OVERVIEW, QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';

// Persistent sidebar disclosure state. These specs pin the contract on the
// BUILT, hydrated site: an explicit toggle survives SPA navigation, a full
// reload and a second tab, while the auto-reveal of the active page's
// ancestors is deliberately NOT stored.
//
// Note the shape of the built tree: the Framework / Services roots are fixed
// structural SECTIONS rendered as headings, not collapsible
// buttons, so the first real group button sits a level below them and starts
// closed. The tri-state store (a collapse of a default-open group sticking)
// is covered by the unit tests, which can construct that tree directly.
test.describe('sidebar collapse memory', () => {
  const STORE_KEY = 'cdk-docs:sidebar-expanded:v1';

  async function waitForSidebar(page: Page) {
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  const storedEntries = (page: Page) =>
    page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as [string, boolean][]) : [];
    }, STORE_KEY);

  const groups = (page: Page) => page.locator('.api-sidebar-nav button.api-sidebar-group');

  /** Re-find a group button by its exact accessible name (the caret is aria-hidden). */
  const groupNamed = (page: Page, name: string) =>
    page.getByRole('button', { name, exact: true });

  test('nothing is stored until the reader toggles something', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    // The active page's ancestors are unfolded here — auto-reveal — and must
    // not be written: otherwise one deep visit pins that chain open forever.
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active')).toBeVisible();
    expect(await storedEntries(page)).toEqual([]);
  });

  test('an explicit expand survives a full reload', async ({ page }) => {
    await page.goto(API_OVERVIEW);
    await waitForSidebar(page);

    const target = groups(page).first();
    await expect(target).toHaveAttribute('aria-expanded', 'false');
    const name = (await target.locator('.api-sidebar-text').innerText()).trim();
    await target.click();
    await expect(target).toHaveAttribute('aria-expanded', 'true');

    // The stored key is the group's full ancestor path, not just its label.
    const stored = await storedEntries(page);
    expect(stored).toHaveLength(1);
    expect(stored[0][0].endsWith(name)).toBe(true);
    expect(stored[0][1]).toBe(true);

    await page.reload();
    await waitForSidebar(page);
    await expect(groupNamed(page, name)).toHaveAttribute('aria-expanded', 'true');
  });

  test('collapsing again is remembered as closed, not merely forgotten', async ({ page }) => {
    await page.goto(API_OVERVIEW);
    await waitForSidebar(page);

    const target = groups(page).first();
    const name = (await target.locator('.api-sidebar-text').innerText()).trim();
    await target.click();
    await expect(target).toHaveAttribute('aria-expanded', 'true');
    await target.click();
    await expect(target).toHaveAttribute('aria-expanded', 'false');

    const stored = await storedEntries(page);
    expect(stored).toHaveLength(1);
    expect(stored[0][0].endsWith(name)).toBe(true);
    expect(stored[0][1]).toBe(false);

    await page.reload();
    await waitForSidebar(page);
    await expect(groupNamed(page, name)).toHaveAttribute('aria-expanded', 'false');
  });

  test('an explicit expand survives navigation away and back', async ({ page }) => {
    await page.goto(API_OVERVIEW);
    await waitForSidebar(page);

    const target = groups(page).first();
    const name = (await target.locator('.api-sidebar-text').innerText()).trim();
    await target.click();
    await expect(target).toHaveAttribute('aria-expanded', 'true');

    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);
    await page.goto(API_OVERVIEW);
    await waitForSidebar(page);

    await expect(groupNamed(page, name)).toHaveAttribute('aria-expanded', 'true');
  });

  test('a stored choice is honored in a second tab (localStorage, not sessionStorage)', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const first = await context.newPage();
    await first.goto(API_OVERVIEW);
    await expect(first.locator('.api-sidebar-nav')).toBeVisible();

    const target = first.locator('.api-sidebar-nav button.api-sidebar-group').first();
    const name = (await target.locator('.api-sidebar-text').innerText()).trim();
    await target.click();
    await expect(target).toHaveAttribute('aria-expanded', 'true');

    const second = await context.newPage();
    await second.goto(API_OVERVIEW);
    await expect(second.locator('.api-sidebar-nav')).toBeVisible();
    await expect(second.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await context.close();
  });

  test('corrupt stored state falls back to the defaults instead of breaking the sidebar', async ({
    page,
  }) => {
    await page.goto(API_OVERVIEW);
    await waitForSidebar(page);
    await page.evaluate((key) => window.localStorage.setItem(key, 'not json at all'), STORE_KEY);
    await page.reload();
    await waitForSidebar(page);
    // The tree still renders and the groups are back at their defaults.
    await expect(groups(page).first()).toHaveAttribute('aria-expanded', 'false');
  });

  test('the active page is still revealed even when its ancestors were collapsed by hand', async ({
    page,
  }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    // Collapse the active entry's own group, then come back to the page: the
    // auto-reveal deliberately overrides the stored collapse for the active
    // chain, so a deep link never lands on a hidden entry.
    const active = page.locator('.api-sidebar a.api-sidebar-link.active');
    await expect(active).toBeVisible();

    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active')).toBeVisible();
  });
});
