import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

// Client-side language tabs -- Model B prototype from the multi-language
// rendering-model spike.
describe('language tabs prototype', () => {
  const componentPath = resolve(THEME_DIR, 'LanguageTabs.vue');
  const statePath = resolve(THEME_DIR, 'language-state.ts');
  const component = readFileSync(componentPath, 'utf-8');
  const state = readFileSync(statePath, 'utf-8');
  const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');

  test('component and shared state module exist', () => {
    expect(existsSync(componentPath)).toBe(true);
    expect(existsSync(statePath)).toBe(true);
  });

  test('component is registered globally in the theme', () => {
    expect(entry).toContain('import LanguageTabs from "./LanguageTabs.vue"');
    expect(entry).toContain('app.component("LanguageTabs", LanguageTabs)');
  });

  test('all variant groups share ONE reactive language state', () => {
    // A module-level ref, imported by every instance -- not per-instance
    // state -- is what makes independent groups switch together.
    expect(state).toMatch(/export const activeLanguage = ref<TabLanguage>/);
    expect(component).toContain('activeLanguage');
  });

  test('groups render NO per-block tab controls', () => {
    // The navbar LanguageToggle is the single language control; the
    // in-page groups are headerless show/hide wrappers. No tab strip,
    // no tab ARIA roles, no per-block setLanguage writes.
    expect(component).not.toContain('role="tablist"');
    expect(component).not.toContain('role="tab"');
    expect(component).not.toContain('lang-tabs-bar');
    expect(component).not.toContain('setLanguage');
    // The navbar slider still owns selection.
    const toggle = readFileSync(resolve(THEME_DIR, 'LanguageToggle.vue'), 'utf-8');
    expect(toggle).toContain('setLanguage');
    expect(toggle).toContain('role="radiogroup"');
  });

  test('selection persists to the shared localStorage key and the URL', () => {
    // The choice persists to the shared `cdk-docs-language` key, so every
    // control reading that key agrees on the active language.
    expect(state).toContain("'cdk-docs-language'");
    // ?lang= makes the client-side choice shareable (Model B's answer to
    // per-language paths).
    expect(state).toContain("searchParams.set('lang', lang)");
    expect(state).toContain('history.replaceState');
  });

  test('falls back gracefully when a block lacks the selected language', () => {
    // Shows the first embedded language without clobbering the global choice.
    expect(component).toMatch(/ordered\.value\.includes\(activeLanguage\.value\)/);
  });

  test('demo proof page exists and exercises multiple synced groups', () => {
    const demoPath = resolve(ROOT, 'docs/spike/language-tabs-demo.md');
    expect(existsSync(demoPath)).toBe(true);
    const demo = readFileSync(demoPath, 'utf-8');
    const groups = demo.match(/<LanguageTabs /g) ?? [];
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(demo).toContain('data-lang="ts"');
    expect(demo).toContain('data-lang="python"');
  });

  test('demo page is excluded from the deployed (shard) build only', () => {
    const config = readFileSync(
      resolve(ROOT, 'docs/.vitepress/config.mts'),
      'utf-8',
    );
    // Deployed shard builds (SHARD_BUILD=1) must not ship or
    // Pagefind-index the spike prototype page; the e2e fixture build
    // (no SHARD_BUILD) must keep it for test/e2e/language-tabs.spec.ts.
    expect(config).toMatch(
      /srcExclude:\s*\[\s*"adr\/\*\*",\s*"construct-library\.md",\s*\.\.\.\(process\.env\.SHARD_BUILD\s*\?\s*\[\s*"spike\/\*\*"\s*\]\s*:\s*\[\s*\]\s*\)/,
    );
  });

  test('docgen languages are pinned to the shard-validated ts+python+dotnet+java+go set', () => {
    // The enabled set is ts + python + dotnet + java + go. Every language rides the
    // same machinery — inert non-canonical variants are v-pre so
    // hydration JS does not grow, only the canonical variant is Pagefind-
    // indexed, and the csharp/java/go Shiki grammars are already pinned —
    // so each adds static HTML only, with the sharded build and its
    // completeness guard (>=20,000 pages) as the at-scale proof on the
    // enabling PR itself. This completes the
    // supported LANGUAGES set; growing it further needs a fresh ADR with
    // a demonstrated green merged build.
    const config = JSON.parse(readFileSync(resolve(ROOT, 'docgen.config.json'), 'utf-8'));
    expect(config.languages).toEqual(['ts', 'python', 'dotnet', 'java', 'go']);
  });
});
