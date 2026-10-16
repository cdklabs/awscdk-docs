import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

// Navbar aws-cdk-lib version badge. The build already resolves the installed
// version in config.mts and exposes it on themeConfig for the report-issue
// template; the badge renders it in the chrome so a
// reader knows which release the docs were generated from without opening
// the Versions page, and links it there so it doubles as that entry point.
describe('navbar version badge', () => {
  const componentPath = resolve(THEME_DIR, 'VersionBadge.vue');
  const component = readFileSync(componentPath, 'utf-8');
  const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
  const css = readFileSync(resolve(THEME_DIR, 'nav-controls.css'), 'utf-8');

  test('component exists and renders the version the page was stamped with', () => {
    expect(existsSync(componentPath)).toBe(true);
    // The <head> stamp is authoritative (test/site-stamp.test.ts pins the
    // precedence); themeConfig covers pages rendered without one.
    expect(component).toContain('useData');
    expect(component).toContain('stampVersion(document)');
    expect(component).toContain('theme.value.cdkVersion');
  });

  test('renders nothing when the version is unavailable', () => {
    // cdkVersion is undefined whenever aws-cdk-lib is not installed
    // (config.mts guards the package.json read), so the badge must be
    // absent rather than rendering a "vundefined" label.
    expect(component).toMatch(/v-if="version"/);
    expect(component).not.toContain('unknown');
    // The guard has to reject the empty string too, not just undefined —
    // `v-if` on '' is already falsy, but the computed must not hand a blank
    // label through as a truthy value.
    expect(component).toMatch(/length\s*>\s*0/);
  });

  test('the badge links to the versions page, base-aware', () => {
    // Same page the "Versions" nav item targets. withBase keeps it correct
    // under the project-pages base path.
    expect(component).toContain('withBase');
    expect(component).toContain('withBase(VERSIONS_ROUTE)');
  });

  test('label carries the v prefix and an accessible name that starts with it', () => {
    expect(component).toMatch(/v\{\{\s*version\s*\}\}/);
    // The visible "v2.263.0" alone does not say what is versioned, so the
    // accessible name adds the package and the link's purpose — but it must
    // START with the visible label, or voice control cannot match what the
    // user reads aloud (WCAG 2.5.3 label in name).
    expect(component).toMatch(/aria-label="`v\$\{version\}/);
    expect(component).toContain('aws-cdk-lib');
  });

  test('mounted in the nav row alongside the existing controls', () => {
    expect(entry).toContain('import VersionBadge from "./VersionBadge.vue"');
    // Left of the gear so the Settings dropdown keeps the row's end.
    expect(entry).toMatch(
      /"nav-bar-content-after":\s*\(\)\s*=>\s*\[\s*h\(LanguageToggle\),\s*h\(VersionBadge\),\s*h\(SettingsMenu\)\s*\]/,
    );
  });

  test('aligns on the navbar control baseline', () => {
    // The search trigger is pinned at 40px and test/nav-controls.test.ts
    // guards that alignment; the badge matches it instead of introducing a
    // second baseline.
    expect(css).toMatch(/\.version-badge\s*\{[^}]*height:\s*40px/);
  });

  test('uses existing brand tokens rather than new hard-coded colors', () => {
    const rules = css.slice(css.indexOf('.version-badge'));
    const block = rules.slice(0, rules.indexOf('/* ---', 1));
    expect(block).toMatch(/var\(--vp-c-/);
    // No literal hex/rgb color introduced for this control.
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
  });

});
