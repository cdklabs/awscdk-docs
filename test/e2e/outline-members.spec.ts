import { expect, test } from '@playwright/test';
import { QUEUE_PAGE } from './fixture.js';

// The "On this page" outline lists a type page's properties and methods under their section headings. Members are
// rows, not headings, so these entries come from the member list docgen writes into the page's frontmatter.
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
    await expect(property).toHaveText('deadLetterQueue');
    await expect(method).toHaveText('addToResourcePolicy');

    // Each is nested under its own section's entry, not listed at the top level.
    const sectionOf = (href: string) =>
      aside.locator('li', { has: page.locator(`> a.outline-link[href="${href}"]`) });
    await expect(sectionOf('#properties').locator('a.outline-link[href="#deadletterqueue"]')).toHaveCount(1);
    await expect(sectionOf('#methods').locator('a.outline-link[href="#addtoresourcepolicy"]')).toHaveCount(1);

    // The anchors are the rows' own ids: no heading was added for a member.
    await expect(page.locator('.vp-doc .member-row#deadletterqueue')).toHaveCount(1);
    await expect(page.locator('.vp-doc .member-row#addtoresourcepolicy')).toHaveCount(1);
    await expect(page.locator('.vp-doc :is(h2,h3,h4,h5,h6)#addtoresourcepolicy')).toHaveCount(0);

    // The inlined construct props are another type's members and are not listed.
    await expect(aside.locator('a.outline-link[href^="#props-queueprops-"]')).toHaveCount(0);
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
