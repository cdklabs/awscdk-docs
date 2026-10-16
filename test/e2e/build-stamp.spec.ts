import { expect, Page, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// The <head> build stamp is the one place a downstream republisher rewrites the documented version and the
// generated-at date. Jest can only pin the wiring; whether a
// rewritten stamp survives hydration — rather than being overwritten from the metadata chunk — is only observable
// in a real browser.
const VERSIONS_PAGE = '/versions.html';

const REPUBLISHED_VERSION = '9.87.65';
const REPUBLISHED_DATE = '2031-04-05T06:07:08.000Z';

/** Rewrite the stamp on every HTML document, exactly as the downstream Python script does. */
async function republish(
  page: Page,
  values: { version?: string; date?: string } = {},
): Promise<void> {
  const version = values.version ?? REPUBLISHED_VERSION;
  const date = values.date ?? REPUBLISHED_DATE;
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      return route.fallback();
    }
    const response = await route.fetch();
    const body = (await response.text())
      .replace(/(?<=<meta name="cdk-docs-version" content=")[^"]*/, version)
      .replace(/(?<=<meta name="cdk-docs-generated-at" content=")[^"]*/, date);
    return route.fulfill({ body, headers: { 'content-type': 'text/html' } });
  });
}

test.describe('downstream HTML build stamp', () => {
  test('every page carries exactly one stamp block with both values', async ({ page }) => {
    for (const url of [TOPIC_PAGE, VERSIONS_PAGE, '/']) {
      const response = await page.goto(url);
      const html = await response!.text();
      expect(html.match(/<!--CDK_DOCS_STAMP_BEGIN-->/g)).toHaveLength(1);
      expect(html).toMatch(/<meta name="cdk-docs-version" content="\d+\.\d+\.\d+">/);
      expect(html).toMatch(
        /<meta name="cdk-docs-generated-at" content="\d{4}-\d{2}-\d{2}T[\d:.]+Z">/,
      );
      // Outside the Vue app, so hydration never owns it.
      expect(html.indexOf('CDK_DOCS_STAMP_END')).toBeLessThan(html.indexOf('</head>'));
    }
  });

  test('the stamped version is the one the navbar badge shows', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const stamped = await page
      .locator('meta[name="cdk-docs-version"]')
      .getAttribute('content');
    await expect(page.locator('.VPNavBar .version-badge')).toHaveText(`v${stamped}`);
  });

  test('rewriting the stamp changes the badge the reader sees', async ({ page }) => {
    await republish(page);
    await page.goto(TOPIC_PAGE);
    // Only the meta was rewritten: the SSR'd badge still carries the build-time
    // version, so passing here means hydration adopted the stamp instead of the
    // copy in the metadata chunk.
    const badge = page.locator('.VPNavBar .version-badge');
    await expect(badge).toHaveText(`v${REPUBLISHED_VERSION}`);
    expect(await badge.getAttribute('aria-label')).toContain(REPUBLISHED_VERSION);
  });

  test('rewriting the stamp changes the report-issue version', async ({ page }) => {
    await republish(page);
    await page.goto(TOPIC_PAGE);
    const link = page.locator('.page-footer-links a', { hasText: 'Report an issue' });
    // The SSR'd href is the bare new-issue URL; the query string only appears
    // once hydration has run. Wait for it, or the parse below reads a href with
    // no body param.
    await expect(link).toHaveAttribute('href', /[?&]body=/);
    const body = new URL((await link.getAttribute('href'))!).searchParams.get('body');
    expect(body).toContain(`AWS CDK version: ${REPUBLISHED_VERSION}`);
  });

  test('rewriting the stamp changes the versions page last-updated date', async ({ page }) => {
    await republish(page);
    await page.goto(VERSIONS_PAGE);
    await expect(page.locator('.versions-generated-at')).toContainText('Last updated 2031-04-05');
  });

  test('blanking the stamped date drops the sentence rather than dangling a full stop', async ({
    page,
  }) => {
    // A republisher that rewrites the date to "" has removed it, which the
    // reader must not see as "Last updated .".
    await republish(page, { date: '' });
    await page.goto(VERSIONS_PAGE);
    const note = page.locator('.versions-generated-at');
    await expect(note).not.toContainText('Last updated');
    // The rest of the note is untouched.
    await expect(note).toContainText('Download version information as JSON');
    await expect(note).toContainText('end-of-support');
  });

  test('a client-side navigation keeps the rewritten value', async ({ page }) => {
    await republish(page);
    await page.goto(TOPIC_PAGE);
    await page.locator('.VPNavBar .version-badge').click();
    await expect(page).toHaveURL(/\/versions/);
    // Head tags are re-synced on route change; the stamp is not one of them.
    await expect(page.locator('.VPNavBar .version-badge')).toHaveText(`v${REPUBLISHED_VERSION}`);
  });
});
