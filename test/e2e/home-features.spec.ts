import { test, expect } from '@playwright/test';

/**
 * Home page feature-card glyphs.
 *
 * The unit tests prove the right markup is in the frontmatter; only a browser
 * can prove the glyph actually renders and actually takes the brand color,
 * which a wrong `stroke:` rule would break silently.
 */
test.describe('feature card glyphs', () => {
  test('every card renders an inline SVG, not an emoji', async ({ page }) => {
    await page.goto('/');
    const icons = page.locator('.VPFeature .icon svg');
    await expect(icons).toHaveCount(4);
    // The emoji rendered as text in this slot; an SVG leaves it empty.
    for (const emoji of ['📚', '🧭', '🧪', '🧱']) {
      await expect(page.locator('.VPFeature .icon', { hasText: emoji })).toHaveCount(0);
    }
  });

  test('glyphs paint with the brand color and are 24px', async ({ page }) => {
    await page.goto('/');
    const first = page.locator('.VPFeature .icon svg').first();
    const box = await first.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, stroke: s.stroke, width: s.width, height: s.height };
    });
    expect(box.width).toBe('24px');
    expect(box.height).toBe('24px');
    // stroke="currentColor" resolves to the computed color, so the two agree
    // only when the tint went through `color`.
    expect(box.stroke).toBe(box.color);
    // Light palette brand-1 is #b45309.
    expect(box.color).toBe('rgb(180, 83, 9)');
  });

  test('glyphs are decorative', async ({ page }) => {
    await page.goto('/');
    const hidden = page.locator('.VPFeature .icon svg[aria-hidden="true"]');
    await expect(hidden).toHaveCount(4);
  });
});
