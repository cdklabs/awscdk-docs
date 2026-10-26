import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Member rows. Properties and methods render the SAME row shape: a header
// line, a summary line, then short prose inline or long prose behind a
// labeled disclosure. One spec covers both sections because they emit one
// class, and a second spec would drift the first time either side was edited.
//
// Interactive theme feature, so per AGENTS.md it carries an e2e spec: no
// markup-level test can prove the control still toggles, that the control and
// the type links are both reachable from the keyboard, or that an anchor
// navigation lands on the member it names.

/** Rows that actually carry a disclosure, in one section's container. */
const expandable = (container: string) => `${container} .member-row:has(details.member-disclosure)`;

const SECTIONS = [
  { name: 'properties', container: '.props-table' },
  { name: 'methods', container: '.methods-table' },
] as const;

test.describe('member rows', () => {
  for (const section of SECTIONS) {
    test(`${section.name}: the header line sits outside the disclosure control`, async ({ page }) => {
      await page.goto(TOPIC_PAGE);
      const row = page.locator(expandable(section.container)).first();
      await expect(row).toBeAttached();

      // Nothing interactive may sit inside the control, which would be a
      // `nested-interactive` violation. Asked of the rendered page rather than
      // the emitter, so it holds whatever the markup does.
      await expect(row.locator('summary a, summary button, summary [tabindex]')).toHaveCount(0);
      await expect(row.locator('> .member-line')).toHaveCount(1);
    });

    test(`${section.name}: the control toggles its own body`, async ({ page }) => {
      await page.goto(TOPIC_PAGE);
      const row = page.locator(expandable(section.container)).first();
      const details = row.locator('details.member-disclosure');
      const body = row.locator('.member-details');

      await expect(body).toBeHidden();
      await details.locator('> summary').click();
      await expect(details).toHaveAttribute('open', '');
      await expect(body).toBeVisible();
      await details.locator('> summary').click();
      await expect(body).toBeHidden();
    });

    test(`${section.name}: the control is reachable and operable from the keyboard`, async ({ page }) => {
      await page.goto(TOPIC_PAGE);
      const row = page.locator(expandable(section.container)).first();
      const summary = row.locator('details.member-disclosure > summary');

      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(row.locator('.member-details')).toBeVisible();
    });

    test(`${section.name}: the label names what it opens`, async ({ page }) => {
      await page.goto(TOPIC_PAGE);
      const summary = page.locator(`${expandable(section.container)} details.member-disclosure > summary`).first();

      // The control is named by its VISIBLE text now, not an aria-label on an
      // empty box — and the text has to describe the contents rather than
      // repeat jsii's field names.
      const label = (await summary.textContent())?.trim() ?? '';
      expect(label.length).toBeGreaterThan(0);
      expect(label).toMatch(/parameters?|returns|example|default|notes|more detail/);
      expect(label).not.toMatch(/remarks/i);
    });
  }

  test('both sections render the identical control', async ({ page }) => {
    // The two sections emit the same class, so this reads the computed style
    // of one control in each and requires them to match. A re-split would show
    // up here first.
    await page.goto(TOPIC_PAGE);
    const read = async (container: string) =>
      page
        .locator(`${expandable(container)} details.member-disclosure > summary`)
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            color: style.color,
            size: style.fontSize,
            decoration: style.textDecorationStyle,
            display: style.display,
          };
        });

    const [props, methods] = [await read('.props-table'), await read('.methods-table')];
    expect(methods).toEqual(props);
    // And the affordance is the dotted underline that replaced the glyph.
    expect(props.decoration).toBe('dotted');
  });

  test('the summary line wraps instead of clamping', async ({ page }) => {
    // The summary has a line of its own, so there is deliberately NO clamp — a
    // clamp would truncate a description that has a whole line to itself.
    await page.goto(TOPIC_PAGE);
    const clamp = await page
      .locator('.props-table .member-summary')
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { whiteSpace: style.whiteSpace, textOverflow: style.textOverflow };
      });
    expect(clamp.whiteSpace).not.toBe('nowrap');
    expect(clamp.textOverflow).not.toBe('ellipsis');
  });

  test('an expandable row is no airier than a bare one', async ({ page }) => {
    // The density requirement: a row does not grow just because it can expand,
    // and both kinds share a left edge — the old native triangle indented only
    // the expandable ones.
    await page.goto(TOPIC_PAGE);
    const withControl = await page
      .locator(`${expandable('.props-table')} > .member-line`)
      .first()
      .boundingBox();
    const bare = await page
      .locator('.props-table .member-row:not(:has(details.member-disclosure)) > .member-line')
      .first()
      .boundingBox();

    expect(withControl).not.toBeNull();
    expect(bare).not.toBeNull();
    expect(withControl!.height).toBeLessThanOrEqual(bare!.height + 1);
    expect(Math.abs(withControl!.x - bare!.x)).toBeLessThanOrEqual(1);
  });

  test('a type link inside a row stays reachable as a destination', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const link = page.locator('.props-table .member-line .member-type a').first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /.+/);
  });
});

test.describe('member row vertical balance', () => {
  // Each row sits centered between its two dividers: the space above the member
  // name equals the space below the last line, so a row never reads pushed up
  // against the divider above it. The row's padding comes from the density
  // token layer, so this must hold at every density level; the gap is measured
  // against the row's own content box, which excludes that symmetric padding.
  //
  // The four kinds exercise each surface the fix touches: a summary-only row
  // (already balanced), a row whose last block is `.member-extra` inline prose,
  // a row whose last block is a `.member-default` line, and a folded-out
  // `.member-details` row. The extra and details kinds are the two arms of the
  // CSS rule, so both are covered independently.
  type Kind = 'summary-only' | 'ends-in-extra' | 'with-default' | 'folded-out';
  const KINDS: Kind[] = ['summary-only', 'ends-in-extra', 'with-default', 'folded-out'];
  // 'unset' is Balanced (no attribute); the picker's other two levels change
  // the padding but must keep top and bottom equal.
  const LEVELS = ['', 'compact', 'spacious'] as const;

  for (const level of LEVELS) {
    for (const kind of KINDS) {
      test(`${level || 'balanced'}: a ${kind} row has equal space above and below`, async ({ page }) => {
        await page.goto(TOPIC_PAGE);
        await page.evaluate((lvl) => {
          const h = document.documentElement;
          if (lvl) h.setAttribute('data-density', lvl); else h.removeAttribute('data-density');
          // Open every disclosure so a folded-out row can be measured expanded.
          document
            .querySelectorAll('.props-table details.member-disclosure, .methods-table details.member-disclosure')
            .forEach((d) => ((d as HTMLDetailsElement).open = true));
        }, level);

        const trailingMargin = await page.evaluate((k: Kind) => {
          const rows = [...document.querySelectorAll('.props-table .member-row, .methods-table .member-row')];
          // Real predicates, keyed on the row's actual last rendered block so
          // the two arms of the fix (.member-extra / .member-details) are each
          // targeted deterministically.
          const lastBlock = (r: Element): Element | null => {
            const blocks = [...r.querySelectorAll(':scope > .member-line, :scope > .member-summary, :scope > .member-extra, :scope > details.member-disclosure')]
              .filter((e) => (e as HTMLElement).offsetParent !== null);
            return blocks[blocks.length - 1] ?? null;
          };
          const matches = (r: Element): boolean => {
            const last = lastBlock(r);
            if (!last) return false;
            switch (k) {
              case 'summary-only':
                return last.classList.contains('member-summary');
              case 'ends-in-extra':
                return last.classList.contains('member-extra') && !r.querySelector('.member-default');
              case 'with-default':
                return !!r.querySelector('.member-default');
              case 'folded-out':
                return last.matches('details.member-disclosure');
            }
          };
          const target = rows.find(matches);
          if (!target) return null;

          // The imbalance is a trailing bottom margin on the row's last text
          // block. That margin collapses through the marginless row wrapper
          // into the padding box, and a margin is invisible to
          // getBoundingClientRect, so this asserts on the computed margin
          // directly rather than on a measured rect gap. Walk to the last
          // BLOCK-LEVEL descendant (skipping an inline trailing `<code>`): the
          // fix pins its bottom margin to 0 at every density level, leaving the
          // row's own symmetric padding as the only space below the last line.
          const isBlock = (e: Element) => {
            const d = getComputedStyle(e).display;
            return d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item';
          };
          let last: Element = target;
          for (;;) {
            const kids = [...last.children].filter((e) => (e as HTMLElement).offsetParent !== null && isBlock(e));
            if (kids.length === 0) break;
            last = kids[kids.length - 1];
          }
          return parseFloat(getComputedStyle(last).marginBottom);
        }, kind);

        expect(trailingMargin, `no ${kind} row found on the page`).not.toBeNull();
        // No trailing bottom margin, so the space below the last line is exactly
        // the row's symmetric bottom padding — equal to the space above the
        // member name. (1px allows for subpixel rounding.)
        expect(trailingMargin!).toBeLessThanOrEqual(1);
      });
    }
  }
});

test.describe('member permalinks', () => {
  test('every row carries a named permalink that is always in the tab order', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const row = page.locator('.props-table .member-row').first();
    const anchor = row.locator('a.member-permalink');

    // Revealed on hover, but `opacity` rather than `visibility`/`display` on
    // purpose: the other two would drop it out of the tab order, and the spec
    // requires it to stay focusable and named at all times.
    const name = await anchor.getAttribute('aria-label');
    expect(name).toMatch(/^Permalink to \S+/);
    await expect(anchor).toHaveCount(1);

    await anchor.focus();
    await expect(anchor).toBeFocused();
    // The reveal is a transition, so a single read right after focus catches an
    // intermediate value rather than the settled one — poll for the end state
    // instead of sampling mid-animation.
    await expect
      .poll(async () => Number(await anchor.evaluate((el) => getComputedStyle(el).opacity)))
      .toBeGreaterThan(0);
  });

  test('navigating to a permalink lands on the member it names', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const row = page.locator('.props-table .member-row').first();
    const id = await row.getAttribute('id');
    expect(id).toBeTruthy();

    // Reload AT the anchor rather than clicking, which is what a shared deep
    // link actually does — and the id is on the ROW, so the whole member is
    // the target rather than one span inside it.
    await page.goto(`${TOPIC_PAGE}#${id}`);
    const targeted = page.locator(`.member-row#${id}`);
    await expect(targeted).toBeInViewport();
    const isTarget = await targeted.evaluate((el) => el.matches(':target'));
    expect(isTarget).toBe(true);
  });

  test('the permalink hangs in the left gutter and the content is not indented for it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(TOPIC_PAGE);

    const row = page.locator('.props-table .member-row').first();
    await expect(row.locator('a.member-permalink')).toHaveCount(1);

    const measure = () => row.evaluate((el) => {
      const anchor = el.querySelector('a.member-permalink')!;
      const name = el.querySelector('.member-name, .member-signature')!;
      const line = el.querySelector('.member-line')!;
      const b = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top }; };
      return { anchor: b(anchor), name: b(name), line: b(line) };
    });

    // Like a heading anchor: wholly left of the line's content edge, on the
    // first line, and the name starts AT the content edge rather than after
    // the glyph — the control costs the row no indent.
    const resting = await measure();
    expect(resting.anchor.right).toBeLessThanOrEqual(resting.line.left + 0.5);
    expect(resting.anchor.left).toBeGreaterThan(0);
    expect(resting.anchor.top).toBeLessThanOrEqual(resting.name.top + 1);
    expect(resting.name.left).toBeCloseTo(resting.line.left, 0);

    // Revealing it must not move anything: the glyph only changes opacity.
    await row.hover();
    const hovered = await measure();
    expect(hovered.name.left).toBeCloseTo(resting.name.left, 0);
    expect(hovered.anchor.left).toBeCloseTo(resting.anchor.left, 0);
  });
});
