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
    // The star teleports into the chip row under the title.
    await expect(page.locator('.type-header-row .favorite-star-button')).toBeVisible();
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

    const inRowButton = page.locator('.type-header-row .favorite-star-button');
    const inRowIcon = inRowButton.locator('.favorite-star-icon');
    await expect(inRowIcon).toHaveCSS('font-size', '20px');
    await expect(inRowIcon).toHaveText('☆');

    // The star sits in the chip row, which is below the trail rather than at
    // its trailing edge.
    const trailBox = await page.locator('.breadcrumb-trail').boundingBox();
    const buttonBox = await inRowButton.boundingBox();
    expect(trailBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.y).toBeGreaterThanOrEqual(trailBox!.y + trailBox!.height);

    await inRowButton.click();
    await expect(inRowIcon).toHaveText('★');
    await expect(inRowIcon).toHaveCSS('font-size', '20px');

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

  test('the star renders the same glyph, square and centered, in every placement', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // The chip row styles the star as a pill, so its BOX is deliberately
    // larger there than in the compact placements. The glyph is not: one
    // typeface, one ink height, centered in whatever box it gets.
    await page.goto(TOPIC_PAGE);
    const inRow = await starMetrics(page);

    await page.goto(SQS_OVERVIEW_PAGE);
    const inBar = await starMetrics(page);

    await page.goto('/v2/');
    const standalone = await starMetrics(page);

    for (const metrics of [inRow, inBar]) {
      expect(metrics.fontFamily).toBe(standalone.fontFamily);
      expect(metrics.inkHeight).toBeCloseTo(standalone.inkHeight, 1);
    }
    // The two compact placements render at one size.
    expect(inBar.width).toBeCloseTo(standalone.width, 1);
    expect(inBar.height).toBeCloseTo(standalone.height, 1);
    // ...and the pill is taller, which is the point of the row treatment.
    expect(inRow.height).toBeGreaterThan(inBar.height);

    for (const metrics of [inRow, inBar, standalone]) {
      expect(metrics.width).toBeGreaterThanOrEqual(24);
      expect(metrics.height).toBeGreaterThanOrEqual(24);
      expect(metrics.width).toBeCloseTo(metrics.height, 1);
      expect(Math.abs(metrics.inkOffset)).toBeLessThanOrEqual(0.5);
    }
  });

  test('on a type page the star is the last control of the chip row, not a second one', async ({ page }) => {
    // Teleported after mount, so the star exists only on the hydrated page;
    // the count guards against a second copy landing outside the row.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.type-header-row .type-action-fav .favorite-star')).toHaveCount(1);
    await expect(page.locator('.favorite-star-button')).toHaveCount(1);
    await expect(page.locator('.favorite-star.standalone')).toHaveCount(0);
    // And it still toggles from there, across a reload.
    const star = page.locator('.type-header-row .favorite-star-button');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('.type-header-row .favorite-star-button'))
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('a client-side navigation between type pages re-finds the row', async ({ page }) => {
    // The mount point is resolved per content update; without that, SPA
    // navigation would leave the star teleported to the previous page's row.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.type-header-row .favorite-star-button')).toHaveCount(1);
    await page.locator('.vp-doc a[href$="aws-cdk-lib.aws_sns.TopicBase.html"]').first().click();
    await expect(page.locator('.vp-doc h1')).toHaveText('TopicBase');
    await expect(page.locator('.type-header-row .favorite-star-button')).toHaveCount(1);
    await expect(page.locator('.favorite-star-button')).toHaveCount(1);
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

  test('the capped message stays in the row without overlapping the pills or widening the page', async ({ page }) => {
    // Starring past the cap puts a sentence inside the star's wrapper, which on
    // a type page sits in the chip row beside two pills. The row is a wrapping
    // flex box, so the message takes the width left over: measured 291x24 at
    // 1280px between the pills, and 104x96 at 375px, inside the viewport and
    // clear of both pills in each case.
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(TOPIC_PAGE);
      await page.evaluate(() => {
        const entries = Array.from({ length: 20 }, (_, i) => ({
          path: `/v2/docs/filler-${i}`,
          title: `Filler ${i}`,
        }));
        localStorage.setItem('cdk-docs:favourites', JSON.stringify(entries));
      });
      await page.reload();
      const star = page.locator('.type-header-row .favorite-star-button');
      await expect(star).toBeVisible();
      await star.click();

      const cap = page.locator('.favorite-star-cap');
      await expect(cap).toBeVisible();
      const geometry = await page.evaluate(() => {
        const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const message = box('.favorite-star-cap');
        const overlaps = (other: DOMRect) =>
          message.left < other.right && other.left < message.right
          && message.top < other.bottom && other.top < message.bottom;
        return {
          left: message.left,
          right: message.right,
          onCopy: overlaps(box('.copy-markdown-main')),
          onOptions: overlaps(box('.copy-markdown-options')),
          onStar: overlaps(box('.favorite-star-button')),
          scrolls: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      expect(geometry.left, `${width}px`).toBeGreaterThanOrEqual(0);
      expect(geometry.right, `${width}px`).toBeLessThanOrEqual(width);
      expect(geometry.onCopy, `${width}px`).toBe(false);
      expect(geometry.onOptions, `${width}px`).toBe(false);
      expect(geometry.onStar, `${width}px`).toBe(false);
      expect(geometry.scrolls, `${width}px`).toBe(false);
    }
  });

  test('the star does not add height to the breadcrumb bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // An overview page is where the star shares the breadcrumb bar; on a type
    // page it lives in the chip row.
    await page.goto(SQS_OVERVIEW_PAGE);

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
