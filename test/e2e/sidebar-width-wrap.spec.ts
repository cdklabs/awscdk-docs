import { expect, test, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Sidebar width + long-name wrapping. The Jest test only string-matches
// api-sidebar.css; these assertions run against the BUILT, hydrated site,
// so they catch what a unit test cannot: a specificity conflict or
// load-order change that silently re-enables nowrap/ellipsis clipping even
// though the CSS text still contains the wrapping rules.
test.describe('sidebar width and name wrapping', () => {
  async function waitForSidebar(page: Page) {
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  test('desktop sidebar column is widened to 320px', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    // The override must actually win the cascade over VitePress's 272px
    // default at desktop widths (Desktop Chrome project is 1280px wide).
    const varValue = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--vp-sidebar-width')
        .trim(),
    );
    expect(varValue).toBe('320px');

    // And the rendered sidebar element derives its width from it.
    const sidebar = page.locator('aside.VPSidebar');
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box!.width).toBe(320);
  });

  test('below 960px the mobile drawer keeps the VitePress default', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(TOPIC_PAGE);

    // The 320px override is scoped to (min-width: 960px); the fixed-width
    // mobile drawer must be untouched.
    const varValue = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--vp-sidebar-width')
        .trim(),
    );
    expect(varValue).toBe('272px');
  });

  test('long entry names wrap to multiple lines instead of being clipped', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await waitForSidebar(page);

    // Surface the longest DISPLAYED entry in the (complete) sidebar dataset
    // via the in-sidebar filter. Nested type names now display only their
    // last FQN segment, so the probe is a long non-nested name
    // that renders in full: 63 chars cannot fit on one 320px line, so this
    // proves wrapping behaviorally, not just via computed properties.
    const longName =
      'LocalGatewayRouteTableVirtualInterfaceGroupAssociationReference';
    await page
      .getByRole('textbox', { name: 'Filter API symbols in the sidebar' })
      .fill('LocalGatewayRouteTableVirtualInterfaceGroup');

    // Leaf entries render their text directly inside a.api-sidebar-link
    // (the .api-sidebar-text span exists only inside group buttons).
    const entry = page
      .locator('.api-sidebar a.api-sidebar-link')
      .filter({ hasText: longName })
      .first();
    await expect(entry).toBeVisible();

    // The wrapping rules must be the COMPUTED style on the rendered entry,
    // not merely present in the stylesheet text (the exact regression class
    // AGENTS.md rule #7 calls out: a specificity conflict or load-order
    // change can silently re-enable clipping while the CSS text is intact).
    const style = await entry.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        whiteSpace: cs.whiteSpace,
        textOverflow: cs.textOverflow,
        overflowWrap: cs.overflowWrap,
        lineHeight: parseFloat(cs.lineHeight),
      };
    });
    expect(style.whiteSpace).toBe('normal');
    expect(style.textOverflow).not.toBe('ellipsis');
    expect(style.overflowWrap).toBe('anywhere');

    // Behavioral guarantees: the entry occupies more than one line…
    const box = await entry.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(style.lineHeight * 2);

    // …and nothing overflows horizontally (the old nowrap/ellipsis CSS
    // yields scrollWidth > clientWidth for an overflowing name).
    const overflow = await entry.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Group buttons carry the same rules on their .api-sidebar-text span, which
    // is where a nowrap/ellipsis declaration would otherwise sit.
    const groupText = page.locator('.api-sidebar .api-sidebar-group .api-sidebar-text').first();
    await expect(groupText).toBeVisible();
    const groupStyle = await groupText.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow };
    });
    expect(groupStyle.whiteSpace).toBe('normal');
    expect(groupStyle.textOverflow).not.toBe('ellipsis');
  });
});
