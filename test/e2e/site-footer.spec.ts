import { expect, test } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Site-wide footer (SiteFooter.vue): community links plus the standard AWS
// legal line, mounted in the layout-bottom slot. The decisive requirement is
// that it renders on generated /api/** pages too — the native
// themeConfig.footer does not, because the default theme hides it on every
// page with a sidebar.
test.describe('site footer', () => {
  for (const [label, path] of [
    ['a generated API reference page', TOPIC_PAGE],
    ['a handwritten markdown page', '/versions.html'],
  ] as const) {
    test(`renders the legal line and community links on ${label}`, async ({ page }) => {
      await page.goto(path);

      const footer = page.locator('.site-footer');
      await expect(footer).toBeVisible();

      // Legal line: Privacy | Site terms | Cookie preferences | © <year>, ...
      await expect(
        footer.locator('a', { hasText: 'Privacy' }),
      ).toHaveAttribute('href', 'https://aws.amazon.com/privacy');
      await expect(
        footer.locator('a', { hasText: 'Site terms' }),
      ).toHaveAttribute('href', 'https://aws.amazon.com/terms/');
      await expect(
        footer.locator('a', { hasText: 'Cookie preferences' }),
      ).toBeVisible();
      await expect(footer.locator('.site-footer-copyright')).toHaveText(
        new RegExp(
          `© ${new Date().getFullYear()}, Amazon Web Services, Inc\\. or its affiliates\\. All rights reserved\\.`,
        ),
      );

      // Community links.
      const community = footer.getByRole('navigation', { name: 'Community' });
      await expect(community.locator('a').first()).toHaveAttribute(
        'href',
        'https://github.com/aws/aws-cdk',
      );
      await expect(community.locator('a').first()).toHaveText('GitHub');
      await expect(page.locator('.VPNavBar .VPSocialLinks')).toHaveCount(0);
      await expect(community.locator('a', { hasText: 'Slack' })).toHaveAttribute(
        'href',
        'https://cdk.dev/',
      );
      await expect(
        community.locator('a', { hasText: 'Stack Overflow' }),
      ).toHaveAttribute(
        'href',
        'https://stackoverflow.com/questions/tagged/aws-cdk',
      );
      await expect(
        community.locator('a', { hasText: 'AWS re:Post' }),
      ).toHaveAttribute(
        'href',
        'https://repost.aws/topics/TA9fmRfPodSgylDF8ojd9A_w/aws-cloud-development-kit-cdk',
      );

      await expect(
        footer.locator('a', { hasText: 'Third-party licenses' }),
      ).toHaveAttribute(
        'href',
        'https://github.com/cdklabs/awscdk-docs/blob/main/THIRD_PARTY_LICENSES',
      );
    });
  }
});
