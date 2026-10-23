import { expect, test } from '@playwright/test';
import { CFN_QUEUE_PAGE, SQS_OVERVIEW_PAGE, TOPIC_PAGE } from './fixture.js';

// Consolidated doc-footer contribution links (PageFooterLinks.vue): "Edit
// this page" + "Report an issue" rendered together in the
// doc-after slot. The report link is built client-side in onMounted from the
// live page context.
test.describe('doc footer contribution links', () => {
  test('renders both contribution links below the content', async ({ page }) => {
    await page.goto(SQS_OVERVIEW_PAGE);

    // Edit, report, and the Markdown twin every generated page carries.
    const footer = page.locator('.page-footer-links');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-link')).toHaveCount(3);
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
    // source file, so that file is the edit target — next to the report link
    // and the Markdown twin, never this repo's generated page.
    const footer = page.locator('.page-footer-links');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-link')).toHaveCount(3);
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
    // repository; the footer keeps the report link and the Markdown twin.
    const footer = page.locator('.page-footer-links');
    await expect(footer).toBeVisible();
    await expect(footer.locator('.footer-link')).toHaveCount(2);
    await expect(footer).not.toContainText('Edit this page');
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
});
