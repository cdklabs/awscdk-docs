import { expect, test } from '@playwright/test';
import { apiSidebarAssetPath, QUEUE_PAGE } from './fixture.js';

// Language-aware sidebar labels. The e2e fixture is built with the
// production docgen.config.json, which enables ts + python, so the
// generated sidebar asset carries python label variants. These specs pin
// the multi-language invariants: the asset embeds
// per-language labels for the variant entries, an active display language
// relabels the sidebar IN PLACE (canonical links, no tree swap), and
// navigation stays fully working under a non-default language.
test.describe('sidebar labels on a multi-language build', () => {
  test('the generated sidebar asset carries python label variants', async ({ page }) => {
    // The skeleton names each section's chunk; leaf labels live in the chunks.
    // Type names are language-stable, so the variants sit on module-level
    // entries: a section folding several modules disambiguates its Overview
    // entries per module, and those labels vary by language.
    const skeleton = await page.request.get(apiSidebarAssetPath('sidebar'));
    expect(skeleton.ok()).toBe(true);
    const sections = (await skeleton.json()).flatMap((root: any) => root.items);
    const multi = sections.find((s: any) => s.modules?.includes('aws-cdk-lib.aws_s3'));
    expect(multi?.modules.length).toBeGreaterThan(1);
    const res = await page.request.get(`/api-sidebar/chunks/${multi.chunk}`);
    expect(res.ok()).toBe(true);
    const body = await res.text();
    // Variant entries embed per-language display labels…
    expect(body).toContain('"labels"');
    // …e.g. python module-style names appear as label variants.
    expect(body).toContain('aws_cdk');
    // Links stay canonical: no python-prefixed page tree is referenced.
    expect(body).not.toContain('/v2/modules/');
  });

  test('a non-default active language relabels in place with intact links', async ({ page }) => {
    // ?lang=python hydrates the shared language state to python on load.
    await page.goto(`${QUEUE_PAGE}?lang=python`);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();

    // The active page's leaf renders its canonical type name — type names
    // are language-stable, only module-level labels vary.
    const active = page.locator('.api-sidebar a.api-sidebar-link.active');
    // The NAME, not the whole link: a construct's link also carries its
    // level tag.
    await expect(active.locator('.api-sidebar-name')).toHaveText('Queue');

    // Sidebar navigation still works with canonical links: open the
    // auto-expanded Queue resource's 'Others' group, scoped to its subtree
    // (other branches carry their own hidden 'Others' groups).
    const queue = page
      .locator('.api-sidebar li.api-sidebar-item')
      .filter({ has: page.getByRole('button', { name: 'Queue', exact: true }) })
      .first();
    await queue.getByRole('button', { name: 'Others', exact: true }).first().click();
    await queue
      .locator('a.api-sidebar-link')
      .filter({ hasText: /^QueueProps$/ })
      .first()
      .click();
    // The URL stays on the canonical tree — python never rewrites the path.
    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sqs\.QueueProps\.html/);
    await expect(page.locator('.api-sidebar a.api-sidebar-link.active')).toHaveText('QueueProps');
  });
});

// Framework group headings are package-qualified module names.
test.describe('Framework section headings', () => {
  test('reads package-qualified module names, aws-cdk-lib first and constructs after the submodules', async ({ page }) => {
    await page.goto(QUEUE_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();

    // The Framework structural header's own group headings, in tree order.
    const framework = page
      .locator('li.api-sidebar-section')
      .filter({ hasText: 'Framework' })
      .first();
    const headings = await framework
      .locator(':scope > ul.api-sidebar-list > li.api-sidebar-item > button.api-sidebar-group > .api-sidebar-text')
      .allInnerTexts();
    const labels = headings.map((t) => t.trim());

    expect(labels.length).toBeGreaterThan(1);
    // Core reads as the bare package name, and leads.
    expect(labels[0]).toBe('aws-cdk-lib');
    expect(labels).not.toContain('Core');
    // Submodules are package-qualified, not service-style title case.
    expect(labels).toContain('aws-cdk-lib.assertions');
    expect(labels).not.toContain('Assertions');
    // `constructs` stays `constructs`, but the rank-1 pin is gone: it now
    // sorts after every `aws-cdk-lib.*` heading.
    expect(labels).toContain('constructs');
    const submodules = labels.filter((l) => l.startsWith('aws-cdk-lib.'));
    expect(submodules.length).toBeGreaterThan(0);
    expect(labels.indexOf('constructs')).toBeGreaterThan(labels.lastIndexOf(submodules[submodules.length - 1]));
    // Structural submodules surface no heading of their own.
    expect(labels).not.toContain('aws-cdk-lib.interfaces');
    expect(labels.filter((l) => l.endsWith('.mixins'))).toEqual([]);
  });
});
