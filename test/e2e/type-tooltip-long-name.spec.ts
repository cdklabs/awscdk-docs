import { expect, test, type Locator, type Page } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// The link hover preview is a fixed-width box (`.type-tooltip`, max-width
// 360px) whose head row lays the type name and its kind chip side by side.
// A type name is one unbroken identifier, so a long one is wider than the box
// can hold, and without its own wrap rule it paints past the box edge. Only a
// browser can show that: the overflow exists once fonts and flex layout have
// run, never in the stylesheet source.
//
// Fixture note: the longest names the pruned fixture's pages link to (about
// 30 characters, e.g. `CfnTopic.LoggingConfigProperty`) still fit, so they
// cannot show the bug. The summary map, though, covers every documented type,
// and the preview resolves any anchor whose path names one. So the spec adds
// one link, on a fixture page, to a real 98-character struct whose own page
// was pruned -- the generated summary entry and the preview code are the
// production ones; only the anchor is placed by the test.
const CFN_TOPIC_PAGE = '/v2/docs/aws-cdk-lib.aws_sns.CfnTopic.html';
const LONG_NAME =
  'CfnInstanceAccessControlAttributeConfiguration.InstanceAccessControlAttributeConfigurationProperty';
const LONG_HREF = `/v2/docs/aws-cdk-lib.aws_sso.${LONG_NAME}.html`;

test.describe('link hover preview', () => {
  async function preview(page: Page, link: Locator): Promise<Locator> {
    await link.scrollIntoViewIfNeeded();
    // Chromium delivers the async scroll event just after the hover, and the
    // theme's scroll listener hides the preview it belongs to. Let it drain
    // first, as type-tooltips.spec.ts does.
    await page.waitForTimeout(200);
    await link.hover();
    const tooltip = page.locator('#api-type-tooltip');
    // The first hover of the session fetches and parses the whole summary
    // map, so this one assertion gets a longer budget than the default.
    await expect(tooltip).toHaveAttribute('aria-hidden', 'false', { timeout: 15_000 });
    return tooltip;
  }

  /** Add a content link to the long-named type and return it. */
  async function longLink(page: Page): Promise<Locator> {
    await page.locator('.vp-doc').evaluate((doc, href) => {
      const a = document.createElement('a');
      a.href = href;
      a.id = 'long-type-link';
      a.textContent = 'long type';
      doc.prepend(a);
    }, LONG_HREF);
    return page.locator('#long-type-link');
  }

  /** How far each painted part of the preview reaches past the box's inner edges, in px. */
  async function overflow(tooltip: Locator) {
    return tooltip.evaluate((box) => {
      const outer = box.getBoundingClientRect();
      const name = box.querySelector('.type-tooltip-name') as HTMLElement;
      const kind = box.querySelector('.type-tooltip-kind') as HTMLElement;
      const past = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return Math.max(0, r.right - outer.right, outer.left - r.left);
      };
      return {
        name: past(name),
        kind: past(kind),
        // Text that a box clips or scrolls is not "inside" either.
        nameHidden: name.scrollWidth - name.clientWidth,
        lineHeight: parseFloat(getComputedStyle(name).lineHeight),
        nameHeight: name.getBoundingClientRect().height,
      };
    });
  }

  test('a long type name stays inside the preview box, in full', async ({ page }) => {
    await page.goto(CFN_TOPIC_PAGE);
    const link = await longLink(page);
    const tooltip = await preview(page, link);

    // The whole name is shown, not cut short, so no title fallback is needed.
    await expect(tooltip.locator('.type-tooltip-name')).toHaveText(LONG_NAME);
    const o = await overflow(tooltip);
    expect(o.name).toBe(0);
    expect(o.kind).toBe(0);
    expect(o.nameHidden).toBeLessThanOrEqual(0);
    // The chip keeps its own width beside a long name (`flex-shrink: 0`); squeezed, its no-wrap label would clip.
    const kindClipped = await tooltip
      .locator('.type-tooltip-kind')
      .evaluate((el: HTMLElement) => el.scrollWidth - el.clientWidth);
    expect(kindClipped).toBeLessThanOrEqual(0);
  });

  test('a short type name still sits on one line beside its chip', async ({ page }) => {
    await page.goto(CFN_TOPIC_PAGE);
    const link = page.locator('.vp-doc a[href$="/aws-cdk-lib.CfnTag.html"]').first();
    const tooltip = await preview(page, link);

    const o = await overflow(tooltip);
    expect(o.nameHeight).toBeLessThan(o.lineHeight * 1.5);
    const head = await tooltip.locator('.type-tooltip-head').evaluate((el) => {
      const [name, kind] = [el.children[0], el.children[1]].map((c) => c.getBoundingClientRect());
      return { sameRow: Math.abs(name.top + name.height / 2 - (kind.top + kind.height / 2)) < 4 };
    });
    expect(head.sameRow).toBe(true);
  });

  test('the long name stays inside the box in the dark theme too', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.evaluate(() => localStorage.setItem('vitepress-theme-appearance', 'dark'));
    await page.goto(CFN_TOPIC_PAGE);
    await expect(page.locator('html')).toHaveClass(/dark/);
    const link = await longLink(page);
    const tooltip = await preview(page, link);

    const o = await overflow(tooltip);
    expect(o.name).toBe(0);
    expect(o.kind).toBe(0);
  });
});
