import { expect, test } from '@playwright/test';

// The package overview is README-backed: the canonical core
// overview URL — the breadcrumb root of every aws-cdk-lib type page and
// the `Framework > Core > Overview` target — renders the library README,
// not an artificial index. And the hard-coded `API Reference` sidebar
// header above the generated tree is gone.
//
// Both are contracts of the BUILT, hydrated site: the static sidebar block
// only exists in the VitePress config, and the API tree only appears once
// the theme component has fetched it.
const CORE_OVERVIEW = '/v2/docs/aws-cdk-lib-readme.html';

test.describe('core overview page', () => {
  test('the canonical core overview URL renders the library README', async ({ page }) => {
    const response = await page.goto(CORE_OVERVIEW);
    // The page still EXISTS at this exact URL — deleting it would 404
    // every aws-cdk-lib type-page breadcrumb root.
    expect(response?.status()).toBeLessThan(400);

    // The README's own H1 is the page title, not a synthesized
    // `# aws-cdk-lib`.
    const h1 = page.locator('.vp-doc h1').first();
    await expect(h1).toContainText('AWS Cloud Development Kit');

    // README body, then the root-only sections, then the type list. Match
    // on the sections' fixed ids: a rendered VitePress heading also
    // contains its permalink anchor, so its text is never exactly the
    // heading string.
    await expect(page.locator('.vp-doc h2#module-submodules')).toHaveCount(1);
    await expect(page.locator('.vp-doc h2#module-types')).toHaveCount(1);
  });

  test('the API sidebar has no static "API Reference" header, and the tree still renders', async ({
    page,
  }) => {
    await page.goto(CORE_OVERVIEW);

    // The generated tree is still there: the `"/v2/"` sidebar key must
    // stay non-empty or VitePress drops the whole sidebar aside, and with
    // it this component.
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();

    // No group heading named "API Reference" anywhere in the rail.
    await expect(
      page.locator('.VPSidebarItem .text', { hasText: /^API Reference$/ }),
    ).toHaveCount(0);
  });
});
