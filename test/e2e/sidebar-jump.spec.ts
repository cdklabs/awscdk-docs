import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// "Locate current page": a fixed sidebar control that reveals or flashes the active entry.
test.describe('sidebar locate-current-page control', () => {
  async function waitForSidebar(page: Page) {
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  const jumpButton = (page: Page) =>
    page.getByRole('button', { name: 'Locate current page' });

  const activeLink = (page: Page) => page.locator('.api-sidebar a.api-sidebar-link.active');

  const activeInSidebarView = (page: Page) =>
    page.evaluate(() => {
      const container = document.querySelector('aside.VPSidebar');
      const link = document.querySelector<HTMLElement>('.api-sidebar a.api-sidebar-link.active');
      if (!container || !link) return false;
      // A collapsed entry is display:none, so its rect is zero-sized at the
      // origin — which would satisfy the containment test below whenever the
      // sidebar itself starts at y=0. Require a laid-out box first, so this
      // means "in view" and never "not rendered".
      if (!link.offsetParent) return false;
      const l = link.getBoundingClientRect();
      if (l.height === 0) return false;
      const c = container.getBoundingClientRect();
      // The pinned header block paints over the top of the
      // scroller, so the container's own box is NOT the visible region: a row
      // behind the header is contained by it while being invisible. Subtract
      // the block, or this helper reports "in view" for exactly the state the
      // jump control exists to escape — and every regression stays green.
      const header = document.querySelector('.sidebar-header');
      const visibleTop = header
        ? Math.max(c.top, header.getBoundingClientRect().bottom)
        : c.top;
      return l.top >= visibleTop && l.bottom <= c.bottom;
    });

  // The initial deep-link load smooth-scrolls the active entry into view;
  // wait for the animation to settle before the test repositions things.
  async function waitForRevealToSettle(page: Page) {
    await expect.poll(() => activeInSidebarView(page)).toBe(true);
    await expect
      .poll(async () => {
        const scrollTop = () =>
          page.evaluate(() => document.querySelector('aside.VPSidebar')!.scrollTop);
        const a = await scrollTop();
        await page.waitForTimeout(150);
        const b = await scrollTop();
        return b - a;
      })
      .toBe(0);
  }

  // Collapse the active entry's immediate ancestor group (as a user who
  // clicked the caret would) so the entry is hidden, and scroll the
  // sidebar back to the top so it is also far out of view.
  async function hideActiveEntry(page: Page) {
    await page.evaluate(() => {
      const active = document.querySelector('.api-sidebar a.api-sidebar-link.active')!;
      const group = active.closest('ul')!.closest('li')!;
      (group.querySelector(':scope > button.api-sidebar-group') as HTMLElement).click();
    });
    await expect(activeLink(page)).toBeHidden();
    await page.evaluate(() => {
      document.querySelector('aside.VPSidebar')!.scrollTop = 0;
    });
  }

  test('renders in the sidebar directly under the filter box', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    // The deep-link reveal smooth-scrolls the sidebar, so wait for it to stop
    // before measuring: separate boundingBox() round-trips taken mid-scroll
    // read different scroll offsets and the comparison becomes meaningless.
    await waitForRevealToSettle(page);

    await expect(jumpButton(page)).toBeVisible();

    // Measure at the top of the sidebar's scroll range. The header block
    // (filter, this button, favorites) is sticky, so it stays
    // pinned while the tree scrolls under it — and the deep-link reveal above
    // leaves the sidebar deep in the tree. Comparing a pinned element against
    // a scrolled-away tree in VIEWPORT coordinates would say the button is
    // below the tree, which is a fact about the scroll offset rather than
    // about where the control is placed. At scroll 0 the two coordinate
    // systems agree, so this still asserts real rendered geometry.
    await page.evaluate(() => {
      document.querySelector('aside.VPSidebar')!.scrollTop = 0;
    });
    await page.waitForTimeout(100);

    // One evaluate, so all three rects come from the same layout instant.
    const layout = await page.evaluate(() => {
      const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      return {
        filterBottom: rect('.nav-filter-box').bottom,
        buttonTop: rect('button.sidebar-jump-current').top,
        treeTop: rect('.api-sidebar-nav').top,
      };
    });

    // Placed under the search/filter box: inside the sidebar, below the
    // filter input's box and above the API tree.
    expect(layout.buttonTop).toBeGreaterThanOrEqual(layout.filterBottom - 1);
    expect(layout.buttonTop).toBeLessThanOrEqual(layout.treeTop + 1);
  });

  test('the control carries a 24px hit area without taking 24px of the row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);

    // The button's own box is the target a pointer has to hit; the row it
    // occupies is what the header's height is built from. They differ here by
    // the negative block margin, so both are measured.
    const measured = await page.evaluate(() => {
      const el = document.querySelector('button.sidebar-jump-current') as HTMLElement;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      return { width: box.width, height: box.height, footprint: box.height + margin };
    });

    expect(measured.height).toBeGreaterThanOrEqual(24);
    expect(measured.width).toBeGreaterThanOrEqual(24);
    expect(measured.footprint).toBeLessThanOrEqual(18);
  });

  test('jump un-occludes an entry parked behind the pinned header', async ({ page }) => {
    // The pinned block paints over the top of the scroller, so an
    // entry can be inside the container's box and still invisible. That state
    // is the one the jump control exists to escape, and a containment test
    // against the raw container box calls it "visible" — so this asserts on
    // what is actually PAINTED at the entry's center, not on a coordinate.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await waitForRevealToSettle(page);

    const occludeActive = () =>
      page.evaluate(() => {
        const aside = document.querySelector('aside.VPSidebar') as HTMLElement;
        const link = document.querySelector('.api-sidebar a.api-sidebar-link.active')!;
        const header = document.querySelector('.sidebar-header')!.getBoundingClientRect();
        // Scroll so the entry sits inside the header's band.
        const delta = link.getBoundingClientRect().top - (header.top + header.height / 2);
        aside.scrollTop += delta;
      });

    // Whether the pinned header block, or anything inside it, is what is painted at the entry's center. One
    // structural check for both the precondition and the post-jump assertion, so the two cannot disagree.
    const headerPaintedAtActive = () =>
      page.evaluate(() => {
        const link = document.querySelector('.api-sidebar a.api-sidebar-link.active')!;
        const r = link.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(el?.closest('.sidebar-header'));
      });

    await occludeActive();
    await page.waitForTimeout(150);
    // Precondition: the entry really is covered by the header block, so this
    // test cannot pass by never reaching the state it is about.
    expect(await headerPaintedAtActive()).toBe(true);

    await jumpButton(page).click();
    await expect.poll(() => activeInSidebarView(page)).toBe(true);
    // The entry itself (or its own text) is now the topmost thing at its
    // center: nothing from the header block is painted over it.
    expect(await headerPaintedAtActive()).toBe(false);
    await expect(activeLink(page)).toBeInViewport();
  });

  test('unfolds collapsed ancestors and scrolls the active entry into view', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await waitForRevealToSettle(page);
    await hideActiveEntry(page);
    expect(await activeInSidebarView(page)).toBe(false);

    const mainScrollBefore = await page.evaluate(() => window.scrollY);
    await jumpButton(page).click();

    // The collapsed ancestor group re-opened and the sidebar scrolled the
    // active entry into view; the main content did not scroll.
    await expect(activeLink(page)).toBeVisible();
    await expect.poll(() => activeInSidebarView(page)).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(mainScrollBefore);

    // Focus moved to the revealed entry so keyboard users land on it, and
    // the active treatment (aria-current) still identifies it.
    await expect(activeLink(page)).toBeFocused();
    await expect(activeLink(page)).toHaveAttribute('aria-current', 'page');
  });

  test('the reveal settles in ~300ms regardless of scroll distance', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await waitForRevealToSettle(page);
    await hideActiveEntry(page);

    // The sidebar sits at the very top of the FULL API index (the fixture
    // keeps the complete sidebar asset), so this is a long-distance jump —
    // exactly the case native `behavior: "smooth"` stretched far past the
    // budget, because the UA's animator scales duration with distance.
    // Record the scroller's position every frame and take the time of the
    // LAST movement as the settle time.
    const settleMs = await page.evaluate(async () => {
      const container = document.querySelector('aside.VPSidebar')!;
      (document.querySelector('button.sidebar-jump-current') as HTMLElement).click();
      const t0 = performance.now();
      let lastChange = t0;
      let lastTop = container.scrollTop;
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          if (container.scrollTop !== lastTop) {
            lastTop = container.scrollTop;
            lastChange = now;
          }
          // Done when quiet for 250ms (or a 3s hard stop, counted as-is).
          if (now - lastChange > 250 || now - t0 > 3000) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return lastChange - t0;
    });

    // It moved (the unfold + reveal really happened) …
    expect(settleMs).toBeGreaterThan(0);
    await expect.poll(() => activeInSidebarView(page)).toBe(true);
    // … and settled within the ~300ms budget plus rendering slack. The
    // pre-fix native smooth scroll measured well above this bound on the
    // same jump (fails-first evidence in the PR).
    expect(settleMs).toBeLessThanOrEqual(600);
  });

  test('flashes an already-visible entry without scrolling the sidebar', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await waitForRevealToSettle(page);

    await page.evaluate(() => {
      const aside = document.querySelector('aside.VPSidebar')!;
      const active = document.querySelector('.api-sidebar a.api-sidebar-link.active')!;
      const header = document.querySelector('.sidebar-header')!.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      const target = header.bottom + (aside.getBoundingClientRect().bottom - header.bottom) / 2;
      aside.scrollTop += box.top + box.height / 2 - target;
    });
    await expect.poll(() => activeInSidebarView(page)).toBe(true);
    const before = await page.evaluate(() => document.querySelector('aside.VPSidebar')!.scrollTop);
    await jumpButton(page).evaluate((button) => (button as HTMLButtonElement).click());
    await expect(activeLink(page)).toHaveClass(/locate-flash/);
    const animation = await activeLink(page).evaluate((element) => getComputedStyle(element).animationName);
    expect(animation).toBe('locate-current');
    expect(await page.evaluate(() => document.querySelector('aside.VPSidebar')!.scrollTop)).toBe(before);
  });

  test('uses a static locate cue when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(QUEUE_PAGE);
    await waitForSidebar(page);
    await waitForRevealToSettle(page);
    await jumpButton(page).evaluate((button) => (button as HTMLButtonElement).click());
    await expect(activeLink(page)).toHaveClass(/locate-flash/);
    const style = await activeLink(page).evaluate((element) => {
      const computed = getComputedStyle(element);
      return { animation: computed.animationName, outline: computed.outlineStyle };
    });
    expect(style).toEqual({ animation: 'none', outline: 'solid' });
  });

  test('does not render outside the API section', async ({ page }) => {
    await page.goto('/');
    await expect(jumpButton(page)).toHaveCount(0);
  });
});
