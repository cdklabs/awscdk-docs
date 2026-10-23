import { expect, test } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// The "On this page" outline lives in the default theme's `.aside-container`, which is
// `position: fixed; height: 100vh` — so its lower edge sits at the viewport bottom. This
// site renders a `SiteFooter` on every page (the default theme hides it on doc pages), so
// without a bound the fixed aside paints over the footer once the reader scrolls to the end.
// ApiDocAsideOutline.vue caps the aside container's height at the footer's top edge while the
// footer is on screen, and leaves it unbounded otherwise.
test.describe('aside outline does not overlap the footer', () => {
  // The aside outline only shows on a wide viewport.
  test.use({ viewport: { width: 1440, height: 900 } });

  const asideContainer = (page: import('@playwright/test').Page) => page.locator('.aside-container');
  const curtain = (page: import('@playwright/test').Page) => page.locator('.aside-curtain');
  const footer = (page: import('@playwright/test').Page) => page.locator('footer.site-footer');

  test('scrolled to the bottom of a tall type page, the outline stops above the footer', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    // QUEUE_PAGE is a tall type page whose outline is long enough to reach the footer region.
    await expect(asideContainer(page)).toBeVisible();

    // Scroll to the very bottom so the footer is in view — the overlap condition.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // Let the scroll-bound routine run (throttled at 100ms) and layout settle.
    await page.waitForTimeout(300);

    const asideBox = await asideContainer(page).boundingBox();
    const footerBox = await footer(page).boundingBox();
    expect(asideBox).not.toBeNull();
    expect(footerBox).not.toBeNull();

    // The visible outline container's lower edge must not cross into the footer.
    // Allow a 1px rounding tolerance.
    expect(asideBox!.y + asideBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);

    // The sibling fade curtain is bounded too, so its band does not paint over the footer.
    const curtainBox = await curtain(page).boundingBox();
    expect(curtainBox).not.toBeNull();
    expect(curtainBox!.y + curtainBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
  });

  test('scrolling back up from the footer clears the cap', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await expect(asideContainer(page)).toBeVisible();

    // Scroll to the bottom so the footer is on screen and the cap is applied.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const cappedHeight = await asideContainer(page).evaluate((el) => el.style.maxHeight);
    // Precondition: the fix actually capped the container (a non-empty px value).
    expect(cappedHeight).toMatch(/^\d+(\.\d+)?px$/);

    // Scroll back to the top: the footer leaves the viewport, so the else branch
    // must clear the cap. This fails if the clear-the-cap branch never runs.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const clearedHeight = await asideContainer(page).evaluate((el) => el.style.maxHeight);
    expect(clearedHeight).toBe('');
  });
});
