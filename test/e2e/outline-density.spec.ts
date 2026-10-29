import { expect, test, type Page } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

const LEVELS = [
  { name: 'compact', font: 14, line: 17.5, padding: 4, height: 25.5 },
  { name: 'balanced', font: 14, line: 18.2, padding: 5, height: 28.2 },
  { name: 'spacious', font: 15, line: 19.5, padding: 6, height: 31.5 },
] as const;

type Level = (typeof LEVELS)[number]['name'];

async function openAt(page: Page, level: Level): Promise<void> {
  await page.addInitScript((value) => {
    if (value === 'balanced') {
      localStorage.removeItem('cdk-docs-density');
    } else {
      localStorage.setItem('cdk-docs-density', value);
    }
  }, level);
  await page.goto(QUEUE_PAGE);
  const html = page.locator('html');
  if (level === 'balanced') {
    await expect(html).not.toHaveAttribute('data-density');
  } else {
    await expect(html).toHaveAttribute('data-density', level);
  }
}

test.describe('aside outline density', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const level of LEVELS) {
    test(`${level.name} uses its settled dimensions without clipping`, async ({ page }) => {
      await openAt(page, level.name);
      const outline = page.locator('.VPDocAsideOutline');
      await expect(outline).toBeVisible();
      const entry = outline.locator('a.outline-link[href="#properties"]');

      const metrics = await entry.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          font: Number.parseFloat(style.fontSize),
          line: Number.parseFloat(style.lineHeight),
          paddingTop: Number.parseFloat(style.paddingTop),
          paddingBottom: Number.parseFloat(style.paddingBottom),
          height: element.getBoundingClientRect().height,
        };
      });
      expect(metrics.font).toBeCloseTo(level.font, 2);
      expect(metrics.line).toBeCloseTo(level.line, 2);
      expect(metrics.paddingTop).toBeCloseTo(level.padding, 2);
      expect(metrics.paddingBottom).toBeCloseTo(level.padding, 2);
      expect(metrics.height).toBeCloseTo(level.height, 1);
      expect(metrics.height).toBeGreaterThanOrEqual(24);

      const wrapping = await outline.locator('a.outline-link').evaluateAll((entries) => {
        const element = entries.reduce((winner, candidate) =>
          (candidate.textContent?.length ?? 0) > (winner.textContent?.length ?? 0) ? candidate : winner,
        );
        const style = getComputedStyle(element);
        return {
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap,
          textOverflow: style.textOverflow,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      });
      expect(wrapping.whiteSpace).toBe('normal');
      expect(wrapping.overflowWrap).toBe('anywhere');
      expect(wrapping.textOverflow).toBe('clip');
      expect(wrapping.scrollWidth).toBeLessThanOrEqual(wrapping.clientWidth + 1);

      await entry.click();
      await expect(entry).toHaveClass(/\bactive\b/);
      await expect.poll(async () => {
        const linkBox = await entry.boundingBox();
        const markerBox = await outline.locator('.outline-marker').boundingBox();
        if (!linkBox || !markerBox) return Number.POSITIVE_INFINITY;
        return Math.abs(
          linkBox.y + linkBox.height / 2 - (markerBox.y + markerBox.height / 2),
        );
      }).toBeLessThanOrEqual(1);
    });
  }

  test('Compact is tighter than Balanced and Balanced is tighter than Spacious', async ({ browser }) => {
    const heights: number[] = [];
    for (const level of LEVELS) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await openAt(page, level.name);
      heights.push(await page.locator('.VPDocAsideOutline a.outline-link[href="#properties"]')
        .evaluate((element) => element.getBoundingClientRect().height));
      await context.close();
    }
    expect(heights[0]).toBeLessThan(heights[1]);
    expect(heights[1]).toBeLessThan(heights[2]);
  });
});
