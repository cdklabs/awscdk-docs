import { expect, test, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Lazy subtree rendering. Mounting the entire symbol tree on every API page
// and hiding the collapsed parts with `display: none` leaves ~96,500 elements
// in the DOM and ~570ms of blocking time building them, which is the whole of
// the API pages' Lighthouse performance deficit.
//
// These assertions run against the BUILT, hydrated site because both states
// are invisible in the source text: `v-show` and `v-if`
// differ only in what reaches the DOM at runtime. The counting test is the
// one that actually pins the regression — a future change that re-renders
// collapsed branches (a transition wrapper, a keep-alive, a "render ahead"
// optimization) would restore the element explosion while every visual
// assertion in the other sidebar specs still passed.
test.describe('sidebar renders collapsed subtrees lazily', () => {
  const sidebar = (page: Page) => page.locator('.api-sidebar-nav');

  async function itemCount(page: Page) {
    return page.locator('.api-sidebar .api-sidebar-item').count();
  }

  // A collapsed group, addressed by its INDEX among the rendered items.
  // Deliberately not `.first()` of a `[aria-expanded="false"]` locator: that
  // locator re-resolves on every use, so the moment this group opens it
  // matches one of the children it just revealed instead, and the test then
  // asserts against the wrong element. The index is stable because opening a
  // group appends rows inside it, after itself in document order.
  async function pinCollapsedGroup(page: Page) {
    const index = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll('.api-sidebar li.api-sidebar-item'),
      );
      return items.findIndex((li) => {
        const button = li.querySelector(':scope > button.api-sidebar-group');
        return button?.getAttribute('aria-expanded') === 'false';
      });
    });
    expect(index).toBeGreaterThanOrEqual(0);
    return page.locator('.api-sidebar li.api-sidebar-item').nth(index);
  }

  test('an API page does not mount the whole symbol tree', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(sidebar(page)).toBeVisible();

    // The fixture's sidebar data is the FULL corpus (the fixture prune only
    // drops built pages), so the pre-fix DOM carried tens of thousands of
    // rows here. The active page's own ancestor chain is expanded on load,
    // so this is not "one level" — it is a bound comfortably above what the
    // revealed path needs and far below the whole tree.
    expect(await itemCount(page)).toBeLessThan(2000);
  });

  test('a collapsed group renders no children until it is opened', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(sidebar(page)).toBeVisible();

    const group = await pinCollapsedGroup(page);
    const children = group.locator(':scope > ul.api-sidebar-list');
    const toggle = group.locator(':scope > button.api-sidebar-group');

    // Collapsed: absent from the DOM, not merely hidden. `toBeHidden` would
    // pass either way, so assert on attachment.
    await expect(children).toHaveCount(0);

    const before = await itemCount(page);
    await toggle.click();

    // Opening mounts them — lazy rendering must not cost the feature.
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(children).toHaveCount(1);
    await expect(children.locator('> li.api-sidebar-item').first()).toBeVisible();
    expect(await itemCount(page)).toBeGreaterThan(before);

    // Collapsing removes them again.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(children).toHaveCount(0);
    expect(await itemCount(page)).toBe(before);
  });

  test('the active entry is still revealed on load', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(sidebar(page)).toBeVisible();

    // The reveal path depends on rows that only exist after syncActive's
    // expansion has been rendered, so this is the assertion that would catch
    // a lazy-mount change made without the nextTick the reveal already does.
    const active = page.locator('.api-sidebar a.api-sidebar-link.active');
    await expect(active).toBeVisible();
  });
});
