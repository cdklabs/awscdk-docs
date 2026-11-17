import { expect, test, type Page } from '@playwright/test';
import { SNS_OVERVIEW_PAGE, SQS_OVERVIEW_PAGE } from './fixture.js';

// The module Types section is a list grouped by kind (ADR 2026-10-15-api-reference-pages, "Module type list").
// Entries wrap at any width and never run past the page body. Geometry is the only honest gate for that, so every
// measurement is taken in a browser, at each layout tier and density level.

/** The widths the layout tiers change at: phone, tablet, the tightest desktop column and a large screen. */
const WIDTHS = [375, 768, 1280, 1920];
const DENSITIES = ['compact', 'balanced', 'spacious'] as const;

/** A nested name far wider than a phone, modelled on `CfnCapability.EdiConfigurationProperty`. */
const LONG_NAME = 'CfnVeryLongResourceNameForTesting.EnormousConfigurationPropertyWithManyWordsInItsName';

async function open(page: Page, url: string, density: (typeof DENSITIES)[number], width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((level) => window.localStorage.setItem('cdk-docs-density', level), density);
  await page.goto(url);
  await page.locator('.type-list li').first().waitFor();
}

/**
 * Entries whose content runs past the page body, and whether the document scrolls sideways. A block-level entry is
 * always as wide as its container, so the content is measured: an entry is wide when its scroll width exceeds its
 * client width or when any line box of its name or link sits past the right edge of the page body.
 */
async function overflow(page: Page): Promise<{ wide: string[]; scrolls: boolean }> {
  return page.evaluate(() => {
    const body = document.querySelector('.vp-doc')!.getBoundingClientRect();
    const wide = Array.from(document.querySelectorAll('.type-list li'))
      .filter((li) => li.scrollWidth > li.clientWidth + 0.5
        || Array.from(li.querySelectorAll('a, code')).some((el) => (
          Array.from(el.getClientRects()).some((r) => r.right > body.right + 0.5)
        )))
      .map((li) => li.textContent ?? '');
    const root = document.documentElement;
    return { wide, scrolls: root.scrollWidth > root.clientWidth };
  });
}

for (const url of [SQS_OVERVIEW_PAGE, SNS_OVERVIEW_PAGE]) {
  test.describe(`type list on ${url}`, () => {
    for (const density of DENSITIES) {
      for (const width of WIDTHS) {
        test(`no entry overflows and the page does not scroll sideways at ${width}px, ${density}`, async ({ page }) => {
          await open(page, url, density, width);
          expect(await overflow(page)).toEqual({ wide: [], scrolls: false });
        });
      }
    }
  });
}

test.describe('type list structure', () => {
  test('is a real list, grouped under one heading per kind, each entry a link plus a kind tag and a summary', async ({ page }) => {
    await open(page, SQS_OVERVIEW_PAGE, 'balanced', 1280);
    const lists = page.locator('.vp-doc .type-list ul');
    expect(await lists.count()).toBeGreaterThan(1);
    await expect(lists.first()).toHaveAttribute('role', 'list');
    // The Types section keeps its anchor; each kind group has a heading of its own right before its list.
    await expect(page.locator('h2#module-types')).toBeVisible();
    const firstGroup = page.locator('.vp-doc h3[id^="module-types-"]').first();
    await expect(firstGroup).toBeVisible();
    const entry = page.locator('.type-list li').first();
    await expect(entry.locator('a')).toHaveCount(1);
    await expect(entry.locator('.type-kind')).not.toBeEmpty();
    expect((await entry.textContent())!.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(10);
  });

  test('copying a name yields exactly the name, with no break characters in it', async ({ page }) => {
    await open(page, SQS_OVERVIEW_PAGE, 'balanced', 1280);
    const names = await page.locator('.type-list li a code').evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    expect(names).toContain('Queue');
    for (const name of names) {
      expect(name).toMatch(/^[A-Za-z0-9_.]+$/);
    }
  });
});

test.describe('type list with a very long nested name', () => {
  for (const width of WIDTHS) {
    test(`wraps instead of overflowing at ${width}px`, async ({ page }) => {
      await open(page, SQS_OVERVIEW_PAGE, 'spacious', width);
      // Add an entry shaped like a generated one, with no break points in the name: if the stylesheet alone wraps the
      // worst case, a name with break points wraps too.
      await page.evaluate((name) => {
        const list = document.querySelector('.type-list ul')!;
        const li = document.createElement('li');
        li.id = 'long-name-entry';
        li.innerHTML = `<a href="#"><code>${name}</code></a> <span class="type-kind">Struct</span><br>Summary.`;
        list.appendChild(li);
      }, LONG_NAME);
      expect(await overflow(page)).toEqual({ wide: [], scrolls: false });
      // Wherever the name set on one line would be wider than the page body, it must occupy more than one line box.
      const { unwrapped, bodyWidth, lines } = await page.evaluate(() => {
        const code = document.querySelector('#long-name-entry code')!;
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = getComputedStyle(code).font;
        return {
          unwrapped: context.measureText(code.textContent ?? '').width,
          bodyWidth: document.querySelector('.vp-doc')!.getBoundingClientRect().width,
          lines: new Set(Array.from(code.getClientRects()).map((r) => Math.round(r.top))).size,
        };
      });
      if (unwrapped > bodyWidth) {
        expect(lines).toBeGreaterThan(1);
      }
    });
  }
});
