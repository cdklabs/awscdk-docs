import { expect, test } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// Long translated types on a property row. A row is one flex line with
// `flex-wrap: nowrap`, so an item is never moved to a second row-line — a row
// that looks wrapped is the type's own text wrapping and growing the line
// box. `int | float` is Python's spelling of jsii `number`, and
// `message_retention_period_in_days` on the Queue page is the probe.
//
// Geometry is the only honest gate here: the markup is unchanged apart from a
// `title`, and a stylesheet assertion cannot say whether the row is one line
// in a browser. Every measurement below is scoped to the VISIBLE variant,
// because the page carries one hidden copy of the row's name and type per
// enabled language and a page-wide locator would happily measure a hidden one.

/** Viewport wide enough to stay above the 640px stacking breakpoint, narrow
 *  enough that a long type has to compete with the description. */
const VIEWPORT = { width: 700, height: 900 };

interface RowMetric {
  /** Collapsed text of the visible type, e.g. `int | float`. */
  readonly type: string;
  /** The `title` carrying the full value behind a clamp. */
  readonly title: string;
  readonly height: number;
  readonly lineHeight: number;
  /** Right edge of the row line and of the visible type box. */
  readonly rowRight: number;
  readonly typeRight: number;
  /** Right padding: the gutter the `[+]` control sits in. */
  readonly paddingRight: number;
}

async function rowMetrics(page: import('@playwright/test').Page): Promise<RowMetric[]> {
  return page.evaluate(() => {
    const lines = document.querySelectorAll('.props-table .member-line');
    const out = [];
    for (const line of Array.from(lines)) {
      // The hidden language variants are `display: none`, so a zero-width box
      // is how the inactive copies are told apart from the shown one.
      const type = Array.from(line.querySelectorAll('.member-type'))
        .find((el) => el.getBoundingClientRect().width > 0);
      if (!type) {
        continue;
      }
      const lineBox = line.getBoundingClientRect();
      const styles = getComputedStyle(line);
      out.push({
        type: (type.textContent ?? '').replace(/\s+/g, ' ').trim(),
        title: type.getAttribute('title') ?? '',
        height: lineBox.height,
        lineHeight: parseFloat(styles.lineHeight),
        rowRight: lineBox.right,
        typeRight: type.getBoundingClientRect().right,
        paddingRight: parseFloat(styles.paddingRight),
      });
    }
    return out;
  });
}

/** `page.goto` resolves on `load`, but `?lang=python` is applied during
 *  hydration — so every read has to wait for the active variant, or it can
 *  measure the canonical TypeScript row and find nothing it was looking for. */
async function openPythonVariant(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${QUEUE_PAGE}?lang=python`);
  await expect(page.locator('.lang-tabs').first()).toHaveAttribute('data-active', 'python');
}

test.describe('long translated property types', () => {
  test.use({ viewport: VIEWPORT });

  test('a union-typed row is the same height as a single-token-typed row', async ({ page }) => {
    await openPythonVariant(page);

    const rows = await rowMetrics(page);
    const wide = rows.find((row) => row.type === 'int | float');
    // Not a `count() > 0` guard: if the reported row is missing, the fixture
    // has changed and this spec is measuring nothing, which must be a failure
    // rather than a silent pass.
    expect(wide, 'no row rendered the reported `int | float` type').toBeDefined();

    const single = rows.filter((row) => row.type.length > 0 && !row.type.includes(' '));
    expect(single.length).toBeGreaterThan(0);
    const baseline = Math.min(...single.map((row) => row.height));

    // Tolerance is HALF a line-height deliberately. A row that breaks onto a
    // second line grows by one whole line-height, so a full line-height of
    // slack would accept exactly the bug this asserts against: an unclamped
    // union row measures 19px taller on a 21px line.
    expect(wide!.height).toBeLessThan(baseline + wide!.lineHeight / 2);
  });

  test('a clamped type stays inside its own row', async ({ page }) => {
    // No gutter is reserved at the right-hand end of the row, so what has to
    // hold is that the type never overflows the row that contains it.
    await openPythonVariant(page);
    // Every visible type, not a chosen one. Picking a subject was the wrong
    // shape twice over: comparing the pick against a maximum from the same loop
    // is true by construction, and the widest type on this fixture is not even
    // unique — `FifoThroughputLimit` and `ResourceEnvironment` both measure
    // 148px, so pinning "the widest" by name would depend on which of two equal
    // boxes came first. Asserting the invariant over all of them needs no pick,
    // and is strictly stronger than checking one row.
    const rows = await rowMetrics(page);
    expect(rows.length).toBeGreaterThan(1);
    // The reported case must be among them: `int | float` is Python's spelling
    // of jsii `number` and is what can escape its row. If the fixture stops
    // rendering it this spec is measuring nothing, which must fail rather than
    // pass silently — same guard as the first test in this file.
    expect(
      rows.map((row) => row.type),
      'no row rendered the reported `int | float` type',
    ).toContain('int | float');
    for (const row of rows) {
      expect(row.typeRight, `type overflowed its row: ${row.type}`)
        .toBeLessThanOrEqual(row.rowRight + 1);
    }
  });

  test('the type is a box that truncates with an ellipsis, not bare inline text', async ({ page }) => {
    await openPythonVariant(page);

    // The height assertion above is carried by the wrapper's `nowrap`; this
    // one is what the clamp on the type itself buys. Left inline, the type has
    // no client box to clip against and `text-overflow` is inert, so an
    // over-long type is chopped mid-glyph by the wrapper's clip instead of
    // ellipsized — measured by asking the browser what it computed.
    const clamp = await page.evaluate(() => {
      const type = Array.from(document.querySelectorAll('.props-table .member-type'))
        .find((el) => el.getBoundingClientRect().width > 0);
      if (!type) {
        return null;
      }
      const styles = getComputedStyle(type);
      return {
        display: styles.display,
        textOverflow: styles.textOverflow,
        // Zero for a non-replaced inline box; non-zero once it is a real box.
        clientWidth: (type as HTMLElement).clientWidth,
      };
    });
    expect(clamp, 'no visible type box on the page').not.toBeNull();
    expect(clamp!.textOverflow).toBe('ellipsis');
    expect(clamp!.display).not.toBe('inline');
    expect(clamp!.clientWidth).toBeGreaterThan(0);
  });

  test('the full type stays readable behind the clamp', async ({ page }) => {
    await openPythonVariant(page);

    const rows = await rowMetrics(page);
    const wide = rows.find((row) => row.type === 'int | float');
    expect(wide).toBeDefined();
    // Clipping is visual only, and the title is the language's own spelling —
    // not the jsii one a reader of the Python tab never sees.
    expect(wide!.title).toBe('int | float');
  });

  test('the clamp is released where the row stacks', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 900 });
    await openPythonVariant(page);

    const wrapped = await page.evaluate(() => {
      const type = Array.from(document.querySelectorAll('.props-table .member-type'))
        .find((el) => el.getBoundingClientRect().width > 0 && (el.textContent ?? '').includes('|'));
      return type ? getComputedStyle(type).whiteSpace : null;
    });
    // A stacked row has a line of its own, so an ellipsis there would hide
    // text that has room to render.
    expect(wrapped).toBe('normal');
  });
});
