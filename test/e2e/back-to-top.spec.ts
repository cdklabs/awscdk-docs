import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE, TOPIC_PAGE } from './fixture.js';

// Floating "back to top" control: returns the reader to the
// top of the document with a duration-pinned ~300ms animation, driving
// the WINDOW scroller only — the sidebar's position and per-route memory
// stay untouched (the mirror of sidebar-jump.spec.ts's assertion that a
// jump leaves window.scrollY alone).
test.describe('floating back-to-top control', () => {
  const control = (page: Page) => page.getByRole('button', { name: 'Back to top' });

  async function scrollWindowTo(page: Page, y: number) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
  }

  test('hidden at the top, appears after a meaningful scroll', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(control(page)).toBeHidden();

    // Past a viewport: visible.
    await page.evaluate(() => window.scrollTo(0, window.innerHeight + 200));
    await expect(control(page)).toBeVisible();

    // Back UNDER a viewport but not to the top: hidden again — no chrome
    // on a small scroll. Asserted as a TRANSITION from visible, not as a
    // resting state: asserting hidden before ever becoming visible is
    // satisfied by the initial state (and by a stale pre-rAF frame), so a
    // threshold lowered all the way to zero still passed it. This
    // direction fails deterministically for a too-low threshold — the
    // control stays visible and the assertion times out.
    await scrollWindowTo(page, 200);
    await expect(control(page)).toBeHidden();
  });

  test('returns to the top in ~300ms, animated rather than a jump-cut', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(control(page)).toBeVisible();

    const result = await page.evaluate(async () => {
      const start = window.scrollY;
      (document.querySelector('button.back-to-top') as HTMLElement).click();
      const t0 = performance.now();
      let sawIntermediate = false;
      let lastChange = t0;
      let lastY = window.scrollY;
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          const y = window.scrollY;
          if (y !== lastY) {
            lastY = y;
            lastChange = now;
          }
          if (y > 0 && y < start) sawIntermediate = true;
          if ((y === 0 && now - lastChange > 250) || now - t0 > 3000) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { start, end: window.scrollY, settleMs: lastChange - t0, sawIntermediate };
    });

    expect(result.start).toBeGreaterThan(0);
    expect(result.end).toBe(0);
    // Animated: intermediate positions were observed, not a single jump-cut…
    expect(result.sawIntermediate).toBe(true);
    // …and the whole movement settled within the ~300ms budget plus slack.
    expect(result.settleMs).toBeLessThanOrEqual(600);
  });

  test('honors prefers-reduced-motion by moving without animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(TOPIC_PAGE);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(control(page)).toBeVisible();

    // Immediate set: the click handler moves synchronously under reduced
    // motion, so the position is 0 in the SAME evaluate as the click — the
    // animated path cannot satisfy this, which is what makes the test able
    // to tell the two apart (a poll with a timeout could not).
    const yAfterClick = await page.evaluate(() => {
      (document.querySelector('button.back-to-top') as HTMLElement).click();
      return window.scrollY;
    });
    expect(yAfterClick).toBe(0);
  });

  test('activation hands focus to the top of the document', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(control(page)).toBeVisible();

    // Once the page reaches the top the control hides itself; without a
    // deliberate focus handoff, display:none on the still-focused button
    // throws focus to <body> with no announcement.
    await control(page).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(control(page)).toBeHidden();
    const active = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? '',
    }));
    expect(active.tag).toBe('H1');
  });

  test('drives the window only: the sidebar keeps its own scroll position', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();

    // The deep-link load reveals the active entry with its own animation;
    // wait for the scroller to go quiet before parking it, or the reveal
    // overwrites the parked position mid-test.
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

    // Park the sidebar's inner scroller somewhere deliberate, scroll the
    // window down, return to top — the sidebar must not have moved.
    const sidebarBefore = await page.evaluate(() => {
      const c = document.querySelector('aside.VPSidebar')!;
      c.scrollTop = 400;
      return c.scrollTop;
    });
    expect(sidebarBefore).toBeGreaterThan(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(control(page)).toBeVisible();
    await control(page).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    expect(await page.evaluate(() => document.querySelector('aside.VPSidebar')!.scrollTop))
      .toBe(sidebarBefore);
  });

  test('meets the touch-target floor on small screens and the theme focus ring', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(TOPIC_PAGE);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(control(page)).toBeVisible();

    const box = await control(page).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // The theme's focus ring, computed on real keyboard focus.
    await control(page).focus();
    const outline = await control(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { width: cs.outlineWidth, offset: cs.outlineOffset };
    });
    expect(outline.width).toBe('2px');
    expect(outline.offset).toBe('-2px');
  });
});
