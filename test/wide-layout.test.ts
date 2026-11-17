import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');
const VITEPRESS = resolve(ROOT, 'node_modules/vitepress/dist/client/theme-default');

/** Split a selector list on the commas between selectors, not the ones inside `:is(...)`. */
const splitSelectors = (list: string) => list.split(/,(?![^(]*\))/).map((s) => s.trim().replace(/\s+/g, ' '));

/** Declarations of every rule whose selector list contains `selector`, inside the given media query only. */
function declarations(css: string, query: string, selector: string): string[] {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) throw new Error(`media query not found: ${query}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const block = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  for (const [, selectors, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (splitSelectors(selectors).includes(selector)) {
      found.push(...body.split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean));
    }
  }
  return found;
}

// The wide-screen tier: one more breakpoint above the default theme's 1440px
// tier, so large monitors get a wider content area while prose keeps its line
// length and the sidebar keeps its width. The browser spec
// (test/e2e/wide-layout.spec.ts) measures the result; this pins the sheet.
describe('wide-screen layout tier (wide-layout.css)', () => {
  const css = readFileSync(resolve(THEME_DIR, 'wide-layout.css'), 'utf-8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  test('the stylesheet is imported by the theme entry, after the stock theme', () => {
    const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
    expect(entry).toContain('import "./wide-layout.css"');
    expect(entry.indexOf('vitepress/theme-without-fonts')).toBeLessThan(entry.indexOf('./wide-layout.css'));
  });

  test('the tier starts at 1920px and raises the layout max width to 1920px', () => {
    expect(declarations(stripped, '(min-width: 1920px)', ':root')).toEqual(['--vp-layout-max-width: 1920px']);
    // No other breakpoint touches the variable, so below 1920px the stock 1440px holds.
    expect(stripped.match(/--vp-layout-max-width:/g)).toHaveLength(1);
  });

  test('the caps are the three widths already in the code: 1440, 992 and 784', () => {
    const tier = '(min-width: 1920px)';
    expect(declarations(stripped, tier, '.VPDoc:not(.has-sidebar) .container')).toEqual(['max-width: 1440px !important']);
    expect(declarations(stripped, tier, '.VPDoc.has-aside .content-container')).toEqual(['max-width: 992px !important']);
    // The no-sidebar column cap is derived: 992px plus the column's own 2 x 32px padding.
    expect(declarations(stripped, tier, '.VPDoc:not(.has-sidebar) .content')).toEqual(['max-width: 1056px !important']);
    expect(declarations(stripped, tier, '.vp-doc > [data-pagefind-body] > :is(p, ul, ol, blockquote)')).toEqual([
      'max-width: 784px',
    ]);
  });

  test('the three stock values the caps replace are still what VitePress ships', () => {
    // A VitePress bump that moves its tiers should fail here, not silently
    // leave the override pointing at a different geometry.
    const doc = readFileSync(resolve(VITEPRESS, 'components/VPDoc.vue'), 'utf-8');
    const vars = readFileSync(resolve(VITEPRESS, 'styles/vars.css'), 'utf-8');
    expect(vars).toMatch(/--vp-layout-max-width:\s*1440px/);
    expect(doc).toMatch(/\.VPDoc:not\(\.has-sidebar\) \.container\s*{\s*max-width:\s*1104px/);
    expect(doc).toMatch(/\.VPDoc:not\(\.has-sidebar\) \.content\s*{\s*max-width:\s*784px/);
    expect(doc).toMatch(/\.VPDoc\.has-aside \.content-container\s*{\s*max-width:\s*688px/);
    expect(doc).toMatch(/\.VPDoc:not\(\.has-sidebar\) \.container\s*{\s*display:\s*flex;\s*justify-content:\s*center;\s*max-width:\s*992px/);
  });

  test('the prose cap is scoped to the page body, never to member rows', () => {
    // Direct children of `.vp-doc` or of its `[data-pagefind-body]` wrapper
    // only; a descendant selector would also cap the remarks inside member
    // rows, which the issue leaves at the full column.
    const prose = [...stripped.matchAll(/([^{}]+)\{[^{}]*max-width: 784px[^{}]*\}/g)].map((m) => m[1].trim());
    expect(prose).toHaveLength(1);
    for (const selector of splitSelectors(prose[0])) {
      expect(selector).toMatch(/^\.vp-doc > (\[data-pagefind-body\] > )?:is\(p, ul, ol, blockquote\)$/);
    }
  });

  test('the sidebar width and the centering rules are left to the stock theme', () => {
    // Raising the variable IS the 1920px tier for every rule that reads it
    // (VPContent, VPSidebar, VPNavBar, the nav mirror, the footer offset).
    // Nothing here redefines the sidebar or copies that math into the tier.
    expect(stripped).not.toMatch(/--vp-sidebar-width:/);
    const tier = stripped.slice(stripped.indexOf('@media (min-width: 1920px)'), stripped.indexOf('@media (min-width: 960px)'));
    expect(tier).not.toMatch(/VPSidebar|VPNavBar|site-footer|VPContent/);
  });

  test('the /versions centering mirrors VPContent.has-sidebar in both stock tiers', () => {
    const content = readFileSync(resolve(VITEPRESS, 'components/VPContent.vue'), 'utf-8');
    const hook = '.VPContent:not(.has-sidebar):has(.vp-doc._versions)';
    const stock = (query: string) => declarations(content, query, '.VPContent.has-sidebar');
    expect(declarations(stripped, '(min-width: 960px)', hook)).toEqual(
      stock('(min-width: 960px)').filter((d) => d.startsWith('padding-left')),
    );
    expect(declarations(stripped, '(min-width: 1440px)', hook)).toEqual(stock('(min-width: 1440px)'));
  });

  test('the versions hook is the page class VitePress derives from the route', () => {
    // VPDoc puts `route.path.replace(/[./]+/g, '_').replace(/_html$/, '')` on
    // `.vp-doc`; `/versions.html` and `/versions` both become `_versions`.
    const doc = readFileSync(resolve(VITEPRESS, 'components/VPDoc.vue'), 'utf-8');
    const derivation = /route\.path\.replace\(\/\[\.\/\]\+\/g, '_'\)\.replace\(\/_html\$\/, ''\)/;
    expect(doc).toMatch(derivation);
    const pageName = (path: string) => path.replace(/[./]+/g, '_').replace(/_html$/, '');
    expect(pageName('/versions.html')).toBe('_versions');
    expect(pageName('/versions')).toBe('_versions');
    expect(stripped).toContain('.vp-doc._versions');
  });

  test('sets no raw colors -- layout-only rules work in both themes', () => {
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(stripped).not.toMatch(/(?<![-\w])(?:color|background(?:-color)?):/);
  });
});
