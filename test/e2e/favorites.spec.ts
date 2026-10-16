import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE, SQS_OVERVIEW_PAGE, TOPIC_PAGE } from './fixture.js';

// Favorite pages: the doc-before star toggles a localStorage
// entry; starred pages appear in the sidebar's Favorites quick-access
// section and survive a full reload.
test.describe('favorite pages', () => {
  test('starring a page persists across reloads and lists it in the sidebar', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    const star = page.locator('.favorite-star-button');
    await expect(star).toBeVisible();
    // The star teleports into the breadcrumb header bar.
    await expect(page.locator('.type-breadcrumb .favorite-star-button')).toBeVisible();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.favorites-section')).toHaveCount(0);

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    // Icon-only control: the label lives in the hover text.
    await expect(star).toHaveAttribute('title', 'Remove from favorites');

    const section = page.locator('.favorites-section');
    await expect(section).toBeVisible();
    await expect(section.locator('.favorites-link')).toContainText('Topic');

    // localStorage persistence: still starred after a full reload.
    await page.reload();
    await expect(page.locator('.favorite-star-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.favorites-section .favorites-link')).toContainText('Topic');

    // The favorite follows to other API pages via the sidebar section.
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('.favorites-section .favorites-link')).toContainText('Topic');
  });

  test('the star uses a larger glyph without crowding either placement', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(TOPIC_PAGE);

    const inBarButton = page.locator('.type-breadcrumb .favorite-star-button');
    const inBarIcon = inBarButton.locator('.favorite-star-icon');
    await expect(inBarIcon).toHaveCSS('font-size', '20px');
    await expect(inBarIcon).toHaveText('☆');

    const trailBox = await page.locator('.breadcrumb-trail').boundingBox();
    const buttonBox = await inBarButton.boundingBox();
    expect(trailBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(trailBox!.x + trailBox!.width);

    await inBarButton.click();
    await expect(inBarIcon).toHaveText('★');
    await expect(inBarIcon).toHaveCSS('font-size', '20px');

    await page.goto('/v2/');
    const standaloneButton = page.locator('.favorite-star.standalone .favorite-star-button');
    const standaloneIcon = standaloneButton.locator('.favorite-star-icon');
    await expect(standaloneIcon).toBeVisible();
    await expect(standaloneIcon).toHaveCSS('font-size', '20px');
    await expect(standaloneIcon).toHaveText('☆');

    await standaloneButton.click();
    await expect(standaloneIcon).toHaveText('★');
    await expect(standaloneIcon).toHaveCSS('font-size', '20px');
  });

  // Measured rather than declared: font-size alone does not determine the
  // rendered glyph, so these read the box, the resolved family and the ink.
  const starMetrics = (page: Page) =>
    page.evaluate(() => {
      const button = document.querySelector(
        '.favorite-star-button',
      ) as HTMLElement;
      const icon = button.querySelector('.favorite-star-icon') as HTMLElement;
      const style = getComputedStyle(icon);
      const context = document
        .createElement('canvas')
        .getContext('2d') as CanvasRenderingContext2D;
      context.font = `${style.fontSize} ${style.fontFamily}`;
      const glyph = context.measureText((icon.textContent ?? '').trim());
      const lineBox = icon.getBoundingClientRect().height;
      const baseline =
        (lineBox -
          (glyph.fontBoundingBoxAscent + glyph.fontBoundingBoxDescent)) /
          2 +
        glyph.fontBoundingBoxAscent;
      const inkCenter =
        baseline + (glyph.actualBoundingBoxDescent - glyph.actualBoundingBoxAscent) / 2;
      const buttonBox = button.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      return {
        width: buttonBox.width,
        height: buttonBox.height,
        fontFamily: style.fontFamily,
        inkHeight:
          glyph.actualBoundingBoxAscent + glyph.actualBoundingBoxDescent,
        inkOffset:
          iconBox.y - buttonBox.y + inkCenter - buttonBox.height / 2,
      };
    });

  test('the star renders at one size in both placements', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(TOPIC_PAGE);
    const inBar = await starMetrics(page);

    await page.goto('/v2/');
    const standalone = await starMetrics(page);

    expect(inBar.fontFamily).toBe(standalone.fontFamily);
    expect(inBar.inkHeight).toBeCloseTo(standalone.inkHeight, 1);
    expect(inBar.width).toBeCloseTo(standalone.width, 1);
    expect(inBar.height).toBeCloseTo(standalone.height, 1);

    for (const metrics of [inBar, standalone]) {
      expect(metrics.width).toBeGreaterThanOrEqual(24);
      expect(metrics.height).toBeGreaterThanOrEqual(24);
      expect(metrics.width).toBeCloseTo(metrics.height, 1);
      expect(Math.abs(metrics.inkOffset)).toBeLessThanOrEqual(0.5);
    }
  });

  test('the star keeps a 44px target on a narrow viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(TOPIC_PAGE);

    const metrics = await starMetrics(page);
    expect(metrics.width).toBeGreaterThanOrEqual(44);
    expect(metrics.height).toBeGreaterThanOrEqual(44);
  });

  test('the star does not add height to the breadcrumb bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(TOPIC_PAGE);

    const measured = await page.evaluate(() => {
      const bar = document.querySelector('.type-breadcrumb') as HTMLElement;
      const button = document.querySelector(
        '.favorite-star-button',
      ) as HTMLElement;
      const style = getComputedStyle(bar);
      return {
        bar: bar.getBoundingClientRect().height,
        button: button.getBoundingClientRect().height,
        padding:
          parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      };
    });

    // The tallest thing in the bar is the control, so the bar is its height
    // plus the bar's own padding — no line box taller than the control.
    expect(measured.bar).toBeLessThanOrEqual(
      measured.button + measured.padding + 0.5,
    );
  });

  // Collapsible favorites section: collapsed by default so it
  // stops pushing the primary nav tree down, with the choice persisted.
  test('the favorites section is collapsed by default and the choice survives a reload', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await page.locator('.favorite-star-button').click();

    const toggle = page.locator('.favorites-toggle');
    const list = page.locator('#favorites-list');
    await expect(toggle).toBeVisible();
    // Collapsed on a first visit — the entries are in the DOM but hidden,
    // and the count is on the header so the feature stays discoverable.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toBeHidden();
    await expect(toggle).toContainText('(1)');

    // Keyboard-operable: the header is in the tab order and Enter toggles.
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(list).toBeVisible();
    await expect(list.locator('.favorites-link')).toContainText('Topic');

    // Expanded choice persists across a full reload…
    await page.reload();
    await expect(page.locator('.favorites-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#favorites-list')).toBeVisible();

    // …and across a route change to another API page.
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('.favorites-toggle')).toHaveAttribute('aria-expanded', 'true');

    // Collapsing again persists too, so the default is not sticky.
    await page.locator('.favorites-toggle').click();
    await page.reload();
    await expect(page.locator('.favorites-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#favorites-list')).toBeHidden();
  });

  test('unstarring removes the page from the favorites section', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    const star = page.locator('.favorite-star-button');
    await star.click();
    await expect(page.locator('.favorites-section')).toBeVisible();

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.favorites-section')).toHaveCount(0);
  });

  // Submodule overview pages carry the docgen breadcrumb bar too, so the
  // star must teleport into it there — not fall back to the standalone
  // doc-before placement — and still toggle correctly.
  test('the star teleports into the breadcrumb bar on a submodule overview page and toggles', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    // The overview page emits the shared breadcrumb bar with its
    // `breadcrumb-fav` mount point, and the star lands inside it.
    await expect(page.locator('.vp-doc .type-breadcrumb .breadcrumb-fav')).toHaveCount(1);
    const star = page.locator('.type-breadcrumb .favorite-star-button');
    await expect(star).toBeVisible();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    // Exactly one star on the page: teleported, not duplicated by the
    // doc-before fallback.
    await expect(page.locator('.favorite-star-button')).toHaveCount(1);

    // Starring from the breadcrumb bar works and persists.
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.favorites-section .favorites-link')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('.type-breadcrumb .favorite-star-button')).toHaveAttribute('aria-pressed', 'true');

    // Unstarring from the same placement clears it.
    await page.locator('.type-breadcrumb .favorite-star-button').click();
    await expect(page.locator('.type-breadcrumb .favorite-star-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.favorites-section')).toHaveCount(0);
  });
});
