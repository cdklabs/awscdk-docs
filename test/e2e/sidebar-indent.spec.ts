import { expect, test, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Sidebar indentation. The Jest test only string-matches api-sidebar.css;
// these assertions run against the built, hydrated site and pin each
// parent/child step plus sibling alignment.
test.describe('sidebar indentation steps at every nesting level', () => {
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

  test('each nesting level adds one density-token indent', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Filter navigation in the sidebar' })
      .fill('Topic');
    await expect(page.locator('.api-sidebar a.api-sidebar-link').first()).toBeVisible();

    const rows = await collectRows(page);
    expect(Math.max(...rows.map((row) => row.depth))).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      const caretOffset = row.kind === 'link' ? 16 : 0;
      const expected = Math.max(row.depth - 1, 0) * 14 + caretOffset;
      expect(row.paddingLeft).toBeCloseTo(expected, 1);
    }
  });

  test('children step right and siblings share one text column', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Filter navigation in the sidebar' })
      .fill('Topic');
    await expect(page.locator('.api-sidebar a.api-sidebar-link').first()).toBeVisible();

    const measurements = await page.evaluate(() => {
      const labelX = (li: HTMLElement) => {
        const row = li.querySelector<HTMLElement>(
          ':scope > .api-sidebar-group, :scope > .api-sidebar-link',
        );
        if (!row || row.offsetParent === null) return undefined;
        if (row.classList.contains('api-sidebar-group')) {
          return row.querySelector<HTMLElement>('.api-sidebar-text')?.getBoundingClientRect().x;
        }
        return row.getBoundingClientRect().x + parseFloat(getComputedStyle(row).paddingLeft);
      };

      return [...document.querySelectorAll<HTMLElement>('.api-sidebar .api-sidebar-item')]
        .flatMap((li) => {
          const x = labelX(li);
          const parent = li.parentElement?.closest<HTMLElement>('.api-sidebar-item');
          const parentX = parent ? labelX(parent) : undefined;
          if (x === undefined || parentX === undefined) return [];
          return [{
            depth: parseInt(li.style.getPropertyValue('--api-sidebar-depth'), 10),
            x,
            parentX,
            parentKey: parent!.dataset.key ?? parent!.textContent ?? '',
          }];
        });
    });

    expect(measurements.some((row) => row.depth >= 3)).toBe(true);
    for (const row of measurements.filter((item) => item.depth >= 2)) {
      expect(row.x - row.parentX).toBeCloseTo(14, 1);
    }

    const siblingColumns = new Map<string, number[]>();
    for (const row of measurements) {
      const xs = siblingColumns.get(row.parentKey) ?? [];
      xs.push(row.x);
      siblingColumns.set(row.parentKey, xs);
    }
    const mixedSiblings = [...siblingColumns.values()].find((xs) => xs.length >= 2);
    expect(mixedSiblings).toBeDefined();
    for (const x of mixedSiblings!) {
      expect(Math.abs(x - mixedSiblings![0])).toBeLessThanOrEqual(1);
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
