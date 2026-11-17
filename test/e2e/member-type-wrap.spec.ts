import { expect, test } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// Long property types on a member row. The type is part of the member contract
// and appears nowhere else in the row, so a type wider than its row wraps —
// at a space, or after a dot the renderer follows with a `<wbr>` — instead of
// clipping to an ellipsis or running past the content column.
//
// Geometry is the only honest gate here: a stylesheet assertion cannot say
// whether a browser actually broke the line. Every measurement is scoped to
// the VISIBLE variant, because the page carries one hidden copy of the row's
// name and type per enabled language and a page-wide locator would happily
// measure a hidden one.

const CFN_TOPIC_PAGE = '/v2/docs/aws-cdk-lib.aws_sns.CfnTopic.html';

/** The widths the layout tiers change at: phone, tablet, the tightest desktop column and a large screen. */
const WIDTHS = [375, 768, 1280, 1920];

/** Python's spelling of a list of a union: the widest type on the fixture's L1 pages. */
const WIDE_PYTHON_TYPE = 'typing.Union[IResolvable, typing.List[typing.Union[IResolvable, LoggingConfigProperty]]]';

interface TypeMetric {
  /** Collapsed text of the visible type. */
  readonly text: string;
  /** How many line boxes the type occupies. */
  readonly lines: number;
  /** Text wider than the box: a clip. */
  readonly clipped: boolean;
  readonly textOverflow: string;
  readonly hasTitle: boolean;
  readonly right: number;
  readonly rowRight: number;
  readonly docRight: number;
}

async function typeMetrics(page: import('@playwright/test').Page): Promise<TypeMetric[]> {
  return page.evaluate(() => {
    const doc = document.querySelector('.vp-doc')!.getBoundingClientRect();
    const out = [];
    for (const line of Array.from(document.querySelectorAll('.member-list .member-line'))) {
      // Hidden language variants are `display: none`, so a zero-width box is
      // how the inactive copies are told apart from the shown one.
      const type = Array.from(line.querySelectorAll('.member-type'))
        .find((el) => el.getBoundingClientRect().width > 0);
      if (!type) {
        continue;
      }
      const box = type.getBoundingClientRect();
      // Line boxes, not inline fragments: a type is several anchors and punctuation spans on one line.
      const tops = new Set(Array.from(type.getClientRects()).map((r) => Math.round(r.top)));
      out.push({
        text: (type.textContent ?? '').replace(/\s+/g, ' ').trim(),
        lines: tops.size,
        clipped: type.scrollWidth > type.clientWidth + 1,
        textOverflow: getComputedStyle(type).textOverflow,
        hasTitle: type.hasAttribute('title'),
        right: box.right,
        rowRight: line.getBoundingClientRect().right,
        docRight: doc.right,
      });
    }
    return out;
  });
}

/** `page.goto` resolves on `load`, but `?lang=` is applied during hydration, so every read waits for the variant. */
async function openVariant(page: import('@playwright/test').Page, path: string, lang: string): Promise<void> {
  await page.goto(`${path}?lang=${lang}`);
  await expect(page.locator('.lang-tabs').first()).toHaveAttribute('data-active', lang);
}

test.describe('long property types', () => {
  // TypeScript is the default variant and the one whose nested-type names
  // carry a `<wbr>`; Python has the widest type; Java has the generic shape.
  for (const lang of ['python', 'ts', 'java']) {
    for (const width of WIDTHS) {
      test(`every ${lang} type stays inside its row at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openVariant(page, CFN_TOPIC_PAGE, lang);

        const types = await typeMetrics(page);
        expect(types.length).toBeGreaterThan(0);
        if (lang === 'python') {
          // The reported shape must be among them: if the fixture stops rendering
          // it this spec is measuring nothing, which must fail rather than pass.
          expect(types.map((t) => t.text), 'the widest fixture type is missing').toContain(WIDE_PYTHON_TYPE);
        }
        for (const type of types) {
          expect(type.right, `type ran past its row: ${type.text}`).toBeLessThanOrEqual(type.rowRight + 1);
          expect(type.right, `type ran past the content column: ${type.text}`).toBeLessThanOrEqual(type.docRight + 1);
          expect(type.clipped, `type is clipped: ${type.text}`).toBe(false);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }
  }

  test('a type wider than its row wraps onto more lines, not into an ellipsis', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openVariant(page, CFN_TOPIC_PAGE, 'python');

    const wide = (await typeMetrics(page)).find((t) => t.text === WIDE_PYTHON_TYPE);
    expect(wide).toBeDefined();
    // 88 mono characters do not fit the 576px desktop column, so the type
    // needs a second line. An ellipsis would keep it on one.
    expect(wide!.lines).toBeGreaterThan(1);
    expect(wide!.textOverflow).not.toBe('ellipsis');
    // Nothing hides behind the text, so the span carries no title to repeat it.
    expect(wide!.hasTitle).toBe(false);
  });

  // The hang applies in both row shapes: beside the name at 1280px, and in
  // the stacked layout at 375px, where the type sits on its own line.
  for (const width of [375, 1280]) {
    test(`a wrapped type hangs its continuation lines in from the name column at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openVariant(page, CFN_TOPIC_PAGE, 'python');

      const rows = await page.evaluate((wideText) => {
        const out = [];
        for (const line of Array.from(document.querySelectorAll('.props-table .member-line'))) {
          const name = Array.from(line.querySelectorAll('.member-name'))
            .find((el) => el.getBoundingClientRect().width > 0);
          const type = Array.from(line.querySelectorAll('.member-type'))
            .find((el) => el.getBoundingClientRect().width > 0);
          if (!name || !type) {
            continue;
          }
          const rects = Array.from(type.getClientRects());
          const firstTop = Math.round(rects[0].top);
          const continuation = rects.filter((r) => Math.round(r.top) !== firstTop);
          out.push({
            wide: (type.textContent ?? '').replace(/\s+/g, ' ').trim() === wideText,
            nameLeft: name.getBoundingClientRect().left,
            lineLeft: line.getBoundingClientRect().left,
            typeLeft: Math.min(...rects.map((r) => r.left)),
            continuationLeft: continuation.length ? Math.min(...continuation.map((r) => r.left)) : null,
          });
        }
        return out;
      }, WIDE_PYTHON_TYPE);
      const wide = rows.find((row) => row.wide);
      expect(wide?.continuationLeft, 'the wide type did not wrap').not.toBeNull();
      // The second line starts about two characters in, so a reader scanning
      // the name column does not meet type text at the same edge.
      expect(wide!.continuationLeft! - wide!.lineLeft).toBeGreaterThanOrEqual(12);
      expect(wide!.continuationLeft! - wide!.lineLeft).toBeLessThanOrEqual(24);
      for (const row of rows) {
        // The first line is unchanged: every name still starts at the row's edge.
        expect(row.nameLeft).toBeCloseTo(row.lineLeft, 0);
        // The negative indent never pushes a first line into the gutter.
        expect(row.typeLeft).toBeGreaterThanOrEqual(row.lineLeft - 1);
      }
    });
  }

  test('a qualified name wider than the row breaks after its dot, not inside a word', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await openVariant(page, CFN_TOPIC_PAGE, 'ts');

    // No fixture type is a single token wider than the 327px column, so the
    // cases are written into a visible type span in the renderer's own markup:
    // a linked nested-type name with a `<wbr>` after its dot.
    const measure = (html: string) => page.evaluate((markup) => {
      const type = Array.from(document.querySelectorAll('.member-list .member-type'))
        .find((el) => el.getBoundingClientRect().width > 0);
      if (!type) {
        return null;
      }
      type.innerHTML = markup;
      // The first characters of every line box after the first.
      const starts: string[] = [];
      const range = document.createRange();
      const walker = document.createTreeWalker(type, NodeFilter.SHOW_TEXT);
      let lastTop: number | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0) {
            continue;
          }
          if (lastTop !== null && rect.top > lastTop + 1) {
            starts.push(text.slice(i, i + 12));
          }
          lastTop = rect.top;
        }
      }
      const doc = document.querySelector('.vp-doc')!.getBoundingClientRect();
      return { starts, overflow: type.getBoundingClientRect().right - doc.right };
    }, html);

    // 42 characters do not fit the column; the 30 after the dot do, so the dot
    // is the break and the word stays whole.
    const dotted = await measure('<a class="sig-type" href="#">CfnRegistry.<wbr>DiscoveryConfigurationProperty</a>');
    expect(dotted, 'no visible type span on the page').not.toBeNull();
    expect(dotted!.starts).toEqual(['DiscoveryCon']);
    expect(dotted!.overflow).toBeLessThanOrEqual(1);

    // A word wider than the whole column still breaks after the dot first, and
    // then falls back to the page's `overflow-wrap` rather than widening the row.
    const oversized = await measure(
      '<a class="sig-type" href="#">CfnRegistry.<wbr>CustomMetadataSchemaConfigurationProperty</a>',
    );
    expect(oversized!.starts[0]).toBe('CustomMetada');
    expect(oversized!.overflow).toBeLessThanOrEqual(1);
  });

  test('a short union row is the same height as a single-token row', async ({ page }) => {
    // Wrapping is for types that need it: `int | float` fits beside its name
    // on a 700px viewport and must not grow the row.
    await page.setViewportSize({ width: 700, height: 900 });
    await openVariant(page, QUEUE_PAGE, 'python');

    const rows = await page.evaluate(() => {
      const out = [];
      for (const line of Array.from(document.querySelectorAll('.props-table .member-line'))) {
        const type = Array.from(line.querySelectorAll('.member-type'))
          .find((el) => el.getBoundingClientRect().width > 0);
        if (type) {
          out.push({
            type: (type.textContent ?? '').replace(/\s+/g, ' ').trim(),
            height: line.getBoundingClientRect().height,
            lineHeight: parseFloat(getComputedStyle(line).lineHeight),
          });
        }
      }
      return out;
    });
    const wide = rows.find((row) => row.type === 'int | float');
    expect(wide, 'no row rendered the reported `int | float` type').toBeDefined();
    const single = rows.filter((row) => row.type.length > 0 && !row.type.includes(' '));
    expect(single.length).toBeGreaterThan(0);
    const baseline = Math.min(...single.map((row) => row.height));
    // Half a line-height of slack: a row that broke onto a second line grows
    // by a whole one.
    expect(wide!.height).toBeLessThan(baseline + wide!.lineHeight / 2);
  });
});
