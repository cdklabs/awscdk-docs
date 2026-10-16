import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

// The AWS docs boot script owns the banner, the persisted choice and the preferences modal. This repo only
// provides the script tag, the page-identity meta tags and a footer link with the id the script binds to.
// Browser behavior is covered by test/e2e/cookie-consent.spec.ts.
describe('AWS cookie-consent boot script', () => {
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
  const footer = readFileSync(resolve(ROOT, 'docs/.vitepress/theme/SiteFooter.vue'), 'utf-8');

  test('the head loads awsdocs-boot.js from docs.aws.amazon.com, async and deferred', () => {
    expect(config).toMatch(
      /\[\s*"script",\s*\{\s*src:\s*"https:\/\/docs\.aws\.amazon\.com\/assets\/js\/awsdocs-boot\.js",\s*async:\s*"",\s*defer:\s*""\s*\}\s*\]/,
    );
  });

  test('the head carries the guide-name and service-name meta tags', () => {
    expect(config).toMatch(/\[\s*"meta",\s*\{\s*name:\s*"guide-name",\s*content:\s*"API Reference"\s*\}\s*\]/);
    expect(config).toMatch(
      /\[\s*"meta",\s*\{\s*name:\s*"service-name",\s*content:\s*"AWS Cloud Development Kit \(AWS CDK\)"\s*\}\s*\]/,
    );
  });

  test('the theme implements no banner or consent logic of its own', () => {
    expect(existsSync(resolve(ROOT, 'docs/.vitepress/theme/CookieBanner.vue'))).toBe(false);
    expect(footer).not.toMatch(/localStorage|document\.cookie/);
  });

  test('the footer offers the preferences link id but not the legal-zone container', () => {
    expect(footer).toContain('id="awsdocs-cookie-preferences-link"');
    expect(footer).not.toContain('awsdocs-legal-zone');
  });
});
