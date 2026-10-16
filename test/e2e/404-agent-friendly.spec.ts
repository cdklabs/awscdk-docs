import { expect, test } from '@playwright/test';

// Agent-friendly 404s. Two things are pinned here, because
// each can regress independently:
//
//  1. The STATUS CODE. A nonexistent path must answer 404, never 200
//     with the app shell — a 200 tells a crawler or an agent that every
//     path it invents exists. The site is a static build (GitHub Pages
//     serves `404.html` with a genuine 404, as does the static server
//     this suite runs against), so a config change that stopped emitting
//     `404.html`, or a server rewrite that fell back to `index.html`,
//     would silently turn this into a 200. Hence the explicit assertion
//     on the number rather than on `response.ok()`.
//
//  2. The BODY. The page must name concrete next steps and link only
//     targets that exist: each href is asserted, and each target is
//     then fetched and must answer 200 — a 404 page that points at
//     another 404 is worse than the stock one.
//
//     This suite runs at the default root `base` (`DOCS_BASE` unset,
//     `baseURL` has no path prefix), so it pins the paths and NOT
//     `withBase` itself: at root base a resolved href and a hardcoded
//     absolute one are byte-identical. Base-awareness is covered by
//     the unit tests in `test/links.test.ts`, which drive a non-root
//     `DOCS_BASE` directly.
test.describe('agent-friendly 404s', () => {
  const missing = '/v2/docs/aws-cdk-lib.aws_s3.NoSuchThing';

  test('a nonexistent path answers 404, not 200 with the app shell', async ({ page }) => {
    const response = await page.goto(missing);
    expect(response?.status()).toBe(404);
  });

  test('the 404 body names next steps and links only targets that exist', async ({
    page,
    baseURL,
  }) => {
    await page.goto(missing);

    await expect(page.locator('.not-found-title')).toContainText('does not exist');

    const links = page.locator('.not-found-link');
    await expect(links).toHaveCount(3);

    // Hrefs resolved against the suite's baseURL. This runs at the root
    // base, so it pins the three paths rather than withBase itself. No
    // fallback URL: the port is per-run, so a hardcoded one would silently
    // resolve against the wrong server.
    if (!baseURL) {
      throw new Error('baseURL is required: the e2e server runs on a per-run port');
    }
    const base = new URL(baseURL);
    for (const path of ['/v2/', '/versions.html', '/']) {
      await expect(
        page.locator(`.not-found-link[href="${new URL(path, base).pathname}"]`),
      ).toHaveCount(1);
    }

    // Every linked target must itself resolve — a 404 page that points
    // at another 404 is worse than the stock one.
    for (const path of ['/v2/', '/versions.html', '/']) {
      const target = await page.goto(path);
      expect(target?.status()).toBe(200);
    }
  });
});
