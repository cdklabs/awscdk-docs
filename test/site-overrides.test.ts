import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { SITE_OVERRIDES_FILE, siteOverridesHead } from '../docs/.vitepress/site-overrides.js';

const ROOT = resolve(import.meta.dirname, '..');

describe('site-overrides.css', () => {
  const file = resolve(ROOT, 'docs/public', SITE_OVERRIDES_FILE);

  test('ships from docs/public unhashed, so it lands at <base>site-overrides.css', () => {
    expect(SITE_OVERRIDES_FILE).toBe('site-overrides.css');
    expect(existsSync(file)).toBe(true);
  });

  test('is a comment-only placeholder for the downstream build to replace', () => {
    const css = readFileSync(file, 'utf-8').trim();
    expect(css).toMatch(/^\/\*[\s\S]*\*\/$/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('');
  });

  test('the head entry links a plain stylesheet under the site base', () => {
    expect(siteOverridesHead('/cdk/api/')).toEqual(['link', { rel: 'stylesheet', href: '/cdk/api/site-overrides.css' }]);
  });

  // Config shape: at the root base the e2e build cannot tell a base-built href from a hard-coded one.
  test('the config builds the href from the configured base', () => {
    const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
    expect(config.match(/siteOverridesHead\(sitePaths\.siteBase\(\)\)/g)).toHaveLength(1);
    expect(config).not.toContain('"/site-overrides.css"');
  });
});
