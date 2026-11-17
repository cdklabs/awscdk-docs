import { expect, Page, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// The 1920px layout tier (wide-layout.css). The unit test pins the stylesheet's
// values; the browser checks are what the text cannot answer: that the content
// column really grows on a large monitor, that prose stays at its line length,
// that the stock tiers below 1920px are untouched, and that the nav bar, the
// footer and the /versions page all center on the same lane.
const VERSIONS_PAGE = '/versions.html';
const WIDE = [1920, 2560] as const;
const SIDEBAR_WIDTH = 320;
// Every page wraps its content in one `[data-pagefind-body]` div, so this is
// the running prose of the page: a paragraph that is not inside a member row.
const PROSE = '.vp-doc > [data-pagefind-body] > p';

async function at(page: Page, width: number, path: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
}

const widthOf = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!.width;

/** The horizontal area an element gives its children: its box minus its own padding. */
async function innerLane(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      left: box.left + parseFloat(style.paddingLeft),
      right: box.right - parseFloat(style.paddingRight),
    };
  });
}

test.describe('wide-screen layout tier', () => {
  test('the content column of a type page is wider at 1920px and 2560px than at 1440px', async ({ page }) => {
    await at(page, 1440, TOPIC_PAGE);
    const base = await widthOf(page, '.VPDoc .content-container');
    expect(base).toBe(688);
    for (const width of WIDE) {
      await at(page, width, TOPIC_PAGE);
      const column = await widthOf(page, '.VPDoc .content-container');
      expect(column, `content column at ${width}px`).toBeGreaterThan(base);
      expect(column, `content column at ${width}px`).toBe(992);
      // Member rows use the whole column.
      expect(await widthOf(page, '.VPDoc .member-row'), `member row at ${width}px`).toBe(column);
    }
  });

  for (const width of WIDE) {
    test(`running prose keeps its line length at ${width}px, member rows do not`, async ({ page }) => {
      await at(page, width, TOPIC_PAGE);
      const paragraph = page.locator(PROSE).first();
      await expect(paragraph).toBeVisible();
      expect((await paragraph.boundingBox())!.width).toBeLessThanOrEqual(784);
      // Positive control: a paragraph INSIDE a member row is not capped, so a
      // selector that drifted to every `p` would fail here.
      const nested = page.locator('.member-row .member-extra p').first();
      await expect(nested).toBeAttached();
      expect(await nested.evaluate((el) => getComputedStyle(el).maxWidth)).toBe('none');
    });

    test(`the sidebar, the outline and the nav bar keep their geometry at ${width}px`, async ({ page }) => {
      await at(page, width, TOPIC_PAGE);
      const sidebarWidth = await page
        .locator('.VPSidebar')
        .evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--vp-sidebar-width')));
      expect(sidebarWidth).toBe(SIDEBAR_WIDTH);
      expect(await widthOf(page, '.VPDoc .aside')).toBe(256);
      // The content and the nav bar start on the same lane, and the footer
      // offset follows the content (its 24px is the footer's own padding).
      const content = await innerLane(page, '.VPContent');
      const nav = await innerLane(page, '.VPNavBar .content');
      expect(Math.abs(content.left - nav.left), `content vs nav lane at ${width}px`).toBeLessThanOrEqual(1);
      const footer = await innerLane(page, '.site-footer');
      expect(Math.abs(footer.left - (content.left + 24)), `footer vs content at ${width}px`).toBeLessThanOrEqual(1);
      // The layout itself is the new width, so the lane is not the 1440px one.
      expect(content.right - content.left + SIDEBAR_WIDTH).toBe(Math.min(width, 1920));
    });
  }

  for (const [width, column] of [
    [1280, 576],
    [1440, 688],
  ] as const) {
    test(`below the tier every width is the stock one at ${width}px`, async ({ page }) => {
      await at(page, width, TOPIC_PAGE);
      const layoutMax = await page
        .locator('html')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--vp-layout-max-width').trim());
      expect(layoutMax).toBe('1440px');
      expect(await widthOf(page, '.VPDoc .content-container')).toBe(column);
      expect(await page.locator(PROSE).first().evaluate((el) => getComputedStyle(el).maxWidth)).toBe('none');
    });
  }

  for (const width of [1440, ...WIDE] as const) {
    test(`/versions is centered in the lane right of the sidebar at ${width}px`, async ({ page }) => {
      // The lane is the area the sidebar pages' content uses at this width:
      // right of the 320px sidebar, inside the centered layout.
      await at(page, width, TOPIC_PAGE);
      const lane = await innerLane(page, '.VPContent');
      expect(lane.left).toBeGreaterThanOrEqual(SIDEBAR_WIDTH);
      const nav = await innerLane(page, '.VPNavBar .content');
      expect(Math.abs(lane.left - nav.left)).toBeLessThanOrEqual(1);

      await at(page, width, VERSIONS_PAGE);
      const container = (await page.locator('.VPDoc .container').boundingBox())!;
      const laneCenter = (lane.left + lane.right) / 2;
      const containerCenter = container.x + container.width / 2;
      expect(Math.abs(containerCenter - laneCenter), `center offset at ${width}px`).toBeLessThanOrEqual(2);
      // And it really is the lane right of the sidebar, not the full viewport.
      expect(container.x).toBeGreaterThanOrEqual(SIDEBAR_WIDTH);
      expect(container.width).toBe(Math.min(width >= 1920 ? 1440 : 1104, lane.right - lane.left - 64));
    });
  }
});
