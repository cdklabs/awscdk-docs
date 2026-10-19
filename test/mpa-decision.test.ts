import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

// VitePress stays in SPA
// mode. Enabling `mpa: true` on 1.6.3 drops the client runtime
// entirely, turning every interactive theme feature (NavFilter,
// LanguageSwitcher, favorites, PageFeedback, type tooltips, site
// search) into dead markup.
describe('reject VitePress MPA mode', () => {
  const configPath = resolve(ROOT, 'docs/.vitepress/config.mts');
  const config = readFileSync(configPath, 'utf-8');

  test('config does not enable MPA mode', () => {
    // Word-boundary match so a comment mentioning "mpa" in prose
    // would not false-positive, but `mpa: true` at any nesting would.
    expect(config).not.toMatch(/\bmpa\s*:/);
  });
});
