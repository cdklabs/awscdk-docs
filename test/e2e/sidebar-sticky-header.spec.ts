import { expect, test, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// The sidebar header block — symbol filter, jump-to-current, favorites —
// must stay reachable no matter how far the API tree is scrolled. All of it
// lives in ONE scroll container (`aside.VPSidebar` is the scroller;
// `nav.nav` inside it adds no overflow), so without the sticky rule the
// block scrolls away with the tree.
//
// The assertion is deliberately a COMPARISON rather than a fixed number: the
// filter's y after scrolling the tree to the bottom must equal its y when
// the tree is at the top. A hard-coded y would pass for the wrong reason if
// the sidebar's padding or the nav height ever changed, and it would also
// pass on a block that had merely been repositioned rather than pinned.
test.describe('sidebar header stays put while the tree scrolls', () => {
  // Returns the filter's y at the top of the sidebar's scroll range and at
  // the bottom, plus how far it actually scrolled. The scroll distance is
  // returned so the test can prove the scroll HAPPENED — without that guard
  // a sidebar that failed to scroll at all would satisfy the comparison
  // trivially, which is the shape of a test that looks like coverage and
  // asserts nothing.
  async function filterYAtTopAndBottom(page: Page) {
    const measure = () =>
      page.evaluate(() => {
        const aside = document.querySelector('aside.VPSidebar') as HTMLElement;
        const filter = document.querySelector('.nav-filter') as HTMLElement;
        return {
          filterY: filter.getBoundingClientRect().top,
          scrollTop: aside.scrollTop,
          scrollRange: aside.scrollHeight - aside.clientHeight,
        };
      });
    const scrollTo = (position: 'top' | 'bottom') =>
      page.evaluate((p) => {
        const aside = document.querySelector('aside.VPSidebar') as HTMLElement;
        aside.scrollTop = p === 'top' ? 0 : aside.scrollHeight;
      }, position);

    await scrollTo('top');
    await page.waitForTimeout(100);
    const top = await measure();
    await scrollTo('bottom');
    await page.waitForTimeout(100);
    const bottom = await measure();
    return { top, bottom };
  }

  test('the desktop scrollport starts below the navbar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.nav-filter-input')).toBeVisible();

    const geometry = await page.evaluate(() => {
      const aside = document.querySelector('aside.VPSidebar')!.getBoundingClientRect();
      const navbar = document.querySelector('.VPNavBar')!.getBoundingClientRect();
      const header = document.querySelector('.sidebar-header')!.getBoundingClientRect();
      return { asideTop: aside.top, navbarBottom: navbar.bottom, headerTop: header.top };
    });

    expect(geometry.asideTop).toBeGreaterThanOrEqual(geometry.navbarBottom - 1);
    expect(Math.abs(geometry.headerTop - geometry.navbarBottom)).toBeLessThanOrEqual(1);
  });

  test('the desktop rail keeps the filter, jump-to-current and favorites in view', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.nav-filter-input')).toBeVisible();

    const { top, bottom } = await filterYAtTopAndBottom(page);
    // The tree really is long enough to scroll, and really did scroll.
    expect(bottom.scrollRange).toBeGreaterThan(500);
    expect(bottom.scrollTop).toBeGreaterThan(500);
    // …and the filter did not move while it happened.
    expect(Math.abs(bottom.filterY - top.filterY)).toBeLessThanOrEqual(1);
    // All three controls stay on screen, not just the filter: the issue is
    // about reaching a favorite or the jump control as much as searching.
    await expect(page.locator('.nav-filter-input')).toBeInViewport();
    await expect(page.locator('button.sidebar-jump-current')).toBeInViewport();
  });

  test('the mobile drawer keeps it in view too', async ({ page }) => {
    // Below 960px the sidebar is a drawer opened from the local nav's Menu
    // button (NOT the navbar hamburger, which opens the site nav screen).
    // The drawer's aside carries a different padding-top from the desktop
    // rail, so this is measured rather than assumed to follow.
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto(TOPIC_PAGE);
    await page.locator('.VPLocalNav button.menu').click();
    await expect(page.locator('aside.VPSidebar')).toHaveClass(/open/);
    await expect(page.locator('.nav-filter-input')).toBeVisible();

    const { top, bottom } = await filterYAtTopAndBottom(page);
    expect(bottom.scrollRange).toBeGreaterThan(500);
    expect(bottom.scrollTop).toBeGreaterThan(500);
    expect(Math.abs(bottom.filterY - top.filterY)).toBeLessThanOrEqual(1);
    await expect(page.locator('.nav-filter-input')).toBeInViewport();

    // Nothing from the tree may show in the strip above the pinned block. The
    // drawer has no `.curtain` (VitePress scopes it to >=960px), so rows would
    // otherwise scroll visibly through the aside's top padding. Hit-test the
    // strip rather than eyeballing a screenshot: a measured y is invariant
    // here whether or not the strip is masked, so it cannot catch this.
    const painted = await page.evaluate(() => {
      const header = document.querySelector('.sidebar-header')!.getBoundingClientRect();
      // Probe at the horizontal center of a real tree row: the aside has 32px
      // of left padding, so an x inside that column never paints a row and
      // would make this assertion vacuous.
      const row = document.querySelector('.api-sidebar-nav a, .api-sidebar-nav button')!;
      const x = row.getBoundingClientRect().left + row.getBoundingClientRect().width / 2;
      const ys = [2, header.top / 2, Math.max(0, header.top - 2)];
      return ys.map((y) => {
        const el = document.elementFromPoint(x, y);
        return el ? `${el.tagName}.${el.className?.toString().split(' ')[0] ?? ''}` : 'none';
      });
    });
    for (const hit of painted) {
      expect(hit).not.toMatch(/api-sidebar/);
    }
  });

  // Run at both breakpoints: the desktop rail is covered by VitePress's own
  // `.curtain`, so a spec that only ran at 1280 was testing exactly the width
  // where the stock theme already did the work.
  for (const variant of [
    { label: 'desktop rail', width: 1280, openDrawer: false },
    { label: 'mobile drawer', width: 600, openDrawer: true },
  ]) {
    test(`the pinned block is opaque on the ${variant.label}`, async ({ page }) => {
      await page.setViewportSize({ width: variant.width, height: 800 });
      await page.goto(TOPIC_PAGE);
      if (variant.openDrawer) {
        await page.locator('.VPLocalNav button.menu').click();
        await expect(page.locator('aside.VPSidebar')).toHaveClass(/open/);
      }
      const header = page.locator('.VPSidebar .sidebar-header');
      await expect(header).toBeVisible();
      const paint = await header.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { background: cs.backgroundColor, position: cs.position };
      });
      expect(paint.position).toBe('sticky');
      // Read the resolved color out of the page rather than pinning a literal:
      // it comes from the sidebar's own theme token and differs per theme. What
      // must hold is that it is not transparent — a sticky block with no
      // background lets rows scroll visibly underneath it.
      expect(paint.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(paint.background).not.toBe('transparent');
      const asideBackground = await page
        .locator('aside.VPSidebar')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      // And it matches the sidebar, so the pinned block reads as part of it.
      expect(paint.background).toBe(asideBackground);
    });
  }
});
