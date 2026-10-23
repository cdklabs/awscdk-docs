import { expect, test } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// Long method signatures on a type page. The header line of a member row is
// allowed to wrap — it holds the full signature, which cannot be truncated
// without hiding a parameter — but with 2+ languages each signature sits in a
// `.lang-variant` span whose `white-space: nowrap` (there to keep a PROPERTY's
// name and type together) made the whole signature one unbreakable line. A long
// one then ran past the content column and over the right-hand outline.
//
// The fixture has no S3 Bucket page, so the probe is the Queue page's Python
// variant: with the `@staticmethod` decorator and typed parameters, the
// `from_queue_attributes` factory is wider than the content column. Geometry is the
// only honest gate — a stylesheet assertion cannot say whether a line wrapped —
// and every measurement is scoped to the VISIBLE variant, because the page
// carries one hidden copy of each signature per enabled language.

/** Wide enough for the aside outline to be shown (the default theme hides it
 *  under 1280px), so an overflow has something to collide with. */
const VIEWPORT = { width: 1280, height: 900 };

interface SignatureMetric {
  /** Collapsed text of the visible signature. */
  readonly text: string;
  readonly height: number;
  readonly lineHeight: number;
  /** Right edge of the signature box and of the header line that holds it. */
  readonly right: number;
  readonly lineRight: number;
}

async function signatureMetrics(page: import('@playwright/test').Page): Promise<SignatureMetric[]> {
  return page.evaluate(() => {
    const out = [];
    for (const line of Array.from(document.querySelectorAll('.methods-table .member-line'))) {
      // The hidden language variants are `display: none`, so a zero-width box
      // is how the inactive copies are told apart from the shown one.
      const sig = Array.from(line.querySelectorAll('.member-signature'))
        .find((el) => el.getBoundingClientRect().width > 0);
      if (!sig) {
        continue;
      }
      const box = sig.getBoundingClientRect();
      out.push({
        text: (sig.textContent ?? '').replace(/\s+/g, ' ').trim(),
        height: box.height,
        lineHeight: parseFloat(getComputedStyle(sig).lineHeight),
        right: box.right,
        lineRight: line.getBoundingClientRect().right,
      });
    }
    return out;
  });
}

/** `page.goto` resolves on `load`, but `?lang=python` is applied during
 *  hydration — so every read has to wait for the active variant, or it can
 *  measure the canonical TypeScript row instead of the wide Python one. */
async function openPythonVariant(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${QUEUE_PAGE}?lang=python`);
  await expect(page.locator('.lang-tabs').first()).toHaveAttribute('data-active', 'python');
}

test.describe('long method signatures stay inside the content column', () => {
  test.use({ viewport: VIEWPORT });

  test('no signature reaches into the outline', async ({ page }) => {
    await openPythonVariant(page);

    const outline = page.locator('.VPDocAsideOutline.has-outline');
    await expect(outline).toBeVisible();
    const outlineBox = await outline.boundingBox();
    expect(outlineBox).not.toBeNull();

    const rows = await signatureMetrics(page);
    // Not a `count() > 0` guard: if the reported shape is missing, the fixture
    // has changed and this spec is measuring nothing, which must be a failure
    // rather than a silent pass. The struct-expanded factory is the wide probe.
    const wide = rows.find((row) => row.text.includes('from_queue_attributes('));
    expect(wide, 'no row rendered the `from_queue_attributes` signature').toBeDefined();
    // Wider than the content column by a margin: unwrapped, this signature's
    // right edge measured 1134px against a 960px row edge at this viewport, so
    // a pass here cannot be the row happening to fit.
    expect(wide!.text.length).toBeGreaterThan(90);

    for (const row of rows) {
      expect(row.right, `signature overflowed its row: ${row.text.slice(0, 60)}`)
        .toBeLessThanOrEqual(row.lineRight + 1);
      expect(row.right, `signature reached into the outline: ${row.text.slice(0, 60)}`)
        .toBeLessThan(outlineBox!.x);
    }
  });

  test('the wide signature wraps onto further lines rather than clipping', async ({ page }) => {
    await openPythonVariant(page);

    const rows = await signatureMetrics(page);
    const wide = rows.find((row) => row.text.includes('from_queue_attributes('));
    expect(wide).toBeDefined();
    // Staying inside the column by hiding text would also pass the geometry
    // check above. A wrapped signature is at least two lines tall; a clipped or
    // ellipsized one is exactly one.
    expect(wide!.height).toBeGreaterThan(wide!.lineHeight * 1.5);
    // And nothing is clipped: the browser was not asked to hide overflow.
    const overflow = await page.evaluate(() => {
      const sig = Array.from(document.querySelectorAll('.methods-table .member-signature'))
        .find((el) => el.getBoundingClientRect().width > 0);
      return sig ? getComputedStyle(sig).overflow : null;
    });
    expect(overflow).toBe('visible');
  });

  test('a short signature still sits on one line', async ({ page }) => {
    await openPythonVariant(page);

    const rows = await signatureMetrics(page);
    const short = rows.filter((row) => row.text.length < 40);
    expect(short.length).toBeGreaterThan(0);
    for (const row of short) {
      expect(row.height, `short signature broke onto a second line: ${row.text}`)
        .toBeLessThan(row.lineHeight * 1.5);
    }
  });
});
