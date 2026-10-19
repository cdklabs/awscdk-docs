import { expect, test } from '@playwright/test';
import { CFN_QUEUE_PAGE, QUEUE_GRANTS_PAGE, QUEUE_PAGE } from './fixture.js';

// Kind badge presentation on type page headers, and the source link's
// affordance in the type-metadata block. Both are only observable in a
// browser: a stylesheet assertion passes against rules that never reach
// the element.
//
// Coverage limit: the fixture builds aws-sns + aws-sqs, so there is no L3
// pattern construct here. L3 is pinned at the docgen layer in
// `test/construct-pages.test.ts` and for contrast in `test/theme.test.ts`.
test.describe('API kind badge', () => {
  test('the kind badge sits on the H1 text baseline row', async ({ page }) => {
    // The badge sits alone on the row, so the `api-layout.css` override is
    // measured against the TITLE TEXT. Without it, VitePress's stock
    // `vertical-align: top` plus `translateY(-2px)` lifts the badge off the
    // line the name sits on.
    await page.goto(QUEUE_PAGE);
    const badge = page.locator('h1 .VPBadge');
    await expect(badge).toBeVisible();
    await expect(page.locator('h1')).toContainText('Queue');
    // The chip is gone from the title row entirely.
    await expect(page.locator('h1 .header-tag')).toHaveCount(0);

    // A fixed pixel threshold is the wrong instrument here: the badge box is
    // ~20px against an ~38px H1 line box, and `vertical-align: middle` aligns
    // the badge's middle with the parent's x-height middle rather than with the
    // center of the line box, so a CORRECTLY aligned badge still sits a few px
    // off center (measured: 3.25px). Asserting <= 2px failed on correct CSS,
    // and relaxing the number until it passed would have pinned nothing.
    //
    // So measure the override DIFFERENTIALLY: read the offset as shipped, then
    // put VitePress's stock declarations back inline and read it again. The
    // claim being tested is that the override improves the alignment, and this
    // is the only form of it that cannot be satisfied by the override's absence.
    // The title is a bare text node in the H1, so its box comes from a Range.
    const offsets = await badge.evaluate((el) => {
      const h1 = el.closest('h1')!;
      const textNode = Array.from(h1.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim().length > 0,
      )!;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const nameRect = () => range.getBoundingClientRect();
      const delta = () => {
        const b = el.getBoundingClientRect();
        const n = nameRect();
        return Math.abs((b.top + b.height / 2) - (n.top + n.height / 2));
      };
      const shipped = delta();
      // VitePress's own `.vp-doc h1 > .VPBadge` treatment, which the override
      // in api-layout.css exists to replace.
      const style = (el as HTMLElement).style;
      style.verticalAlign = 'top';
      style.transform = 'translateY(-2px)';
      const stock = delta();
      style.verticalAlign = '';
      style.transform = '';
      return { shipped, stock, restored: delta(), nameHeight: nameRect().height };
    });

    // Removing the override moves the badge measurably further off the row.
    // Measured on this fixture: 3.25px as shipped against 5.5px stock, and
    // deleting the override's three declarations makes `shipped` read 5.5 too,
    // which fails this line (verified by mutation, not assumed).
    expect(offsets.stock).toBeGreaterThan(offsets.shipped + 1.5);
    // And the shipped offset is a fraction of the line box, not a stagger.
    expect(offsets.shipped).toBeLessThan(offsets.nameHeight / 4);
    // The inline mutation was undone, so the two readings are comparable.
    expect(offsets.restored).toBeCloseTo(offsets.shipped, 1);
  });

  test('an L1 badge and an L2 badge are different colors', async ({ page }) => {
    const colors: string[] = [];
    for (const url of [CFN_QUEUE_PAGE, QUEUE_PAGE]) {
      await page.goto(url);
      const badge = page.locator('h1 .VPBadge');
      await expect(badge).toBeVisible();
      colors.push(await badge.evaluate((el) => {
        const style = getComputedStyle(el);
        return `${style.color}|${style.backgroundColor}`;
      }));
    }
    expect(colors[0]).not.toBe(colors[1]);
  });

  test('a Facade page badges itself Facade, in its own color', async ({ page }) => {
    // `buildFacadeIndex` classifies Facades and the index table and sidebar
    // label them, so the page header badges `Facade` rather than a plain
    // `Class`.
    await page.goto(QUEUE_GRANTS_PAGE);
    const badge = page.locator('h1 .VPBadge');
    await expect(badge).toHaveText('Facade');
    const facade = await badge.evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.color}|${style.backgroundColor}`;
    });

    await page.goto(QUEUE_PAGE);
    const level = await page.locator('h1 .VPBadge').evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.color}|${style.backgroundColor}`;
    });
    expect(facade).not.toBe(level);
  });

  test('the metadata source link reads as a link at rest, the generated marker does not', async ({ page }) => {
    // The same affordance, on the metadata block.
    await page.goto(QUEUE_PAGE);
    const link = page.locator('.type-metadata a.type-metadata-source');
    await expect(link).toBeVisible();
    // Rest state, no hover: the anchor must carry an underline and must not
    // be the same color as the plain `Generated code` marker.
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

  test('the metadata block is a two-column grid whose rows align', async ({ page }) => {
    // The layout requirement a stylesheet assertion cannot reach: every label
    // shares one column edge and each value sits beside its own label, so a
    // fourth row would need no new CSS. Measured, because `display: grid` in
    // the file does not prove the element is a grid on the page.
    await page.goto(QUEUE_PAGE);
    const block = page.locator('.type-metadata');
    await expect(block).toBeVisible();
    expect(await block.evaluate((el) => getComputedStyle(el).display)).toBe('grid');

    const geometry = await block.evaluate((el) => {
      const read = (sel: string) => Array.from(el.querySelectorAll(sel))
        .map((n) => n.getBoundingClientRect())
        .map((r) => ({ left: Math.round(r.left), top: Math.round(r.top) }));
      return { labels: read('.type-metadata-label'), values: read('.type-metadata-value') };
    });

    expect(geometry.labels.length).toBeGreaterThanOrEqual(2);
    expect(geometry.values).toHaveLength(geometry.labels.length);
    // One shared left edge for every label: that is the `max-content` column.
    expect(new Set(geometry.labels.map((b) => b.left)).size).toBe(1);
    // ...and one for every value, to the right of the labels'.
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

  test('a metadata value renders as plain text at the block size, not a code pill', async ({ page }) => {
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
      const blockSize = getComputedStyle(el).fontSize;
      const cs = getComputedStyle(code);
      const as = getComputedStyle(value);
      return {
        blockSize,
        codeSize: cs.fontSize,
        codeBg: cs.backgroundColor,
        codePad: cs.padding,
        codeColor: cs.color,
        anchorColor: as.color,
        anchorDecoration: as.textDecorationLine,
      };
    });

    // No chip of its own: the value IS the text.
    expect(measured.codeSize).toBe(measured.blockSize);
    expect(measured.codePad).toBe('0px');
    // Fully transparent, whatever notation the browser reports.
    expect(measured.codeBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // The link affordance governs the text the reader sees, so the code takes
    // the anchor's color rather than the prose-code color.
    expect(measured.codeColor).toBe(measured.anchorColor);
    expect(measured.anchorDecoration).toContain('underline');
  });

  test('the metadata link uses the AA-checked brand tone, not the default link tone', async ({ page }) => {
    // brand-2 is used rather than brand-1, which measures 4.22:1 on
    // `--vp-c-bg-soft`. Both are amber in this theme, so a string assertion on
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
