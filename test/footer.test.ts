import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

// Site-wide footer: community links plus the standard AWS
// legal line, rendered through the layout-bottom slot so it also appears
// on the generated /api/** pages (the default theme hides the native
// themeConfig.footer on every page with a sidebar).
describe('site footer', () => {
  const footer = readFileSync(resolve(THEME_DIR, 'SiteFooter.vue'), 'utf-8');
  const flatFooter = footer.replace(/\s+/g, ' ');
  const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
  const config = readFileSync(
    resolve(ROOT, 'docs/.vitepress/config.mts'),
    'utf-8',
  );

  test('mounts through the layout-bottom slot so it renders on all layouts', () => {
    expect(entry).toContain('import SiteFooter from "./SiteFooter.vue"');
    expect(entry).toMatch(/"layout-bottom":\s*\(\)\s*=>\s*\[h\(SiteFooter\), h\(BackToTop\)\]/);
  });

  test('the native themeConfig.footer is gone (hidden on sidebar pages anyway)', () => {
    expect(config).not.toMatch(/footer:\s*{/);
  });

  test('legal line: third-party licenses link to the generated file in the repository', () => {
    expect(footer).toContain('href="https://github.com/cdklabs/awscdk-docs/blob/main/THIRD_PARTY_LICENSES"');
    expect(flatFooter).toContain('>Third-party licenses</a>');
    expect(config).not.toContain('Released under the Apache-2.0 License.');
  });

  test('legal line: Privacy and Site terms link to the AWS pages', () => {
    expect(footer).toContain('href="https://aws.amazon.com/privacy"');
    expect(footer).toContain('href="https://aws.amazon.com/terms/"');
    expect(flatFooter).toContain('>Privacy</a>');
    expect(flatFooter).toContain('>Site terms</a>');
  });

  test('legal line: cookie preferences carries the id the AWS docs boot script binds', () => {
    expect(flatFooter).toContain('>Cookie preferences</a>');
    expect(footer).toContain('id="awsdocs-cookie-preferences-link"');
    expect(footer).toMatch(/id="awsdocs-cookie-preferences-link"[^>]*@click\.prevent/s);
    expect(footer).not.toContain('TBD');
  });

  test('legal line: copyright year is computed, not hard-coded', () => {
    expect(footer).toContain('new Date().getFullYear()');
    expect(flatFooter).toContain(
      '© {{ year }}, Amazon Web Services, Inc. or its affiliates. All rights reserved.',
    );
    expect(footer).not.toContain('© 2026');
  });

  test.each([
    ['GitHub', 'https://github.com/aws/aws-cdk'],
    ['Slack', 'https://cdk.dev/'],
    ['Stack Overflow', 'https://stackoverflow.com/questions/tagged/aws-cdk'],
    [
      'AWS re:Post',
      'https://repost.aws/topics/TA9fmRfPodSgylDF8ojd9A_w/aws-cloud-development-kit-cdk',
    ],
  ])('community link %s points at %s', (text, link) => {
    expect(footer).toContain(`text: "${text}"`);
    expect(footer).toContain(`link: "${link}"`);
  });

  test('GitHub leads the community row, as text rather than a mark', () => {
    const order = [...footer.matchAll(/text: "([^"]+)"/g)].map((m) => m[1]);
    expect(order[0]).toBe('GitHub');
    expect(footer).not.toMatch(/octocat|<svg/i);
  });

  test('external links open in a new tab without a referrer', () => {
    // Matches the existing PageFooterLinks convention (noreferrer
    // implies noopener).
    const anchors = footer.match(/<a[^>]*href="https:[^>]*>/gs) ?? [];
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noreferrer"');
    }
  });

  test('offsets the fixed sidebar so /api/** pages do not cover the footer', () => {
    expect(footer).toContain('useSidebar');
    expect(footer).toContain('has-sidebar');
    expect(footer).toContain('--vp-sidebar-width');
  });
});
