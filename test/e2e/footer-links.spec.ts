import { expect, test } from '@playwright/test';
import {
  CFN_QUEUE_PAGE,
  CONSTRUCT_LIBRARY_PAGE,
  SKILLS_PAGE,
  SNS_OVERVIEW_PAGE,
  SQS_OVERVIEW_PAGE,
  TOPIC_PAGE,
  VERSIONS_PAGE,
} from './fixture.js';

// Consolidated doc-footer contribution links (PageFooterLinks.vue): "Edit
// this page" + "Report an issue" rendered together in the
// doc-after slot. The report link is built client-side in onMounted from the
// live page context.
test.describe('doc footer contribution links', () => {
  test('renders both contribution links below the content', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    const footer = page.locator('.page-footer-links');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-link')).toHaveCount(2);
  });

  test('renders one contentinfo landmark and names the page actions navigation', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    await expect(page.getByRole('navigation', { name: 'Page actions' })).toBeVisible();
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
    await expect(page.locator('.VPDocFooter')).toHaveCount(0);
  });

  test('a README-backed page links its real upstream README', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    // This page's prose is the aws-sqs README upstream, resolved from the
    // jsii assembly at generate time and passed through frontmatter — not
    // this repo's docgen directory, which a reader cannot fix a typo in.
    const editLink = page.locator('.page-footer-links .footer-link', {
      hasText: 'Edit this page',
    });
    await expect(editLink).toBeVisible();
    await expect(editLink).toHaveAttribute(
      'href',
      'https://github.com/aws/aws-cdk/blob/HEAD/packages/aws-cdk-lib/aws-sqs/README.md',
    );
    await expect(editLink).toHaveAttribute('target', '_blank');
  });

  test('a type page links the upstream source file its docs come from', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    // A class page is rendered from the jsii docstrings in its declaring
    // source file, so that file is the edit target — next to the report link,
    // never this repo's generated page.
    const footer = page.locator('.page-footer-links');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-link')).toHaveCount(2);
    const editLink = footer.locator('.footer-link', { hasText: 'Edit this page' });
    await expect(editLink).toHaveAttribute(
      'href',
      'https://github.com/aws/aws-cdk/blob/HEAD/packages/aws-cdk-lib/aws-sns/lib/topic.ts',
    );
    await expect(editLink).toHaveAttribute('target', '_blank');
    await expect(footer.locator('.footer-link', { hasText: 'Report an issue' })).toBeVisible();
    await expect(page.locator('.page-footer-links a[href*="src/docgen"]')).toHaveCount(0);
  });

  test('a type page with no editable source renders no edit link at all', async ({ page }) => {
    await page.goto(CFN_QUEUE_PAGE);

    // An L1 page is built from generated code that is not in the upstream
    // repository; the footer keeps the report link.
    const footer = page.locator('.page-footer-links');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-link')).toHaveCount(1);
    await expect(footer).not.toContainText('Edit this page');
  });

  test('a hand-written page links its markdown file in this site repository', async ({ page }) => {
    await page.goto(SKILLS_PAGE);

    const footer = page.locator('.page-footer-links');
    await expect(footer.locator('.footer-link')).toHaveCount(2);
    const editLink = footer.locator('.footer-link', { hasText: 'Edit this page' });
    await expect(editLink).toHaveAttribute('href', 'https://github.com/cdklabs/awscdk-docs/edit/main/docs/skills.md');
    await expect(editLink).toHaveAttribute('target', '_blank');
  });

  test('a rewritten hand-written page links its source file, not its served path', async ({ page }) => {
    await page.goto(CONSTRUCT_LIBRARY_PAGE);

    const editLink = page.locator('.page-footer-links .footer-link', { hasText: 'Edit this page' });
    await expect(editLink).toHaveAttribute(
      'href',
      'https://github.com/cdklabs/awscdk-docs/edit/main/docs/aws-construct-library.md',
    );
  });

  test('the versions page renders no edit link and keeps the report link', async ({ page }) => {
    await page.goto(VERSIONS_PAGE);

    // The page lists live release data, so there is no file a reader could usefully edit.
    const footer = page.locator('.page-footer-links');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-link')).toHaveCount(1);
    await expect(footer).not.toContainText('Edit this page');
    await expect(footer.locator('.footer-link', { hasText: 'Report an issue' })).toBeVisible();
  });

  test('the report link opens a pre-filled new issue', async ({ page }) => {
    await page.goto(TOPIC_PAGE);

    const reportLink = page.locator('.page-footer-links .footer-link', {
      hasText: 'Report an issue',
    });
    await expect(reportLink).toBeVisible();
    await expect(reportLink).toHaveAttribute('target', '_blank');
    // Built client-side in onMounted, so the pre-filled query arrives after
    // hydration — poll until the issue URL carries its title/body params.
    await expect
      .poll(() => reportLink.getAttribute('href'))
      .toMatch(/github\.com\/cdklabs\/awscdk-docs\/issues\/new\?/);
  });

  test('the report link names the page, its live URL and the documentation label', async ({ page }) => {
    await page.goto(`${TOPIC_PAGE}#constructor`);

    const reportLink = page.locator('.page-footer-links .footer-link', { hasText: 'Report an issue' });
    await expect(reportLink).toHaveAttribute('href', /[?&]body=/);
    const query = new URL((await reportLink.getAttribute('href'))!).searchParams;
    expect(query.get('title')).toBe('Docs: Topic');
    expect(query.get('labels')).toBe('documentation');
    // The live address, fragment included, which only the browser knows.
    expect(query.get('body')).toContain(`- Page: ${page.url()}`);
    expect(page.url()).toContain('#constructor');
  });

  test('a client-side navigation points both links at the new page', async ({ page }) => {
    await page.goto(TOPIC_PAGE);
    const footer = page.locator('.page-footer-links');
    const reportLink = footer.locator('.footer-link', { hasText: 'Report an issue' });
    await expect(reportLink).toHaveAttribute('href', /[?&]body=/);
    await page.evaluate(() => {
      (window as unknown as { samePage: boolean }).samePage = true;
    });

    await page.locator(`.api-sidebar a.api-sidebar-link[href$="${SNS_OVERVIEW_PAGE}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${SNS_OVERVIEW_PAGE.replace(/\./g, '\\.')}$`));
    // The router swapped the page in; a full reload would have cleared the marker.
    expect(await page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage)).toBe(true);

    await expect(footer.locator('.footer-link', { hasText: 'Edit this page' })).toHaveAttribute(
      'href',
      'https://github.com/aws/aws-cdk/blob/HEAD/packages/aws-cdk-lib/aws-sns/README.md',
    );
    await expect
      .poll(async () => new URL((await reportLink.getAttribute('href'))!).searchParams.get('body'))
      .toContain(`- Page: ${page.url()}`);
    const title = new URL((await reportLink.getAttribute('href'))!).searchParams.get('title');
    expect(title).not.toBe('Docs: Topic');
    expect(title).toMatch(/^Docs: \S/);
  });

  test('clicking the report link opens the pre-filled issue form in a new tab', async ({ page, context }) => {
    const requested: string[] = [];
    // Stub GitHub so the test never reaches it.
    await context.route('https://github.com/**', (route) => {
      requested.push(route.request().url());
      return route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' });
    });
    await page.goto(TOPIC_PAGE);
    const reportLink = page.locator('.page-footer-links .footer-link', { hasText: 'Report an issue' });
    await expect(reportLink).toHaveAttribute('href', /[?&]body=/);

    const [tab] = await Promise.all([context.waitForEvent('page'), reportLink.click()]);
    await tab.waitForLoadState();

    const opened = new URL(tab.url());
    expect(`${opened.origin}${opened.pathname}`).toBe('https://github.com/cdklabs/awscdk-docs/issues/new');
    expect(opened.searchParams.get('title')).toBe('Docs: Topic');
    expect(requested).toEqual([tab.url()]);
    // The docs page stays where it was.
    await expect(page).toHaveURL(new RegExp(`${TOPIC_PAGE.replace(/\./g, '\\.')}$`));
  });
});
