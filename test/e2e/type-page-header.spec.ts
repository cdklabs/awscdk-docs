import { expect, test } from '@playwright/test';
import {
  CFN_QUEUE_PAGE,
  DEPRECATED_TYPE_PAGE,
  EXPERIMENTAL_TYPE_PAGE,
  QUEUE_GRANTS_PAGE,
  QUEUE_PAGE,
} from './fixture.js';

/** Computed foreground and background, as one comparable string. */
const PAINT = (el: Element) => {
  const style = getComputedStyle(el);
  return `${style.color}|${style.backgroundColor}`;
};

// Type page header presentation: the kind and stability chips, the page action
// pills, and the source link's affordance in the type-metadata block. All of
// it is only observable in a browser — a stylesheet assertion passes against
// rules that never reach the element, and the pills are teleported into the
// row by two components, which no unit test loads.
//
// Coverage limit: the fixture carries no L3 pattern construct, which is pinned
// at the docgen layer in `test/construct-pages.test.ts` and for contrast in
// `test/theme.test.ts`.
test.describe('type page header', () => {
  test('the kind and the stability are chips of the row under the title, not of the title', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const title = page.locator('h1');
    await expect(title).toHaveText('Queue');
    // Nothing is left in the H1 to lift off its own baseline.
    await expect(page.locator('h1 .VPBadge')).toHaveCount(0);
    await expect(page.locator('h1 .header-tag')).toHaveCount(0);

    const kind = page.locator('.type-header-row .type-chip-kind');
    const stability = page.locator('.type-header-row .type-chip-stability');
    await expect(kind).toHaveText('L2 construct');
    await expect(stability).toHaveText('Stable');

    // The row sits below the title, and the two chips share its first line.
    const titleBox = (await title.boundingBox())!;
    const kindBox = (await kind.boundingBox())!;
    const stabilityBox = (await stability.boundingBox())!;
    expect(kindBox.y).toBeGreaterThan(titleBox.y + titleBox.height - 1);
    expect(Math.abs(kindBox.y - stabilityBox.y)).toBeLessThanOrEqual(1);
    expect(stabilityBox.x).toBeGreaterThan(kindBox.x);
  });

  test('a chip edge is its own ink, so it is visible rather than a pale tint', async ({ page }) => {
    // `currentColor` makes the edge the ink, whose contrast against the chip
    // fill the unit suite already pins. Only a browser can confirm the edge
    // resolves to that ink rather than to a tint lower in the cascade.
    await page.goto(QUEUE_PAGE);
    const measured = await page.locator('.type-header-row .type-chip-kind').evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, border: style.borderTopColor, width: style.borderTopWidth };
    });
    expect(measured.border).toBe(measured.color);
    expect(parseFloat(measured.width)).toBeGreaterThanOrEqual(1);
  });

  test('an L1 chip and an L2 chip are different colors', async ({ page }) => {
    const colors: string[] = [];
    for (const url of [CFN_QUEUE_PAGE, QUEUE_PAGE]) {
      await page.goto(url);
      const chip = page.locator('.type-header-row .type-chip-kind');
      await expect(chip).toBeVisible();
      colors.push(await chip.evaluate(PAINT));
    }
    expect(colors[0]).not.toBe(colors[1]);
  });

  test('a Facade page chips itself Facade, in its own color', async ({ page }) => {
    // `buildFacadeIndex` classifies Facades and the module type list and sidebar
    // label them, so the page header chips `Facade` rather than a plain `Class`.
    await page.goto(QUEUE_GRANTS_PAGE);
    const chip = page.locator('.type-header-row .type-chip-kind');
    await expect(chip).toHaveText('Facade');
    const facade = await chip.evaluate(PAINT);

    await page.goto(QUEUE_PAGE);
    const level = await page.locator('.type-header-row .type-chip-kind').evaluate(PAINT);
    expect(facade).not.toBe(level);
  });

  test('the page actions are outlined pills at the trailing edge of the row', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator('.copy-markdown[data-ready]').waitFor();
    const copy = page.locator('.type-header-row .copy-markdown-main');
    const star = page.locator('.type-header-row .favorite-star-button');
    await expect(copy).toBeVisible();
    await expect(star).toBeVisible();

    // Copy Markdown before the star, both to the right of the chips.
    const chipBox = (await page.locator('.type-header-row .type-chip-kind').boundingBox())!;
    const copyBox = (await copy.boundingBox())!;
    const starBox = (await star.boundingBox())!;
    expect(copyBox.x).toBeGreaterThan(chipBox.x + chipBox.width);
    expect(starBox.x).toBeGreaterThan(copyBox.x);

    // A 2px brand edge rather than the hairline divider it replaces, whose
    // 1.7:1 against the page was the finding. Read as a resolved color so a
    // token rename cannot alibi it.
    const brand = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      probe.style.color = 'var(--vp-c-brand-1)';
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    });
    for (const pill of [copy, star]) {
      const style = await pill.evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: s.borderTopWidth, color: s.borderTopColor, radius: s.borderTopLeftRadius };
      });
      expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2);
      expect(style.color).toBe(brand);
      expect(parseFloat(style.radius)).toBeGreaterThanOrEqual(20);
    }
  });

  test('every control in the row shows a keyboard focus ring', async ({ page }) => {
    await page.goto(EXPERIMENTAL_TYPE_PAGE);
    await page.locator('.copy-markdown[data-ready]').waitFor();
    for (const selector of [
      '.type-breadcrumb a',
      '.type-header-row a.type-chip-stability',
      '.type-header-row .copy-markdown-main',
      '.type-header-row .copy-markdown-options',
      '.type-header-row .favorite-star-button',
    ]) {
      const control = page.locator(selector).first();
      const outline = await control.evaluate((el) => {
        (el as HTMLElement).focus();
        const style = getComputedStyle(el);
        return { width: style.outlineWidth, style: style.outlineStyle };
      });
      expect(outline.style, selector).not.toBe('none');
      expect(parseFloat(outline.width), selector).toBeGreaterThanOrEqual(2);
    }
  });

  test('the Copy Markdown menu still opens from its place in the row', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator('.copy-markdown[data-ready]').waitFor();
    const options = page.locator('.type-header-row .copy-markdown-options');
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    await options.click();
    await expect(options).toHaveAttribute('aria-expanded', 'true');
    const item = page.locator('.copy-markdown-menu [role="menuitem"]');
    await expect(item).toBeVisible();
    // The menu is positioned against its own control, so it opens inside the
    // viewport from the row rather than off the trailing edge.
    const box = (await item.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.keyboard.press('Escape');
    await expect(options).toHaveAttribute('aria-expanded', 'false');
  });

  test('the experimental chip links to the stability guide and keeps its own ink', async ({ page }) => {
    // The only interactive element the header adds. Its ink has to beat
    // VitePress's own `.vp-doc a`, which only a measurement can settle.
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(EXPERIMENTAL_TYPE_PAGE);
      const chip = page.locator('.type-header-row a.type-chip-stability');
      await expect(chip).toHaveText('Experimental');
      await expect(chip).toHaveAttribute('href', /stability/);
      const measured = await chip.evaluate((el) => {
        const probe = document.createElement('span');
        document.body.appendChild(probe);
        probe.style.color = 'var(--th-exp-text)';
        const token = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(el);
        return { color: style.color, token, decoration: style.textDecorationLine, border: style.borderTopColor };
      });
      expect(measured.color, scheme).toBe(measured.token);
      expect(measured.border, scheme).toBe(measured.token);
      expect(measured.decoration, scheme).toContain('underline');
    }
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('a deprecated type strikes its title, chips Deprecated and announces its name', async ({ page }) => {
    await page.goto(DEPRECATED_TYPE_PAGE);
    const title = page.locator('.vp-doc h1 .type-title-deprecated');
    await expect(title).toHaveText('Default');
    expect(await title.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('line-through');
    await expect(page.locator('.type-header-row .type-chip-deprecated')).toHaveText('Deprecated');
    await expect(page.locator('.type-deprecated-note')).toContainText('Deprecated:');
    // The struck title wraps the weighted span in one more element, which the
    // permalink's accessible name has to see through.
    await expect(page.locator('.vp-doc h1 a.header-anchor')).toHaveAttribute('aria-label', 'Permalink to "Default"');
  });

  test('the deprecation note reads at contrast in both themes', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(DEPRECATED_TYPE_PAGE);
      const measured = await page.locator('.type-deprecated-note').evaluate((el) => {
        const read = (node: Element) => {
          const style = getComputedStyle(node);
          return { color: style.color, background: style.backgroundColor };
        };
        const srgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const luminance = (value: string) => srgb(value)
          .map((c) => c / 255)
          .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        const note = read(el);
        const label = read(el.querySelector('.type-deprecated-label')!);
        const ratio = (fg: string, bg: string) => {
          const [a, b] = [luminance(fg), luminance(bg)];
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        return { body: ratio(note.color, note.background), label: ratio(label.color, note.background) };
      });
      // Body text owes 4.5:1; the label is the note's own heading and clears 7.
      expect(measured.body, scheme).toBeGreaterThanOrEqual(4.5);
      expect(measured.label, scheme).toBeGreaterThanOrEqual(7);
    }
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('the server-rendered header already holds its final height', async ({ page, request }) => {
    // The action pills teleport in after hydration. Docgen writes a
    // `typeHeader` frontmatter flag so neither component paints in its
    // fallback placement first, and the empty actions box carries their
    // height, so nothing below the header moves on load.
    const html = await (await request.get(QUEUE_PAGE)).text();
    expect(html).toContain('type-action-copy');
    expect(html).toContain('type-action-fav');
    expect(html).not.toContain('copy-markdown-main');
    expect(html).not.toContain('favorite-star-button');

    await page.goto(QUEUE_PAGE);
    const before = (await page.locator('.type-header').boundingBox())!;
    await page.locator('.copy-markdown[data-ready]').waitFor();
    await expect(page.locator('.type-header-row .favorite-star-button')).toBeVisible();
    const after = (await page.locator('.type-header').boundingBox())!;
    expect(after.height).toBeCloseTo(before.height, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test('the header closes with a divider between the row and the summary', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const header = page.locator('.type-header');
    const edge = await header.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.borderBottomWidth, style: style.borderBottomStyle };
    });
    expect(edge.style).toBe('solid');
    expect(parseFloat(edge.width)).toBeGreaterThanOrEqual(1);
  });

  test('at 375px the chips keep one line, the actions take the next, and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(QUEUE_PAGE);
    await page.locator('.copy-markdown[data-ready]').waitFor();

    const chip = (await page.locator('.type-header-row .type-chip-kind').boundingBox())!;
    const stability = (await page.locator('.type-header-row .type-chip-stability').boundingBox())!;
    const copy = (await page.locator('.type-header-row .copy-markdown-main').boundingBox())!;
    // Both chips on one row...
    expect(Math.abs(chip.y - stability.y)).toBeLessThanOrEqual(1);
    // ...and the actions below them.
    expect(copy.y).toBeGreaterThan(chip.y + chip.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('the metadata source link reads as a link at rest, the generated marker does not', async ({ page }) => {
    // The same affordance, on the metadata block.
    await page.goto(QUEUE_PAGE);
    const link = page.locator('.type-metadata a.type-metadata-source');
    await expect(link).toBeVisible();
    // Rest state, no hover: the anchor must carry an underline and must not
    // be the same color as the plain `Generated at build time` marker.
    const linkStyle = await link.evaluate((el) => {
      const style = getComputedStyle(el);
      return { decoration: style.textDecorationLine, color: style.color };
    });
    expect(linkStyle.decoration).toContain('underline');

    await page.goto(CFN_QUEUE_PAGE);
    const note = page.locator('.type-metadata span.type-metadata-generated');
    await expect(note).toBeVisible();
    const noteStyle = await note.evaluate((el) => {
      const style = getComputedStyle(el);
      return { decoration: style.textDecorationLine, color: style.color };
    });
    expect(noteStyle.decoration).not.toContain('underline');
    expect(noteStyle.color).not.toBe(linkStyle.color);
  });

  test('the metadata table has aligned row headers and values', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const block = page.locator('.type-metadata');
    await expect(block).toBeVisible();
    expect(await block.evaluate((el) => getComputedStyle(el).display)).toBe('table');

    const headers = block.locator('th.type-metadata-label[scope="row"]');
    expect(await headers.count()).toBeGreaterThanOrEqual(2);

    const geometry = await block.evaluate((el) => {
      const read = (sel: string) => Array.from(el.querySelectorAll(sel))
        .map((n) => n.getBoundingClientRect())
        .map((r) => ({ left: Math.round(r.left), top: Math.round(r.top) }));
      return { labels: read('.type-metadata-label'), values: read('.type-metadata-value') };
    });

    expect(geometry.labels.length).toBeGreaterThanOrEqual(2);
    expect(geometry.values).toHaveLength(geometry.labels.length);
    // Table layout keeps all row headers and values on shared column edges.
    expect(new Set(geometry.labels.map((b) => b.left)).size).toBe(1);
    expect(new Set(geometry.values.map((b) => b.left)).size).toBe(1);
    expect(geometry.values[0].left).toBeGreaterThan(geometry.labels[0].left);
    // Each value is on its own label's row, and the rows descend in order.
    for (let i = 0; i < geometry.labels.length; i++) {
      expect(Math.abs(geometry.values[i].top - geometry.labels[i].top)).toBeLessThanOrEqual(2);
      if (i > 0) {
        expect(geometry.labels[i].top).toBeGreaterThan(geometry.labels[i - 1].top);
      }
    }
  });

  test('the metadata table reflows at narrow widths and scales with the hierarchy bar', async ({ page }) => {
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(QUEUE_PAGE);
      const block = page.locator('.type-metadata');
      await expect(block).toBeVisible();

      // The table fits the viewport and never forces a horizontal page scroll.
      const box = await block.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // Below 640px the block scales with the hierarchy bar above it.
      const chainSize = await page.locator('.inheritance-chain').first()
        .evaluate((el) => getComputedStyle(el).fontSize);
      expect(await block.evaluate((el) => getComputedStyle(el).fontSize)).toBe(chainSize);
    }
  });

  for (const width of [1280, 375]) {
    test(`a metadata value uses the body typeface without a code pill at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // Browser-only, and it caught a real defect: VitePress styles prose code
      // as a tinted padded pill via `.vp-doc :not(pre,h1..h6) > code`, whose
      // specificity beat the block's own rule, so every linked value rendered as
      // a pill at 0.875em. A stylesheet assertion cannot see this -- the
      // declarations were present in the file and losing in the cascade.
      await page.goto(QUEUE_PAGE);
      const block = page.locator('.type-metadata');
      await expect(block).toBeVisible();

      const measured = await block.evaluate((el) => {
        const value = el.querySelector('.type-metadata-value a[href*="TemplateReference"]');
        const code = value.querySelector('code');
        const blockStyle = getComputedStyle(el);
        const labelStyle = getComputedStyle(el.querySelector('.type-metadata-label'));
        const valueCellStyle = getComputedStyle(value.closest('.type-metadata-value'));
        const rowBgs = Array.from(el.querySelectorAll('tr')).map((row) => getComputedStyle(row).backgroundColor);
        const blockSize = blockStyle.fontSize;
        const blockFamily = blockStyle.fontFamily;
        const cs = getComputedStyle(code);
        const as = getComputedStyle(value);
        return {
          blockSize,
          blockFamily,
          labelSize: labelStyle.fontSize,
          labelWeight: labelStyle.fontWeight,
          labelVerticalAlign: labelStyle.verticalAlign,
          valueVerticalAlign: valueCellStyle.verticalAlign,
          rowBgs,
          valueSize: as.fontSize,
          codeSize: cs.fontSize,
          codeFamily: cs.fontFamily,
          codeBg: cs.backgroundColor,
          codePad: cs.padding,
          codeColor: cs.color,
          anchorColor: as.color,
          anchorDecoration: as.textDecorationLine,
        };
      });

      // No chip of its own: the value IS the text.
      expect(measured.codeSize).toBe(measured.blockSize);
      expect(measured.valueSize).toBe(measured.blockSize);
      expect(measured.labelSize).toBe(measured.blockSize);
      expect(measured.labelWeight).toBe('500');
      expect(measured.labelVerticalAlign).toBe('baseline');
      expect(measured.valueVerticalAlign).toBe('baseline');
      expect(measured.rowBgs.length).toBeGreaterThanOrEqual(2);
      for (const background of measured.rowBgs) {
        expect(background).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      }
      expect(measured.codeFamily).toBe(measured.blockFamily);
      expect(measured.codeFamily.toLowerCase()).not.toContain('mono');
      expect(measured.codePad).toBe('0px');
      // Fully transparent, whatever notation the browser reports.
      expect(measured.codeBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      // The link affordance governs the text the reader sees, so the code takes
      // the anchor's color rather than the prose-code color.
      expect(measured.codeColor).toBe(measured.anchorColor);
      expect(measured.anchorDecoration).toContain('underline');
    });
  }

  test('the metadata link uses the AA-checked brand tone, not the default link tone', async ({ page }) => {
    // brand-2 is used rather than brand-1, which clears AA on `--vp-c-bg-soft`
    // only by a thin margin. Both are blue in this theme, so a string assertion on
    // the stylesheet cannot tell the two apart on the page -- and the rule
    // competes with VitePress's own `.vp-doc a` at equal specificity, where
    // only source order decides. This asserts the winner by measurement.
    await page.goto(QUEUE_PAGE);
    const colors = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const resolve = (v: string) => { probe.style.color = v; return getComputedStyle(probe).color; };
      const brand1 = resolve('var(--vp-c-brand-1)');
      const brand2 = resolve('var(--vp-c-brand-2)');
      probe.remove();
      const link = document.querySelector('.type-metadata-value a');
      return { brand1, brand2, link: getComputedStyle(link!).color };
    });
    expect(colors.brand1).not.toBe(colors.brand2);
    expect(colors.link).toBe(colors.brand2);
  });

  test('an L1 page shows the CloudFormation row and no L1 row', async ({ page }) => {
    await page.goto(CFN_QUEUE_PAGE);
    const labels = await page.locator('.type-metadata .type-metadata-label')
      .evaluateAll((els) => els.map((el) => el.textContent));
    expect(labels).toEqual(['CloudFormation', 'Source', 'Type last changed']);
    // The CloudFormation value is a real outbound link, not bare text.
    await expect(page.locator('.type-metadata-value a[href*="TemplateReference"]')).toBeVisible();
  });
});
