import { expect, test } from '@playwright/test';
import { CONSTRUCT_PAGE, QUEUE_PAGE } from './fixture.js';

// Type hierarchy block. The unit tests only read the generated markdown, and
// the design requirement — one block, and at most two lines per relation
// before the overflow — can only be judged against a rendered page.
test.describe('type hierarchy block', () => {
  test('every relation is a row of the ONE block, not a panel of its own', async ({ page }) => {
    await page.goto(CONSTRUCT_PAGE);

    const bar = page.locator('.inheritance-chain');
    await expect(bar).toBeAttached();

    // The breadcrumb line and at least one relation row live in the same
    // container, which is what makes the "one family" claim structural rather
    // than a matter of two panels being styled alike.
    await expect(bar.locator('.chain-line')).toBeAttached();
    const rows = bar.locator('.chain-row');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(rows.locator('a.chain-item').first()).toBeVisible();

    // Construct is a class, so it carries the downward relation.
    await expect(bar.getByText('superclass of')).toBeAttached();
  });

  test('a relation row is at most two lines, label included', async ({ page }) => {
    await page.goto(CONSTRUCT_PAGE);

    // The requirement, measured. A markup assertion cannot see a line count,
    // and the first budget — computed from the mono advance width and the
    // content column instead of measured — rendered 4.75 lines while every
    // unit test stayed green.
    const rows = page.locator('.inheritance-chain .chain-row');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const m = await rows.nth(i).evaluate((el) => {
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const label = el.querySelector('.chain-label')!.getBoundingClientRect();
        const first = el.querySelector('.chain-list a.chain-item, .chain-list span.chain-item');
        return {
          lines: (el.getBoundingClientRect().height - pad) / lh,
          // The label must SHARE the first line: as a flex row it took a whole
          // line to itself, which is half of why the row ran long.
          labelSharesFirstLine: first
            ? Math.abs(first.getBoundingClientRect().top - label.top) < lh
            : true,
        };
      });
      expect(m.lines).toBeLessThanOrEqual(2);
      expect(m.labelSharesFirstLine).toBe(true);
    }
  });

  test('the overflow control sits on its row, not below it', async ({ page }) => {
    await page.goto(CONSTRUCT_PAGE);

    const more = page.locator('.inheritance-chain .chain-more').first();
    await expect(more).toBeAttached();
    const summary = more.locator('summary');

    // Native triangle suppressed, and the glyph is the `[+]` convention the
    // property rows use rather than the browser default.
    const [listStyle, glyph] = await summary.evaluate((el) => [
      getComputedStyle(el).listStyleType,
      getComputedStyle(el, '::before').content,
    ]);
    expect(listStyle).toBe('none');
    expect(glyph).toContain('+');

    // Geometry, because this exact defect shipped once: an absolutely
    // positioned control inherited `.vp-doc summary`'s 16px margin and hung
    // below its row. Assert the control is inside its row's box.
    const overhang = await more.evaluate((el) => {
      const row = el.closest('.chain-row')!.getBoundingClientRect();
      return el.querySelector('summary')!.getBoundingClientRect().bottom - row.bottom;
    });
    expect(overhang).toBeLessThanOrEqual(0);

    // Separated from the name before it. This shipped wrong once: the row
    // rendered `Domain+ 2,507 more` with the control jammed against the last
    // name — structurally correct, exactly two lines, every other assertion
    // in this file green, and visibly broken on the page. Only looking at the
    // render caught it, so it is measured here now.
    const gap = await more.evaluate((el) => {
      const last = el.closest('li')!.previousElementSibling!
        .querySelector('a.chain-item, span.chain-item')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      // Same line, so compare horizontally; a wrapped control is covered by
      // the two-line assertion instead.
      return Math.abs(box.top - last.top) < 2 ? box.left - last.right : 99;
    });
    expect(gap).toBeGreaterThanOrEqual(3);
    // Bounded ABOVE as well: the gap is `.chain-more`'s margin plus the
    // comma's own advance, and an emitted space before the control adds a
    // full mono advance on top (measured 13.8px -> 21.7px), which a
    // lower-bound-only assertion cannot see.
    expect(gap).toBeLessThanOrEqual(17);
  });

  test('expanding reveals the hidden names and flips the glyph', async ({ page }) => {
    await page.goto(CONSTRUCT_PAGE);

    const more = page.locator('.inheritance-chain .chain-more').first();
    const hidden = more.locator('a.chain-item').first();
    await expect(hidden).toBeHidden();

    const readGlyph = () => more.locator('summary')
      .evaluate((el) => getComputedStyle(el, '::before').content);
    const closedGlyph = await readGlyph();

    await more.locator('summary').click();
    await expect(more).toHaveAttribute('open', '');
    // Nothing is dropped by the clamp — this is what the old fifty-link cap
    // could not claim, since it truncated the list outright.
    await expect(hidden).toBeVisible();

    const openGlyph = await readGlyph();
    expect(openGlyph).not.toContain('+');

    // Both states carry the same trailing gap, so the control does not
    // change shape when it opens. This is exactly where a CSS hex escape
    // bites: `"\2212 "` consumes its following space as the escape's
    // terminator, so the open glyph rendered `−2,507 more` while the closed
    // one rendered `+ 2,507 more`.
    expect(closedGlyph).toMatch(/\+ /);
    expect(openGlyph).toMatch(/\u2212 /);

    // The sequence must CONTINUE past the control: the last shown name takes
    // the same `, ` separator every other name takes, or the row reads as
    // though the list had ended before the control.
    // NOT trimmed: the separator before the control must be the bare
    // comma. `.trim()` here is what let an emitted trailing space — and the
    // extra mono advance it renders as — pass this assertion unseen.
    const comma = await more.evaluate(
      (el) => (el.closest('li')?.previousElementSibling?.textContent ?? '').endsWith(','),
    );
    expect(comma).toBe(true);
  });

  // The OPEN state, on a page whose remainder is small enough that a welded
  // layout could occur at all if the browser laid it out inline: `Queue`
  // hides two names where `Construct` hides 2,332 and wraps regardless. What
  // is asserted is what MEASURING found rather than what the markup suggests
  // — `<details>` reveals block-level content even when the element itself is
  // `display: inline`, so the names take their own line and are aligned with
  // the row's other lines rather than sitting beside the control.
  test('opened, the revealed names take their own line, aligned with the row', async ({ page }) => {
    await page.goto(QUEUE_PAGE);

    const more = page.locator('.inheritance-chain .chain-more').first();
    await more.locator('summary').click();
    await expect(more).toHaveAttribute('open', '');

    const geom = await more.evaluate((el) => {
      const summary = el.querySelector<HTMLElement>(':scope > summary')!.getBoundingClientRect();
      const first = el.querySelector<HTMLElement>(':scope > .chain-list a.chain-item')!
        .getBoundingClientRect();
      // The row's own continuation edge: the leftmost name outside the
      // disclosure, which is where a wrapped line starts.
      const outer = [...el.closest('.chain-row')!.querySelectorAll<HTMLElement>('.chain-list > li > a.chain-item')]
        .filter((a) => !el.contains(a))
        .map((a) => a.getBoundingClientRect().left);
      return {
        below: first.top - summary.top,
        indent: first.left - Math.min(...outer),
      };
    });

    // A full line below the control, not beside it.
    expect(geom.below).toBeGreaterThan(8);
    // And flush with the row's own left edge: a stray indent here is what a
    // margin intended to "separate" the two produced, which measured as
    // raggedness rather than as separation.
    expect(Math.abs(geom.indent)).toBeLessThanOrEqual(1);
  });

  // List semantics: a run of bare anchors announces no
  // item count and no boundaries, on the largest such group on the site.
  // Read from the ACCESSIBILITY TREE, not the markup: the items render
  // `display: inline` with `list-style: none`, which is exactly the styling
  // that makes WebKit strip native list semantics — the explicit roles are
  // what keep the list announced, so their exposure is what must be pinned.
  test('a relation row is an announced list: item count and boundaries', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const row = page.locator('.inheritance-chain .chain-row').first();
    await expect(row.locator('.chain-label')).toBeVisible();

    // The row exposes exactly one list whose items are the visible names
    // plus the disclosure — the count a screen reader announces.
    const list = row.getByRole('list').first();
    const items = list.getByRole('listitem');
    const visibleNames = await row.locator(':scope > .chain-list > li > a.chain-item, :scope > .chain-list > li > span.chain-item').count();
    const hasMore = (await row.locator('.chain-more').count()) > 0;
    expect(await items.count()).toBe(visibleNames + (hasMore ? 1 : 0));

    // Explicit roles are present on the markup — the WebKit guard the
    // Chromium-only accessibility read above cannot make.
    await expect(list).toHaveAttribute('role', 'list');
    await expect(items.first()).toHaveAttribute('role', 'listitem');

    // Expanded, the remainder is its own nested announced list, so the
    // thousands behind the disclosure keep boundaries too.
    if (hasMore) {
      await row.locator('.chain-more summary').click();
      const nested = row.locator('.chain-more ul.chain-list');
      await expect(nested).toHaveAttribute('role', 'list');
      expect(await nested.getByRole('listitem').count()).toBeGreaterThan(0);
    }
  });

  test('the disclosure is keyboard reachable', async ({ page }) => {
    await page.goto(CONSTRUCT_PAGE);

    const more = page.locator('.inheritance-chain .chain-more').first();
    const summary = more.locator('summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('open', '');
  });
});
