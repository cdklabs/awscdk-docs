import { expect, test } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// An optional property shows a trailing `?` after its name, in the rows and in the "On this page" outline. The mark
// is display only: it is hidden from assistive technology (which hears "optional" for an input and "may be
// undefined" for an output), unselectable, out of the search index, and never part of an anchor.
// See docs/adr/2026-10-23-optional-prop-marker.md.
test.describe('optional property marker', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('an optional input and an optional output show the mark beside the name; an always-set property does not', async ({ page }) => {
    await page.goto(QUEUE_PAGE);

    // QueueProps.fifo is an optional input (Construct Props); Queue.deadLetterQueue an optional output (Properties).
    const input = page.locator('.member-row#props-queueprops-fifo');
    const output = page.locator('.member-row#deadletterqueue');
    // Queue.queueArn is always set.
    const required = page.locator('.member-row#queuearn');

    for (const [row, label] of [[input, 'optional'], [output, 'may be undefined']] as const) {
      const mark = row.locator('.member-line .member-optional:visible');
      await expect(mark).toHaveCount(1);
      // The visible `?` is hidden from assistive technology; the label stands in for it.
      await expect(mark.locator('[aria-hidden="true"]')).toHaveText('?');
      await expect(mark.locator('.member-optional-label')).toHaveText(label);
      // Display only: unselectable, so a copied name carries no `?`, and out of the search index.
      await expect(mark).toHaveCSS('user-select', 'none');
      await expect(mark).toHaveAttribute('data-pagefind-ignore', '');
      // The mark hugs the name: no gap between the name's right edge and the mark.
      const name = row.locator('.member-line .member-name:visible');
      const nameBox = (await name.boundingBox())!;
      const markBox = (await mark.locator('[aria-hidden="true"]').boundingBox())!;
      expect(Math.abs(markBox.x - (nameBox.x + nameBox.width))).toBeLessThanOrEqual(1);
      // The label is read, never painted.
      const labelBox = (await mark.locator('.member-optional-label').boundingBox())!;
      expect(labelBox.width).toBeLessThanOrEqual(1);
    }
    await expect(required.locator('.member-optional')).toHaveCount(0);

    // Every language variant carries the mark, not just TypeScript.
    const variants = await input.locator('.member-line .lang-variant').count();
    expect(variants).toBeGreaterThan(1);
    await expect(input.locator('.member-line .member-optional')).toHaveCount(variants);

    // Anchors and permalinks carry no mark.
    await expect(input.locator('.member-permalink')).toHaveAttribute('href', '#props-queueprops-fifo');
    await expect(input.locator('.member-permalink')).toHaveAttribute('aria-label', 'Permalink to fifo');
  });

  test('the outline marks the same members, from the same data', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const aside = page.locator('.VPDocAsideOutline');
    await expect(aside).toBeVisible();

    const entry = (href: string) => aside.locator(`a.outline-link[href="${href}"]`);
    for (const [href, label] of [['#props-queueprops-fifo', 'optional'], ['#deadletterqueue', 'may be undefined']] as const) {
      const mark = entry(href).locator('.outline-optional');
      await expect(mark.locator('[aria-hidden="true"]')).toHaveText('?');
      await expect(mark.locator('.outline-optional-label')).toHaveText(label);
      await expect(mark).toHaveCSS('user-select', 'none');
    }
    // The hover title is the bare name.
    await expect(entry('#props-queueprops-fifo')).toHaveAttribute('title', 'fifo');
    // An always-set property and a method carry no mark.
    await expect(entry('#queuearn').locator('.outline-optional')).toHaveCount(0);
    await expect(entry('#addtoresourcepolicy').locator('.outline-optional')).toHaveCount(0);

    // Row and outline agree member for member: the outline lists every row, so the marked rows and the marked
    // entries are the same set.
    const marked = await page.locator('.vp-doc .member-row[data-optional]').evaluateAll((rows) => rows.map((r) => r.id));
    const outlined = await aside.locator('a.outline-link:has(.outline-optional)').evaluateAll(
      (links) => links.map((l) => (l as HTMLAnchorElement).hash.slice(1)),
    );
    expect(marked.length).toBeGreaterThan(1);
    expect(outlined.sort()).toEqual(marked.sort());
  });

  test('clicking the mark in the outline still follows the entry', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator('.VPDocAsideOutline a.outline-link[href="#props-queueprops-fifo"] .outline-optional').click();
    await expect(page).toHaveURL(/#props-queueprops-fifo$/);
    await expect(page.locator('.member-row#props-queueprops-fifo')).toBeInViewport();
  });
});
