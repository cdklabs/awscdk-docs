import { expect, test } from '@playwright/test';
import { CFN_QUEUE_PAGE, QUEUE_PAGE } from './fixture.js';

// Page titles. A type page's H1 carries raw HTML: the weighted name span and
// the kind badge. VitePress infers a page title from the H1 with
// `shouldAllowHtml: false`, which strips the tags but keeps their inner text,
// so H1 markup reaches `<title>` and from there the Favorites list, which
// snapshots `page.title` when a page is starred. The frontmatter title is
// what prevents it, and it has to, because the badge is raw HTML in the H1
// too.
//
// These assertions run against the rendered page rather than the emitted
// markdown because the contamination happens inside VitePress's own title
// resolution: the unit test can pin the frontmatter that prevents it, but
// only a real build proves the resulting `<title>` is clean.
// These assertions match only the page-specific part of the title, not the
// site-wide suffix: the suffix is one shared config value that unrelated
// changes move, and coupling a per-page assertion to it means whichever
// change merges second reds `main` for a reason that has nothing to do with
// it. Anchoring at the start keeps the whole fails-first property — a
// contaminated "Queue  Source | …" does not match /^Queue \| /.
test.describe('page titles', () => {
  test('a construct page title is the bare type name, without H1 markup', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await expect(page).toHaveTitle(/^Queue \| /);
    // The badge is the H1's remaining raw HTML and its text is exactly what
    // inference would append; the source affordance is still present, in the
    // metadata block.
    await expect(page.locator('h1 .VPBadge')).toHaveText('L2 construct');
    await expect(page.locator('.type-metadata a.type-metadata-source')).toHaveText('aws-sqs/lib/queue.ts');
  });

  test('an L1 page title omits its badge and generated-code marker', async ({ page }) => {
    await page.goto(CFN_QUEUE_PAGE);
    await expect(page).toHaveTitle(/^CfnQueue \| /);
    await expect(page.locator('h1 .VPBadge')).toHaveText('L1 construct');
    await expect(page.locator('.type-metadata span.type-metadata-generated'))
      .toHaveText('Generated code');
  });

  test('a starred page is listed under its clean title', async ({ page }) => {
    // Favorites store the title at star time, so a contaminated
    // `page.title` would be captured verbatim into the sidebar entry.
    // Assert the exact text: `toContainText('Queue')` would
    // pass just as happily on "Queue  Source".
    await page.goto(QUEUE_PAGE);
    await page.locator('.favorite-star-button').click();
    await expect(page.locator('.favorites-section .favorites-link')).toHaveText('Queue');
  });
});
