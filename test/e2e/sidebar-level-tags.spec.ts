import { expect, test, type Locator, type Page } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// Construct level tags in the API sidebar: a construct entry
// is prefixed with a compact L1/L2/L3 tag so a reader tells `CfnQueue`
// from `Queue` without reading the name. Everything that is not a leveled
// construct renders no tag, and the tag never becomes part of the entry's
// identity — its link, its filter matching and its accessible name are all
// asserted here against the built site, not against the generator.
test.describe('sidebar construct level tags', () => {
  async function openSidebar(page: Page) {
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  function filterInput(page: Page) {
    return page.getByRole('textbox', { name: 'Filter navigation in the sidebar' });
  }

  const entry = (page: Page, fqnSuffix: string) =>
    page.locator(`.api-sidebar a.api-sidebar-link[href$="${fqnSuffix}"]`);

  // The glyph is stylesheet-generated from `data-level`, so read what the
  // browser actually paints rather than `textContent`, which is empty by design.
  const paintedLevel = (tag: Locator) =>
    tag.evaluate((el) => getComputedStyle(el, '::before').content.replace(/^"|"$/g, ''));

  test('an L1 and an L2 construct each render their level before the name', async ({ page }) => {
    await openSidebar(page);
    // Surface both the L1 and the L2 SQS queue construct at once.
    await filterInput(page).fill('Queue');

    const l2 = entry(page, '.aws_sqs.Queue');
    await expect(l2).toBeVisible();
    await expect(l2.locator('.api-sidebar-level')).toHaveAttribute('data-level', 'L2');
    expect(await paintedLevel(l2.locator('.api-sidebar-level'))).toBe('L2');
    await expect(l2.locator('.api-sidebar-name')).toHaveText('Queue');

    const l1 = entry(page, '.aws_sqs.CfnQueue');
    await expect(l1).toBeVisible();
    await expect(l1.locator('.api-sidebar-level')).toHaveAttribute('data-level', 'L1');
    expect(await paintedLevel(l1.locator('.api-sidebar-level'))).toBe('L1');
    await expect(l1.locator('.api-sidebar-name')).toHaveText('CfnQueue');

    // The tag is not link text: the link's visible text is the name alone, so
    // the accessible name (which starts with the name) contains it.
    await expect(l2).toHaveText('Queue');

    // The tag precedes the name in document order, so it reads as a prefix
    // rather than a suffix.
    const order = await l2.evaluate((el) => {
      const kids = [...el.children].map((c) => c.className);
      return kids;
    });
    expect(order[0]).toContain('api-sidebar-level');
  });

  test('the tag is subordinate to the name and hidden from assistive tech', async ({ page }) => {
    await openSidebar(page);
    await filterInput(page).fill('Queue');

    const l2 = entry(page, '.aws_sqs.Queue');
    const tag = l2.locator('.api-sidebar-level');
    await expect(tag).toHaveAttribute('aria-hidden', 'true');

    // Computed, not merely declared: the tag must render smaller than the
    // name it prefixes (the name is the target, the tag is metadata).
    const sizes = await l2.evaluate((el) => {
      const level = el.querySelector<HTMLElement>('.api-sidebar-level')!;
      const name = el.querySelector<HTMLElement>('.api-sidebar-name')!;
      return {
        tag: parseFloat(getComputedStyle(level).fontSize),
        name: parseFloat(getComputedStyle(name).fontSize),
      };
    });
    expect(sizes.tag).toBeLessThan(sizes.name);

    // The level reaches assistive tech through the accessible name, spelled
    // out and AFTER the visible name so label-in-name still holds.
    await expect(l2).toHaveAttribute('aria-label', 'Queue (L2 construct)');
  });

  test('no gutter is reserved on untagged entries, and the tag insets only its own name', async ({ page }) => {
    await openSidebar(page);
    await filterInput(page).fill('QueueProps');

    const struct = entry(page, '.aws_sqs.QueueProps');
    await expect(struct).toBeVisible();
    await expect(struct.locator('.api-sidebar-level')).toHaveCount(0);

    await filterInput(page).fill('Queue');
    const l2 = entry(page, '.aws_sqs.Queue');
    const other = entry(page, '.aws_sqs.QueueProps');
    const attrs = entry(page, '.aws_sqs.QueueAttributes');
    await expect(l2).toBeVisible();
    await expect(other).toBeVisible();
    await expect(attrs).toBeVisible();

    // The ROWS share a left edge: a tagged entry is not indented relative to
    // an untagged one.
    const [rowTagged, rowPlain] = await Promise.all([l2.boundingBox(), other.boundingBox()]);
    expect(Math.abs(rowTagged!.x - rowPlain!.x)).toBeLessThanOrEqual(1);

    // No gutter is RESERVED: two untagged siblings' names start at the same
    // x, so nothing empty is held open for a tag they do not have.
    const [namePlainA, namePlainB] = await Promise.all([
      other.locator('.api-sidebar-name').boundingBox(),
      attrs.locator('.api-sidebar-name').boundingBox(),
    ]);
    expect(Math.abs(namePlainA!.x - namePlainB!.x)).toBeLessThanOrEqual(1);

    // And the true consequence, asserted rather than glossed: a tagged
    // entry's own name IS inset, by the tag's width plus its margin. The
    // untagged rows are unaffected, which is the property that matters.
    const nameTagged = await l2.locator('.api-sidebar-name').boundingBox();
    expect(nameTagged!.x).toBeGreaterThan(namePlainA!.x + 8);
  });

  test('the tag is vertically centered on the name it prefixes', async ({ page }) => {
    await openSidebar(page);
    await filterInput(page).fill('Queue');
    const l2 = entry(page, '.aws_sqs.Queue');
    await expect(l2).toBeVisible();

    // The tag's box must sit on the name's FIRST line box, not float above
    // it: its height is the row's line box (14px * 1.5), which an `em`-based
    // height would get wrong by resolving against the tag's own 10px.
    const geom = await l2.evaluate((el) => {
      const level = el.querySelector<HTMLElement>('.api-sidebar-level')!.getBoundingClientRect();
      const name = el.querySelector<HTMLElement>('.api-sidebar-name')!;
      const firstLine = name.getClientRects()[0];
      return {
        tagCenter: level.y + level.height / 2,
        lineCenter: firstLine.y + firstLine.height / 2,
        tagHeight: level.height,
      };
    });
    expect(Math.abs(geom.tagCenter - geom.lineCenter)).toBeLessThanOrEqual(1);
    expect(geom.tagHeight).toBeCloseTo(21, 0);
  });

  // WCAG contrast of the tag, measured on the rendered site rather than
  // reasoned about from tokens. The chip's background is a translucent
  // `--vp-c-default-soft`, so the effective backdrop is only knowable by
  // compositing every rgba layer up to the first opaque ancestor -- which
  // is exactly the step that made `--vp-c-text-3` look acceptable on paper.
  async function tagContrast(page: Page, selector: string): Promise<number> {
    return page.evaluate((sel) => {
      const parse = (c: string): [number, number, number, number] => {
        const [r, g, b, a] = c.match(/[\d.]+/g)!.map(Number);
        return [r, g, b, a === undefined ? 1 : a];
      };
      const composite = (el: Element): [number, number, number] => {
        const layers: [number, number, number, number][] = [];
        for (let n: Element | null = el; n; n = n.parentElement) {
          const [r, g, b, a] = parse(getComputedStyle(n).backgroundColor);
          if (a > 0) layers.push([r, g, b, a]);
          if (a === 1) break;
        }
        let out: [number, number, number] = [255, 255, 255];
        for (const [r, g, b, a] of layers.reverse()) {
          out = [
            r * a + out[0] * (1 - a),
            g * a + out[1] * (1 - a),
            b * a + out[2] * (1 - a),
          ];
        }
        return out;
      };
      const lum = ([r, g, b]: [number, number, number]) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const tag = document.querySelector<HTMLElement>(sel)!;
      const [tr, tg, tb] = parse(getComputedStyle(tag).color);
      const a = lum([tr, tg, tb]);
      const b = lum(composite(tag));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }, selector);
  }

  test('the tag clears WCAG AA in both themes, resting and active', async ({ page }) => {
    await openSidebar(page);
    await filterInput(page).fill('Queue');
    await expect(entry(page, '.aws_sqs.Queue')).toBeVisible();
    await expect(entry(page, '.aws_sqs.CfnQueue')).toBeVisible();

    const base = '.api-sidebar a.api-sidebar-link';
    // The page under test IS the L2 Queue page, so that entry carries
    // `.active` for real -- no class is faked here. `CfnQueue` is the
    // resting arm, and the assertion below proves the two are distinct
    // states rather than the same rule measured twice.
    const active = `${base}[href$=".aws_sqs.Queue"] .api-sidebar-level`;
    const resting = `${base}[href$=".aws_sqs.CfnQueue"] .api-sidebar-level`;
    await expect(entry(page, '.aws_sqs.Queue')).toHaveClass(/active/);
    await expect(entry(page, '.aws_sqs.CfnQueue')).not.toHaveClass(/active/);

    // 10px/600 is not large text, so the bar is 4.5:1 and not 3:1. The tag
    // is `aria-hidden`, so nothing else conveys the level to a sighted
    // reader -- a dim chip is a lost distinction, not a soft one. The
    // active row is the harder case and the one that reads better than it
    // is: the chip's soft layer sits between the accent and the
    // brand-tinted row, so the accent loses contrast the row's own name
    // keeps.
    for (const dark of [false, true]) {
      await page.evaluate((d) => {
        document.documentElement.classList.toggle('dark', d);
      }, dark);
      expect(await tagContrast(page, resting)).toBeGreaterThanOrEqual(4.5);
      expect(await tagContrast(page, active)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the level is not filter-matchable: it is metadata, not identity', async ({ page }) => {
    await openSidebar(page);
    // "l2" must not surface every L2 construct — the filter reads the
    // canonical name only, which is what keeps group keys stable.
    await filterInput(page).fill('l2');
    await expect(entry(page, '.aws_sqs.Queue')).toHaveCount(0);
  });

  test('the tags are the same width even without tabular figures', async ({
    page,
  }) => {
    await openSidebar(page);
    await filterInput(page).fill('Queue');

    const l1 = entry(page, '.aws_sqs.CfnQueue');
    const l2 = entry(page, '.aws_sqs.Queue');
    await expect(l1).toBeVisible();
    await expect(l2).toBeVisible();

    // The tags must be equal-width because the BOX is sized, not because
    // the font happens to render tabular figures. Proving that requires
    // taking the font feature away: with `tabular-nums` reaching the
    // glyphs all three levels already measure identically, so a plain
    // width comparison would pass on content-sized boxes and prove
    // nothing. Disabling the feature reproduces the proportional-figures
    // widths a reader sees when Inter has not loaded, when the subset
    // lacks `tnum`, or when something upstream overrides
    // `font-feature-settings`.
    await page.addStyleTag({
      content: `.api-sidebar-level {
        font-variant-numeric: normal !important;
        font-feature-settings: 'tnum' 0 !important;
      }`,
    });

    const widths = await page.evaluate(() =>
      ['.aws_sqs.CfnQueue', '.aws_sqs.Queue'].map((suffix) => {
        const link = document.querySelector<HTMLElement>(
          `.api-sidebar a.api-sidebar-link[href$="${suffix}"]`,
        )!;
        const tag = link.querySelector<HTMLElement>('.api-sidebar-level')!;
        return { text: tag.dataset.level!, width: tag.getBoundingClientRect().width };
      }),
    );

    // The fixture is an aws-sns + aws-sqs build, which surfaces an L1
    // (CfnQueue) and an L2 (Queue) but no L3 pattern construct, so this
    // measures the two levels it actually has. The width comes from the
    // element box, which is level-independent, so covering L1 vs L2 covers
    // the mechanism L3 shares.
    expect(widths.map((w) => w.text).sort()).toEqual(['L1', 'L2']);
    expect(Math.abs(widths[0].width - widths[1].width)).toBeLessThanOrEqual(0.5);
  });
});
