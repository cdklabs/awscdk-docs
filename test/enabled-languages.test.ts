import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ENABLED_LANGUAGES,
  LANGUAGE_TOGGLE_VISIBLE,
} from '../docs/.vitepress/theme/enabled-languages.js';

const ROOT = resolve(import.meta.dirname, '..');

// The toggle's existence gate is compiled into the bundle, never fetched.
describe('enabled-languages', () => {
  test('pins the enabled languages to the committed config, in canonical order', () => {
    expect(ENABLED_LANGUAGES).toEqual(['ts', 'python', 'java', 'dotnet', 'go']);
    expect(LANGUAGE_TOGGLE_VISIBLE).toBe(true);
  });

  test('the value is a build-time import of docgen.config.json, and themeConfig carries no copy', () => {
    // The module resolves without VitePress runtime state — importing it in
    // this Node test IS the property: no useData, no fetched chunk.
    const config = readFileSync(
      resolve(ROOT, 'docs/.vitepress/config.mts'),
      'utf-8',
    );
    expect(config).not.toContain('docgenLanguages');
  });

  test('the toggle component gates on the compiled module, not themeConfig', () => {
    const component = readFileSync(
      resolve(ROOT, 'docs/.vitepress/theme/LanguageToggle.vue'),
      'utf-8',
    );
    expect(component).toContain('./enabled-languages');
    expect(component).not.toContain('docgenLanguages');
  });
});
