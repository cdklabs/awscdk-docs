import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';

// Sidebar module hierarchy with client-side routing. The lazy API sidebar
// already renders the Service -> Resource -> Kind tree; these specs prove
// the interactive contract on the BUILT, hydrated site: SPA navigation from
// sidebar links, active-entry highlighting with ancestor auto-expand, and
// sidebar scroll preservation across navigation / back / reload.
test.describe('sidebar hierarchy and scroll preservation', () => {
  // Budget for the polls waiting on a position the COMPONENT restores, which
  // race the whole suite for one static server. Matches search.spec.ts and
  // type-tooltips.spec.ts, and stays inside the 30s per-test timeout.
  const RESTORE_TIMEOUT = 15_000;

  async function waitForSidebar(page: Page) {
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  const sidebarScrollTop = (page: Page) =>
    page.evaluate(() => document.querySelector('aside.VPSidebar')!.scrollTop);

  async function setSidebarScrollTop(page: Page, top: number) {
    await page.evaluate((t) => {
      document.querySelector('aside.VPSidebar')!.scrollTop = t;
    }, top);
  }

  // The initial load smooth-scrolls the active entry into view; wait for it
  // to be inside the container box AND for the animation to settle before a
  // test repositions the scroller (a still-running smooth scroll would
  // override a programmatic scrollTop write).
  async function waitForActiveInView(page: Page) {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const c = document.querySelector('aside.VPSidebar')!.getBoundingClientRect();
          const l = document
            .querySelector('.api-sidebar a.api-sidebar-link.active')
            ?.getBoundingClientRect();
          return !!l && l.top >= c.top && l.bottom <= c.bottom;
        }),
      )
      .toBe(true);
    await expect
      .poll(async () => {
        const a = await sidebarScrollTop(page);
        await page.waitForTimeout(150);
        const b = await sidebarScrollTop(page);
        return b - a;
      })
      .toBe(0);
  }

  test('active page is highlighted and its ancestors auto-expand', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);

    // The active leaf carries the highlight class and aria-current, and is
    // VISIBLE — proving the SQS -> Queue ancestors expanded (the construct
    // types sit flat inside their resource).
    const active = page.locator('.api-sidebar a.api-sidebar-link.active');
    await expect(active).toHaveCount(1);
    await expect(active).toBeVisible();
    // The NAME, not the whole link: an L2 construct's link also carries the
    // level tag beside the name.
    await expect(active.locator('.api-sidebar-name')).toHaveText('Queue');
    await expect(active).toHaveAttribute('aria-current', 'page');
  });

  test('sidebar links navigate client-side and move the highlight', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    // Marker to detect a full page reload: any hard navigation wipes it.
    await page.evaluate(() => {
      (window as any).__e2eNoReload = true;
    });

    // Walk the hierarchy to the SQS Queue leaf: section -> resource ->
    // leaf link (construct types sit flat inside their resource). Each step
    // is scoped to the parent's subtree (the SNS branch
    // is auto-expanded and an unscoped locator would hit it instead).
    const sqs = page
      .locator('.api-sidebar li.api-sidebar-item')
      .filter({ has: page.getByRole('button', { name: 'SQS', exact: true }) })
      .first();
    await sqs.getByRole('button', { name: 'SQS', exact: true }).first().click();
    const queue = sqs
      .locator('li.api-sidebar-item')
      .filter({ has: page.getByRole('button', { name: 'Queue', exact: true }) })
      .first();
    await queue.getByRole('button', { name: 'Queue', exact: true }).first().click();
    await queue
      .locator('a.api-sidebar-link')
      // Filter on the NAME, not the link's whole text: an L2 construct's
      // link also contains its level tag, so an anchored /^Queue$/ against
      // the link would not match.
      .filter({ has: page.locator('.api-sidebar-name', { hasText: /^Queue$/ }) })
      .first()
      .click();

    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sqs\.Queue/);
    await expect(page.locator('h1').first()).toContainText('Queue');

    // Client-side routing: the marker survived, so no full reload happened.
    expect(await page.evaluate(() => (window as any).__e2eNoReload)).toBe(true);

    // The highlight moved to the new page's entry.
    const active = page.locator('.api-sidebar a.api-sidebar-link.active');
    await expect(active.locator('.api-sidebar-name')).toHaveText('Queue');
  });

  test('sidebar scroll survives navigation and back restores it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await waitForActiveInView(page);

    // The auto-expanded SQS -> Queue chain sits ~15k content
    // pixels down the (full, ~350-section) tree; scroll so the ACTIVE
    // link's non-active sibling leaf (CfnQueue, flat in the same expanded
    // resource — the full tree has other, hidden CfnQueue entries) is
    // mid-viewport, then navigate by clicking it with a trusted mouse click
    // at its coordinates (locator.click would auto-scroll the sidebar to
    // its target, destroying the position under test).
    const setup = await page.evaluate(() => {
      const container = document.querySelector('aside.VPSidebar')!;
      const active = document.querySelector('.api-sidebar a.api-sidebar-link.active')!;
      const link = [...active.closest('ul')!.querySelectorAll('a.api-sidebar-link')].find(
        // Match on the NAME element: a construct link's own textContent now
        // also contains its level tag.
        (l) =>
          l !== active
          && l.querySelector('.api-sidebar-name')?.textContent?.trim() === 'CfnQueue',
      )!;
      const offset =
        link.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      const top = Math.round(offset - container.clientHeight / 2);
      container.scrollTop = top;
      return { top, href: link.getAttribute('href')! };
    });
    expect(setup.top).toBeGreaterThan(0);
    await expect.poll(() => sidebarScrollTop(page)).toBe(setup.top);

    const point = await page.evaluate(() => {
      const active = document.querySelector('.api-sidebar a.api-sidebar-link.active')!;
      const r = [...active.closest('ul')!.querySelectorAll('a.api-sidebar-link')]
        .find(
          (l) =>
            l !== active
            && l.querySelector('.api-sidebar-name')?.textContent?.trim() === 'CfnQueue',
        )!
        .getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page).toHaveURL(/aws_sqs\.CfnQueue/);
    // The URL changes on `pushState`, but the sidebar keys its scroll memory on
    // `route.path`, which lags it. Wait for the moved highlight — same
    // `activePath` — so the reposition below is not filed against the old page.
    await expect(
      page.locator('.api-sidebar a.api-sidebar-link.active .api-sidebar-name'),
    ).toHaveText('CfnQueue', { timeout: RESTORE_TIMEOUT });

    // Preservation: forward navigation left the sidebar exactly where it was.
    await expect.poll(() => sidebarScrollTop(page), { timeout: RESTORE_TIMEOUT }).toBe(setup.top);

    // Scroll elsewhere on the new page, then go back: the remembered
    // position for the previous page is restored.
    await setSidebarScrollTop(page, 0);
    await expect.poll(() => sidebarScrollTop(page)).toBe(0);
    await page.goBack();
    await expect(page).toHaveURL(/aws_sqs\.Queue\.html/);
    await expect.poll(() => sidebarScrollTop(page), { timeout: RESTORE_TIMEOUT }).toBe(setup.top);
  });

  test('reload restores the remembered sidebar scroll position', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await waitForActiveInView(page);

    await setSidebarScrollTop(page, 130);
    await expect.poll(() => sidebarScrollTop(page)).toBe(130);
    // The rAF-throttled save must land in sessionStorage before reloading.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = window.sessionStorage.getItem('cdk-docs-sidebar-scroll');
          const entries: [string, number][] = raw ? JSON.parse(raw) : [];
          return entries.find(([path]) => path.endsWith('aws_sqs.Queue'))?.[1];
        }),
      )
      .toBe(130);

    await page.reload();
    await waitForSidebar(page);
    await expect.poll(() => sidebarScrollTop(page), { timeout: RESTORE_TIMEOUT }).toBe(130);
  });

  test('a deep link scrolls its sidebar entry into view on initial load', async ({ page }) => {
    // No remembered position (fresh context) and a short viewport: the
    // active entry sits ~15k content pixels down the full tree, so it can
    // only be inside the sidebar's visible box if the load scrolled to it.
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);

    const active = page.locator('.api-sidebar a.api-sidebar-link.active');
    await expect(active).toBeVisible();
    await waitForActiveInView(page);
    expect(await sidebarScrollTop(page)).toBeGreaterThan(0);
  });
});
