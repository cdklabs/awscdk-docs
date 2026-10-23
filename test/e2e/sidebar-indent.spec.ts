import { expect, test, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Sidebar indentation cap. The Jest test only string-matches
// api-sidebar.css; these assertions run against the BUILT, hydrated site,
// so they catch what a unit test cannot: a specificity conflict or
// load-order change that silently re-enables a per-depth compounding
// indent even though the CSS text still contains the clamped rule.
test.describe('sidebar indentation capped at one level', () => {
  interface Row {
    depth: number;
    kind: 'group' | 'link';
    paddingLeft: number;
  }

  /**
   * Collect every VISIBLE sidebar row: its nesting depth (from the
   * --api-sidebar-depth inline style ApiSidebarItem.vue sets) plus the
   * COMPUTED left padding of the rendered group button / leaf link.
   */
  async function collectRows(page: Page): Promise<Row[]> {
    return page.evaluate(() => {
      const rows: { depth: number; kind: 'group' | 'link'; paddingLeft: number }[] = [];
      document
        .querySelectorAll<HTMLElement>('.api-sidebar .api-sidebar-item')
        .forEach((li) => {
          const depth = parseInt(
            li.style.getPropertyValue('--api-sidebar-depth'),
            10,
          );
          const el = li.querySelector<HTMLElement>(
            ':scope > .api-sidebar-group, :scope > .api-sidebar-link',
          );
          // Skip rows inside a collapsed (display: none) subtree.
          if (!el || el.offsetParent === null || Number.isNaN(depth)) return;
          rows.push({
            depth,
            kind: el.classList.contains('api-sidebar-group') ? 'group' : 'link',
            paddingLeft: parseFloat(getComputedStyle(el).paddingLeft),
          });
        });
      return rows;
    });
  }

  test('indent does not compound below the first nesting level', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();

    // Force the deep branches open: the filter keeps matching nodes with
    // their ancestor chain (original depths preserved) and forces every
    // surviving group open, so type links at the deepest nesting level
    // become visible without scripting per-level clicks.
    await page
      .getByRole('textbox', { name: 'Filter navigation in the sidebar' })
      .fill('Topic');
    await expect(
      page.locator('.api-sidebar a.api-sidebar-link').first(),
    ).toBeVisible();

    const rows = await collectRows(page);
    const maxDepth = Math.max(...rows.map((r) => r.depth));

    // The cap is only exercised by nodes MORE than one level deep; the
    // fixture's service -> group -> type tree must provide them, or this
    // spec is vacuous.
    expect(maxDepth).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.kind === 'link' && r.depth >= 2)).toBe(true);

    for (const row of rows) {
      // Leaf links carry a constant +16px so their text lines up with
      // group labels, whose 16px caret occupies that width.
      const caretOffset = row.kind === 'link' ? 16 : 0;
      // The Framework/Services section headers occupy depth 0, so services
      // (depth 1) sit flush; EVERY deeper level shares the single 14px
      // indent -- a compounding depth*12px would put a depth-3 type at
      // 36px+ and fail here.
      const expected = (row.depth <= 1 ? 0 : 14) + caretOffset;
      expect(row.paddingLeft).toBeCloseTo(expected, 1);
    }
  });

  test('type links align in one text column with their group labels', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Filter navigation in the sidebar' })
      .fill('Topic');
    await expect(
      page.locator('.api-sidebar a.api-sidebar-link').first(),
    ).toBeVisible();

    // A nested group's TEXT starts after its 16px caret; a leaf link at any
    // nested depth must start at that same x position (14px indent + 16px
    // caret width), so all labels under a service form one column. Measure
    // the label start of EVERY visible nested row and require one column.
    // Depth 0 is the Framework/Services section header, depth 1 the flush
    // service groups -- the shared indent applies below them.
    const labelStarts = await page.evaluate(() => {
      const xs: number[] = [];
      document
        .querySelectorAll<HTMLElement>('.api-sidebar .api-sidebar-item')
        .forEach((li) => {
          const depth = parseInt(
            li.style.getPropertyValue('--api-sidebar-depth'),
            10,
          );
          if (Number.isNaN(depth) || depth < 2) return; // depth <= 1 sits flush
          const el = li.querySelector<HTMLElement>(
            ':scope > .api-sidebar-group, :scope > .api-sidebar-link',
          );
          if (!el || el.offsetParent === null) return;
          if (el.classList.contains('api-sidebar-group')) {
            const text = el.querySelector<HTMLElement>('.api-sidebar-text')!;
            xs.push(text.getBoundingClientRect().x);
          } else {
            const rect = el.getBoundingClientRect();
            xs.push(rect.x + parseFloat(getComputedStyle(el).paddingLeft));
          }
        });
      return xs;
    });

    // Nested groups AND nested links must both be represented (>= 3 rows
    // in the fixture's service -> group -> type tree), all in one column.
    expect(labelStarts.length).toBeGreaterThanOrEqual(3);
    const first = labelStarts[0];
    for (const x of labelStarts) {
      expect(Math.abs(x - first)).toBeLessThanOrEqual(1);
    }
  });

  // Kind-group de-emphasis. The Jest test string-matches
  // api-sidebar.css, so it cannot fail for the defect that actually
  // matters: whether the marker the selector depends on reaches the
  // rendered page at all. Rename `data-kind-group` in ApiSidebarItem.vue
  // and that assertion stays green while every kind group across the 81
  // changed sections loses its de-emphasis. These assertions read the
  // COMPUTED heading styles off the built site instead, and read them at
  // TWO different depths, because dropping the resource wrapper of a
  // single-resource section moves a kind group to a depth that a depth-keyed
  // rule misses.
  /**
   * Measure the kind group that encloses a visible leaf link, plus the
   * nearest enclosing group that is NOT a kind group -- the resource or
   * service level the kind group must read as subordinate to.
   */
  async function measureKindGroup(page: Page, linkText: string) {
    return page.evaluate((text) => {
      const read = (li: HTMLElement) => {
        const btn = li.querySelector<HTMLElement>(':scope > .api-sidebar-group')!;
        const cs = getComputedStyle(btn);
        return {
          depth: parseInt(li.style.getPropertyValue('--api-sidebar-depth'), 10),
          marked: li.hasAttribute('data-kind-group'),
          fontSize: parseFloat(cs.fontSize),
          fontWeight: parseInt(cs.fontWeight, 10),
          color: cs.color,
        };
      };
      const link = [...document.querySelectorAll<HTMLElement>('.api-sidebar a.api-sidebar-link')]
        .find((a) => a.textContent?.trim() === text);
      if (!link) return null;
      let kind: HTMLElement | null = null;
      let outer: HTMLElement | null = null;
      for (let n = link.parentElement; n; n = n.parentElement) {
        if (!(n instanceof HTMLElement) || !n.classList.contains('api-sidebar-item')) continue;
        if (!n.querySelector(':scope > .api-sidebar-group')) continue;
        if (n.hasAttribute('data-kind-group')) {
          if (!kind) kind = n;
        } else if (kind && !outer) {
          outer = n;
        }
      }
      return { kind: kind && read(kind), outer: outer && read(outer) };
    }, linkText);
  }

  test('kind groups are de-emphasized by their marker, identically at two different depths', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    const filter = page.getByRole('textbox', { name: 'Filter navigation in the sidebar' });

    // Deep arm: SQS has several resources, so `Queue` keeps its resource
    // wrapper and the `Facades` kind group holding `QueueGrants` sits at
    // the historical four-level depth.
    await filter.fill('QueueGrants');
    await expect(page.locator('.api-sidebar a.api-sidebar-link').first()).toBeVisible();
    const deep = await measureKindGroup(page, 'QueueGrants');

    // Shallow arm: `Backup Gateway` documents a single resource, so this
    // change drops that wrapper and its `Others` group sits one level
    // higher -- the case a depth-keyed rule rendered differently.
    await filter.fill('CfnHypervisorProps');
    await expect(page.locator('.api-sidebar a.api-sidebar-link').first()).toBeVisible();
    const shallow = await measureKindGroup(page, 'CfnHypervisorProps');

    // Both arms must exist, or the spec is vacuous rather than passing.
    expect(deep?.kind).toBeTruthy();
    expect(deep?.outer).toBeTruthy();
    expect(shallow?.kind).toBeTruthy();

    // The marker reaches the page. This is the assertion the stylesheet
    // string-match cannot make.
    expect(deep!.kind!.marked).toBe(true);
    expect(shallow!.kind!.marked).toBe(true);

    // The two kind groups genuinely sit at DIFFERENT depths, so no single
    // depth value could have styled both -- that is the whole reason the
    // contract moved onto the marker.
    expect(shallow!.kind!.depth).toBeLessThan(deep!.kind!.depth);

    // And they render IDENTICALLY despite that: same size, weight, color.
    expect(shallow!.kind!.fontSize).toBeCloseTo(deep!.kind!.fontSize, 1);
    expect(shallow!.kind!.fontWeight).toBe(deep!.kind!.fontWeight);
    expect(shallow!.kind!.color).toBe(deep!.kind!.color);

    // De-emphasized values, computed rather than declared, and provably
    // distinct from the resource level above them: if the rule stopped
    // applying, these would inherit the resource heading's own styling.
    expect(deep!.kind!.fontSize).toBeCloseTo(13, 1);
    expect(deep!.kind!.fontWeight).toBe(500);
    expect(deep!.kind!.fontSize).toBeLessThan(deep!.outer!.fontSize);
    expect(deep!.kind!.color).not.toBe(deep!.outer!.color);
  });
});
