import { expect, test, type Page } from '@playwright/test';
import { QUEUE_GRANTS_PAGE } from './fixture.js';

// Nesting guide lines (docs/adr/2026-10-15-sidebar-navigation.md): every open
// group draws a vertical line along its child list at the center of its own
// caret, and the innermost group whose list holds the current page draws it
// 2px in the brand color. Each row draws its ancestors' guides from a
// zero-width `::before`, so the geometry is read from that pseudo-element's
// computed box and background, then compared with the real carets.
//
// The fixture entry `QueueGrants` sits at Services > SQS > Queue > Facades in
// the service style.
test.describe('sidebar nesting guide lines', () => {
  async function open(page: Page) {
    await page.addInitScript(() => {
      window.localStorage.setItem('cdk-docs-nav-style', 'service');
      window.localStorage.setItem('cdk-docs-consent', 'declined');
    });
    await page.goto(QUEUE_GRANTS_PAGE);
    await expect(page.locator('.api-sidebar-link.active')).toBeVisible();
  }

  interface Ancestor {
    name: string;
    caretCenter: number;
    activeParent: boolean;
  }

  interface Row {
    name: string;
    contentLeft: number;
    guides: number[];
    accent: { x: number; width: number; color: string } | null;
    ancestors: Ancestor[];
  }

  /** Every visible row with its guide x positions and the open groups above it. */
  async function measure(page: Page): Promise<{ rows: Row[]; brand: string }> {
    return page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--vp-c-brand-1)';
      document.querySelector('.api-sidebar')!.appendChild(probe);
      const brand = getComputedStyle(probe).color;
      probe.remove();

      const indent = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--density-sidebar-indent'),
      );
      const rows: Row[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        '.api-sidebar .api-sidebar-item > .api-sidebar-group, .api-sidebar .api-sidebar-item > .api-sidebar-link',
      )) {
        if (el.offsetParent === null) continue;
        const rect = el.getBoundingClientRect();
        const before = getComputedStyle(el, '::before');
        const contentLeft = rect.left + parseFloat(getComputedStyle(el).paddingLeft);
        const start = contentLeft + parseFloat(before.marginLeft);
        const count = Math.round(parseFloat(before.width) / indent);
        const guides = Array.from({ length: count }, (_, j) => start + j * indent + 8);

        let accent: Row['accent'] = null;
        const image = before.backgroundImage;
        if (image.startsWith('linear-gradient(')) {
          const color = image.match(/^linear-gradient\((rgba?\([^)]*\))/)![1];
          const x = parseFloat(before.backgroundPositionX.split(',')[0]);
          const width = parseFloat(before.backgroundSize.split(',')[0]);
          accent = { x: start + x + width / 2, width, color };
        }

        const ancestors: Ancestor[] = [];
        for (let li = el.parentElement!.parentElement?.closest<HTMLElement>('.api-sidebar-item');
          li;
          li = li.parentElement?.closest<HTMLElement>('.api-sidebar-item') ?? null) {
          const caret = li.querySelector<HTMLElement>(':scope > .api-sidebar-group > .api-sidebar-caret');
          if (!caret) continue;
          const box = caret.getBoundingClientRect();
          ancestors.push({
            name: li.querySelector(':scope > .api-sidebar-group > .api-sidebar-text')!.textContent!.trim(),
            caretCenter: box.left + box.width / 2,
            activeParent: li.hasAttribute('data-active-parent'),
          });
        }

        rows.push({ name: el.textContent!.trim(), contentLeft, guides, accent, ancestors });
      }
      return { rows, brand };
    });
  }

  test('each open group draws one guide at its caret center, left of its children', async ({ page }) => {
    await open(page);
    const { rows } = await measure(page);
    const grants = rows.find((row) => row.name === 'QueueGrants');
    expect(grants?.ancestors.map((a) => a.name)).toEqual(['Facades', 'Queue', 'SQS']);

    for (const row of rows) {
      // One guide per open group above the row, and no other.
      expect(row.guides).toHaveLength(row.ancestors.length);
      const centers = row.ancestors.map((a) => a.caretCenter).sort((a, b) => a - b);
      row.guides.forEach((x, i) => {
        expect(Math.abs(x - centers[i])).toBeLessThanOrEqual(1);
        expect(x).toBeLessThan(row.contentLeft);
      });
    }
  });

  test('only the group holding the current page is accented, 2px in the brand color', async ({ page }) => {
    await open(page);
    await expect(page.locator('li[data-active-parent]')).toHaveCount(1);
    const { rows, brand } = await measure(page);

    for (const row of rows) {
      const holder = row.ancestors.find((a) => a.activeParent);
      if (!holder) {
        expect(row.accent).toBeNull();
        continue;
      }
      expect(holder.name).toBe('Facades');
      expect(row.accent).not.toBeNull();
      expect(row.accent!.width).toBeCloseTo(2, 1);
      expect(row.accent!.color).toBe(brand);
      expect(Math.abs(row.accent!.x - holder.caretCenter)).toBeLessThanOrEqual(1);
    }
    expect(rows.some((row) => row.accent)).toBe(true);
  });

  test('the accent follows client-side navigation', async ({ page }) => {
    await open(page);
    await page.getByRole('textbox', { name: 'Filter navigation in the sidebar' }).fill('QueueProps');
    const target = page.locator('.api-sidebar a.api-sidebar-link[href$="aws_sqs.QueueProps.html"]').first();
    await expect(target).toBeVisible();
    await target.click();
    await expect(page).toHaveURL(/aws_sqs\.QueueProps\.html/);

    const holder = page.locator('li[data-active-parent]');
    await expect(holder).toHaveCount(1);
    await expect(
      holder.locator(':scope > .api-sidebar-list > .api-sidebar-item > a.api-sidebar-link.active'),
    ).toHaveCount(1);
  });

  test('guides do not change row geometry or the accessibility tree', async ({ page }) => {
    await open(page);
    const boxes = () =>
      page.locator('.api-sidebar .api-sidebar-group, .api-sidebar .api-sidebar-link').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return [r.top, r.height, r.width];
        }),
      );
    const sidebar = page.locator('.api-sidebar');
    const withGuides = await boxes();
    const treeWith = await sidebar.ariaSnapshot();

    await page.addStyleTag({
      content: '.api-sidebar-group::before, .api-sidebar-link::before { display: none !important; }',
    });
    expect(await boxes()).toEqual(withGuides);
    expect(await sidebar.ariaSnapshot()).toBe(treeWith);
  });

  test('guides stay visible in forced colors', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page);
    const image = await page
      .locator('.api-sidebar a.api-sidebar-link.active')
      .evaluate((el) => getComputedStyle(el, '::before').backgroundImage);
    expect(image).toContain('gradient');
  });
});
