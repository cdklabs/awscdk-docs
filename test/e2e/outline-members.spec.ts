import { expect, test } from '@playwright/test';
import { QUEUE_PAGE, QUEUE_PROPS_PAGE } from './fixture.js';

// The "On this page" outline lists a type page's properties, methods and inlined construct props under their section
// headings. Members are rows, not headings, so these entries come from the member list docgen writes into the page's
// frontmatter.
test.describe('outline lists type members', () => {
  // The aside outline only shows on a wide viewport.
  test.use({ viewport: { width: 1440, height: 900 } });

  const outline = (page: import('@playwright/test').Page) => page.locator('.VPDocAsideOutline');

  test('a property and a method sit under their sections, linked to the member rows', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const aside = outline(page);
    await expect(aside).toBeVisible();

    const property = aside.locator('a.outline-link[href="#deadletterqueue"]');
    const method = aside.locator('a.outline-link[href="#addtoresourcepolicy"]');
    // An optional member's entry ends with the display-only mark and its spoken label (optional-marker.spec.ts).
    await expect(property).toHaveText('deadLetterQueue?may be undefined');
    // A method entry shows its parameter names after the name (docs/adr/2026-10-26-outline-method-parameters.md).
    await expect(method).toHaveText('addToResourcePolicy(statement)');

    // Each is nested under its own section's entry, not listed at the top level.
    const sectionOf = (href: string) =>
      aside.locator('li', { has: page.locator(`> a.outline-link[href="${href}"]`) });
    await expect(sectionOf('#properties').locator('a.outline-link[href="#deadletterqueue"]')).toHaveCount(1);
    await expect(sectionOf('#methods').locator('a.outline-link[href="#addtoresourcepolicy"]')).toHaveCount(1);

    // The anchors are the rows' own ids: no heading was added for a member.
    await expect(page.locator('.vp-doc .member-row#deadletterqueue')).toHaveCount(1);
    await expect(page.locator('.vp-doc .member-row#addtoresourcepolicy')).toHaveCount(1);
    await expect(page.locator('.vp-doc :is(h2,h3,h4,h5,h6)#addtoresourcepolicy')).toHaveCount(0);

    // The inlined construct props are listed too, under their own section entry and never at the top level.
    const prop = aside.locator('a.outline-link[href="#props-queueprops-fifo"]');
    await expect(prop).toHaveText('fifo?optional');
    await expect(sectionOf('#props-queueprops').locator('a.outline-link[href="#props-queueprops-fifo"]')).toHaveCount(1);
    await expect(page.locator('.vp-doc .member-row#props-queueprops-fifo')).toHaveCount(1);
    await expect(page.locator('.vp-doc :is(h2,h3,h4,h5,h6)#props-queueprops-fifo')).toHaveCount(0);
    // `deadLetterQueue` is both a construct prop and a property of the type: each sits under its own section, so
    // the prop's entry uses the props-based row id and the property's entry the plain one.
    await expect(sectionOf('#props-queueprops').locator('a.outline-link[href="#props-queueprops-deadletterqueue"]')).toHaveCount(1);
    await expect(sectionOf('#properties').locator('a.outline-link[href^="#props-queueprops-"]')).toHaveCount(0);
  });

  test('following a construct prop entry lands on its row and marks it active', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const link = outline(page).locator('a.outline-link[href="#props-queueprops-fifo"]');
    await link.click();
    await expect(page).toHaveURL(/#props-queueprops-fifo$/);
    await expect(page.locator('.member-row#props-queueprops-fifo')).toBeInViewport();
    await expect(link).toHaveClass(/\bactive\b/);
  });

  test('a page without a Construct Props section lists only its own members', async ({ page }) => {
    await page.goto(QUEUE_PROPS_PAGE);
    const aside = outline(page);
    await expect(aside).toBeVisible();
    await expect(aside.locator('a.outline-link[href="#fifo"]')).toHaveText('fifo?optional');
    await expect(aside.locator('a.outline-link[href^="#props-"]')).toHaveCount(0);
  });

  test('following a member entry lands on its row and marks it active', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const link = outline(page).locator('a.outline-link[href="#addtoresourcepolicy"]');
    await link.click();
    await expect(page).toHaveURL(/#addtoresourcepolicy$/);
    await expect(page.locator('.member-row#addtoresourcepolicy')).toBeInViewport();
    await expect(link).toHaveClass(/\bactive\b/);
  });

  test('scrolling to a member row marks its entry active', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await page.locator('.member-row#addtoresourcepolicy').evaluate((el) =>
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20),
    );
    await expect(outline(page).locator('a.outline-link[href="#addtoresourcepolicy"]')).toHaveClass(/\bactive\b/);
  });
});

// A method entry reads `name(a, b?, ...rest)`: parameter names only, a trailing `?` on an optional parameter, `...`
// before a variadic one, `()` when there are none. The marks are glyphs, so a screen reader is given words instead
// (docs/adr/2026-10-26-outline-method-parameters.md).
test.describe('outline method entries show parameters', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const outline = (page: import('@playwright/test').Page) => page.locator('.VPDocAsideOutline');

  test('a required, an optional and a variadic parameter each render their mark, and the text is names only', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const aside = outline(page);
    await expect(aside).toBeVisible();

    // `metric(metricName, props?)`: the optional mark is a visible `?` and a spoken "optional".
    const metric = aside.locator('a.outline-link[href="#metric"]');
    await expect(metric).toHaveText(/^metric\(metricName, props\?\s*optional\)$/);
    await expect(metric.locator('.outline-params [aria-hidden="true"]')).toHaveText(['?']);
    await expect(metric.locator('.outline-params .outline-optional-label')).toHaveText(['optional']);
    // The name computation pads a positioned span with spaces; the words are what matter.
    await expect(metric).toHaveAccessibleName(/^metric\(metricName, props\s+optional\s*\)$/);
    await expect(metric).toHaveAttribute('title', 'metric(metricName, props?)');

    // `grant(grantee, ...actions)`: the variadic mark is a visible `...` and a spoken "variadic".
    const grant = aside.locator('a.outline-link[href="#grant"]');
    await expect(grant.locator('.outline-params [aria-hidden="true"]')).toHaveText(['...']);
    await expect(grant.locator('.outline-params .outline-optional-label')).toHaveText(['variadic']);
    await expect(grant).toHaveAccessibleName(/^grant\(grantee,\s+variadic\s+actions\)$/);
    await expect(grant).toHaveAttribute('title', 'grant(grantee, ...actions)');

    // No type appears anywhere in a method entry.
    const entries = await aside.locator('li', { has: page.locator('> a.outline-link[href="#methods"]') })
      .locator('a.outline-link.outline-link-method').allTextContents();
    expect(entries.length).toBeGreaterThan(3);
    for (const text of entries) {
      expect(text).not.toMatch(/:|IGrantable|PolicyStatement|MetricOptions/);
    }
  });

  test('a method without parameters shows empty parentheses; a property shows no parentheses', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const aside = outline(page);
    await expect(aside.locator('a.outline-link[href="#tostring"]')).toHaveText('toString()');
    await expect(aside.locator('a.outline-link[href="#tostring"] .outline-optional-label')).toHaveCount(0);
    await expect(aside.locator('a.outline-link[href="#queuearn"]')).toHaveText('queueArn');
    await expect(aside.locator('a.outline-link[href="#queuearn"] .outline-params')).toHaveCount(0);
  });

  test('the parameter text is display only: the link target is the row anchor and the text sits outside the search body', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const aside = outline(page);
    const metric = aside.locator('a.outline-link[href="#metric"]');
    await metric.click();
    await expect(page).toHaveURL(/#metric$/);
    await expect(page.locator('.member-row#metric')).toBeInViewport();
    // The row keeps its id and permalink; nothing on the page gained a `metric(metricName` anchor.
    await expect(page.locator('.member-row#metric a.member-permalink[href="#metric"]')).toHaveCount(1);
    await expect(page.locator('[id*="("]')).toHaveCount(0);
    // Pagefind indexes the rendered article (`data-pagefind-body`); the aside outline is outside it.
    await expect(page.locator('[data-pagefind-body] .VPDocAsideOutline')).toHaveCount(0);
    await expect(page.locator('[data-pagefind-body]')).toHaveCount(1);
  });

  // WCAG 1.4.3 contrast of the parameter list, measured on the rendered site in both themes. The list is the content
  // the entry exists to show and the entry is at rest almost all the time, so the resting colour is the one that
  // counts; a quieter token than the name's failed this floor once (sidebar-level-tags.spec.ts measures the same way).
  async function paramsContrast(page: import('@playwright/test').Page, selector: string): Promise<number> {
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
          out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
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
      const el = document.querySelector<HTMLElement>(sel)!;
      const [r, g, b] = parse(getComputedStyle(el).color);
      const a = lum([r, g, b]);
      const bg = lum(composite(el));
      return (Math.max(a, bg) + 0.05) / (Math.min(a, bg) + 0.05);
    }, selector);
  }

  test('the parameter list meets 4.5:1 contrast at rest in both themes', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    const resting = '.VPDocAsideOutline a.outline-link[href="#metric"] .outline-params';
    await expect(page.locator(resting)).toBeVisible();
    for (const dark of [false, true]) {
      await page.evaluate((d) => {
        document.documentElement.classList.toggle('dark', d);
      }, dark);
      // The link's colour transitions over half a second after a theme switch; poll past it.
      await expect.poll(() => paramsContrast(page, resting)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
