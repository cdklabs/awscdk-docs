import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

// The theme's own search trigger (site-search.css) renders at this height; the
// nav controls pin the same literal so they share a baseline.
const SEARCH_TRIGGER_HEIGHT_PX = 40;

// Independent code-block theme: a second
// tri-state control (Light / Default / Dark) decouples the code-block
// colors from the site theme by switching the ALREADY-EMBEDDED Shiki
// dual-theme CSS vars via a data attribute — no second Shiki pass.
describe('independent code-block theme', () => {
  const statePath = resolve(THEME_DIR, 'code-theme.ts');
  const cssPath = resolve(THEME_DIR, 'code-theme.css');
  const state = readFileSync(statePath, 'utf-8');
  const css = readFileSync(cssPath, 'utf-8');
  const component = readFileSync(resolve(THEME_DIR, 'ThemePicker.vue'), 'utf-8');
  const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');

  describe('state module', () => {
    test('tri-state model persisted to localStorage', () => {
      expect(existsSync(statePath)).toBe(true);
      expect(state).toContain("export type CodeTheme = 'light' | 'auto' | 'dark'");
      expect(state).toContain("'cdk-docs-code-theme'");
      expect(state).toContain('localStorage.setItem(CODE_THEME_KEY');
    });

    test("the 'auto' (Default) state REMOVES the attribute so the stock site-keyed rules drive code blocks", () => {
      // Following the site theme (including Device) must be the absence of
      // any override, not a tracked copy of the site state — that way it
      // cannot drift from VitePress's own appearance handling.
      expect(state).toMatch(/removeAttribute\(['"]data-code-theme['"]\)/);
      expect(state).toMatch(/setAttribute\(['"]data-code-theme['"], theme\)/);
    });
  });

  describe('rendering switch (code-theme.css)', () => {
    test('re-keys the Shiki dual-theme vars off the data attribute', () => {
      // `pre.vp-code` out-specifies VitePress's stock `.dark .vp-code span`
      // and `html:not(.dark) .vp-code span`, so no !important is needed.
      expect(css).toMatch(
        /html\[data-code-theme='light'\] pre\.vp-code span \{\s*color: var\(--shiki-light, inherit\);/,
      );
      expect(css).toMatch(
        /html\[data-code-theme='dark'\] pre\.vp-code span \{\s*color: var\(--shiki-dark, inherit\);/,
      );
      expect(css).not.toContain('!important');
    });

    test('re-pins the code-block chrome vars (background, lang label, copy button)', () => {
      for (const attr of ["'light'", "'dark'"] as const) {
        const block = css.slice(css.indexOf(`html[data-code-theme=${attr}] {`));
        for (const v of [
          '--vp-code-block-bg:',
          '--vp-code-block-color:',
          '--vp-code-lang-color:',
          '--vp-code-copy-code-bg:',
          '--vp-code-line-highlight-color:',
        ]) {
          expect(block).toContain(v);
        }
      }
    });

    test('chrome backgrounds mirror custom.css surface stacks, not free-floating literals', () => {
      // The decoupled blocks re-pin the brand SURFACE vars from custom.css.
      // Read that file's own `:root` / `.dark` values (like the 40px test
      // reads site-search.css) so retuning a surface in
      // custom.css fails here loudly
      // instead of the decoupled blocks silently keeping stale colors.
      const brand = readFileSync(resolve(THEME_DIR, 'custom.css'), 'utf-8');
      const cssVar = (source: string, selector: string, name: string): string => {
        const block = source.match(
          new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`),
        );
        expect(block).not.toBeNull();
        const value = block![1].match(new RegExp(`${name}:\\s*([^;]+);`));
        expect(value).not.toBeNull();
        return value![1].trim();
      };
      const surfaces: Array<[codeVar: string, brandVar: string]> = [
        ['--vp-code-block-bg', '--vp-c-bg-alt'],
        ['--vp-code-copy-code-bg', '--vp-c-bg-soft'],
        ['--vp-code-copy-code-hover-bg', '--vp-c-bg'],
      ];
      for (const [scheme, brandSelector] of [
        ['light', ':root'],
        ['dark', '.dark'],
      ] as const) {
        for (const [codeVar, brandVar] of surfaces) {
          expect(cssVar(css, `html\\[data-code-theme='${scheme}'\\]`, codeVar)).toBe(
            cssVar(brand, brandSelector, brandVar),
          );
        }
      }
    });

    test('is imported by the theme entry', () => {
      expect(entry).toContain('./code-theme.css');
    });
  });

  describe('picker component', () => {
    test('offers a labeled Code theme group with Light / Default / Dark', () => {
      expect(component).toContain('aria-label="Code theme"');
      expect(component).toContain('aria-label="Site theme"');
      expect(component).toMatch(/label:\s*"Default"/);
      expect(component).toContain('setCodeTheme');
      expect(component).toContain('from "./code-theme"');
    });

    test('both groups sit level with the 40px search trigger and slider', () => {
      // The picker pins the same literal value site-search.css
      // gives the search trigger, exactly like LanguageToggle.vue,
      // so the nav controls share a baseline.
      const groupHeight = component.match(
        /\.theme-picker-group\s*\{[^}]*?height:\s*(\d+)px/,
      );
      expect(groupHeight).not.toBeNull();
      expect(Number(groupHeight![1])).toBe(SEARCH_TRIGGER_HEIGHT_PX);
      expect(component).toMatch(/\.theme-picker-group\s*\{[^}]*box-sizing:\s*border-box/);
      // Segments stretch to fill the track like the language slider's.
      expect(component).toMatch(/\.theme-picker-option\s*\{[^}]*align-self:\s*stretch/);
    });

    test('segments hold the 24px WCAG 2.5.8 minimum target size at every breakpoint', () => {
      // The picker's segments were AA-conformant (28x24) before the
      // doubled control landed; nav-row width must be bought from chrome
      // (gaps, padding, margins), never by squeezing the targets below
      // the 24px minimum. Guard both places a width is (or was) set: the
      // scoped base rule — which the mobile nav-screen copy inherits —
      // and any override in nav-controls.css's 768–1279px block.
      const baseWidth = component.match(
        /\.theme-picker-option\s*\{[^}]*?width:\s*(\d+)px/,
      );
      expect(baseWidth).not.toBeNull();
      expect(Number(baseWidth![1])).toBeGreaterThanOrEqual(24);

      const navControls = readFileSync(
        resolve(THEME_DIR, 'nav-controls.css'),
        'utf-8',
      );
      // Any theme-picker-option width override anywhere in the nav CSS
      // must also respect the minimum (absent is fine — the base rule
      // then applies).
      const overrides = navControls.matchAll(
        /\.theme-picker-option[^{]*\{[^}]*?width:\s*(\d+)px/g,
      );
      for (const m of overrides) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(24);
      }
    });
  });

  describe('no flash on reload', () => {
    test('config head carries the pre-hydration bootstrap script', () => {
      // Mirrors VitePress's own appearance bootstrap: a stored DECOUPLED
      // choice applies before first paint. The key must match the state
      // module's CODE_THEME_KEY.
      expect(config).toContain('localStorage.getItem("cdk-docs-code-theme")');
      expect(config).toMatch(/setAttribute\("data-code-theme", t\)/);
      expect(state).toContain("CODE_THEME_KEY = 'cdk-docs-code-theme'");
    });

    test('enhanceApp re-applies the stored choice at client boot', () => {
      expect(entry).toContain('initCodeTheme()');
    });
  });

});
