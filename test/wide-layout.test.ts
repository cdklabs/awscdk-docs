import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');
const VITEPRESS = resolve(ROOT, 'node_modules/vitepress/dist/client/theme-default');

/** Split a selector list on the commas between selectors, not the ones inside `:is(...)`. */
const splitSelectors = (list: string) => list.split(/,(?![^(]*\))/).map((s) => s.trim().replace(/\s+/g, ' '));

/** The body of EVERY `@media <query>` block in the stylesheet, brace-matched, comments stripped. */
function mediaBlocks(css: string, query: string): string[] {
  const blocks: string[] = [];
  const marker = `@media ${query}`;
  for (let start = css.indexOf(marker); start >= 0; start = css.indexOf(marker, start + 1)) {
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) {
        blocks.push(css.slice(open + 1, i).replace(/\/\*[\s\S]*?\*\//g, ''));
        break;
      }
    }
  }
  return blocks;
}

/** Declarations of every rule whose selector list contains `selector`, across all blocks of the media query. */
function declarations(css: string, query: string, selector: string): string[] {
  const found: string[] = [];
  for (const block of mediaBlocks(css, query)) {
    for (const [, selectors, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (splitSelectors(selectors).includes(selector)) {
        found.push(...body.split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean));
      }
    }
  }
  return found;
}

// The wide-screen tier: one more breakpoint above the default theme's 1440px
// tier, so large monitors get a wider content area while prose stays near its
// 1440px line length and the sidebar keeps its width. The browser spec
// (test/e2e/wide-layout.spec.ts) measures the result; this pins the sheet.
describe('wide-screen layout tier (wide-layout.css)', () => {
  const css = readFileSync(resolve(THEME_DIR, 'wide-layout.css'), 'utf-8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const TIER = '(min-width: 1920px)';

  test('the stylesheet is imported by the theme entry, after the stock theme', () => {
    const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
    expect(entry).toContain('import "./wide-layout.css"');
    // The tier's :root override only beats the stock vars.css rule by loading after it.
    const stock = entry.indexOf('vitepress/theme-without-fonts');
    expect(stock).toBeGreaterThan(-1);
    expect(stock).toBeLessThan(entry.indexOf('./wide-layout.css'));
  });

  test('the tier starts at 1920px and raises the layout max width to 1920px', () => {
    expect(declarations(stripped, TIER, ':root')).toEqual(['--vp-layout-max-width: 1920px']);
    // No other breakpoint touches the variable, so below 1920px the stock 1440px holds.
    expect(stripped.match(/--vp-layout-max-width:/g)).toHaveLength(1);
  });

  test('the tier caps the no-sidebar container, its content box, the column and prose at 1440, 1056, 992 and 784px', () => {
    expect(declarations(stripped, TIER, '.VPDoc:not(.has-sidebar) > .container')).toEqual(['max-width: 1440px !important']);
    expect(declarations(stripped, TIER, '.VPDoc.has-aside .content-container')).toEqual(['max-width: 992px !important']);
    // The no-sidebar column cap is derived: 992px plus the column's own 2 x 32px padding.
    expect(declarations(stripped, TIER, '.VPDoc:not(.has-sidebar) .container > .content')).toEqual(['max-width: 1056px !important']);
    expect(declarations(stripped, TIER, '.vp-doc > [data-pagefind-body] > :is(p, ul, ol, blockquote)')).toEqual([
      'max-width: 784px',
    ]);
  });

  test('the stock tier values the overrides depend on are still what VitePress ships', () => {
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
    // Direct children of the `[data-pagefind-body]` wrapper every page has
    // under `.vp-doc`; a descendant selector would also cap the remarks inside
    // member rows, which keep the full column width.
    const prose = [...stripped.matchAll(/([^{}]+)\{[^{}]*max-width: 784px[^{}]*\}/g)].map((m) => m[1].trim());
    expect(prose).toHaveLength(1);
    for (const selector of splitSelectors(prose[0])) {
      expect(selector).toMatch(/^\.vp-doc > \[data-pagefind-body\] > :is\(p, ul, ol, blockquote\)$/);
    }
  });

  test('the tier redefines neither the sidebar width nor any centering rule', () => {
    // Every rule that centers on the layout width reads the variable, so the
    // tier must not carry its own copy of that math.
    expect(stripped).not.toMatch(/--vp-sidebar-width:/);
    const tiers = mediaBlocks(stripped, TIER);
    expect(tiers.length).toBeGreaterThan(0);
    for (const block of tiers) {
      expect(block).not.toMatch(/VPSidebar|VPNavBar|site-footer|VPContent/);
    }
  });

  test('the versions page is hooked through its pageClass frontmatter', () => {
    const page = readFileSync(resolve(ROOT, 'docs/versions.md'), 'utf-8');
    expect(page).toMatch(/^---\n(?:.*\n)*?pageClass: versions-page\n(?:.*\n)*?---\n/);
    // VitePress puts `pageClass` on the Layout root, so the class reaches both the content and the footer.
    const layout = readFileSync(resolve(VITEPRESS, 'Layout.vue'), 'utf-8');
    expect(layout).toMatch(/class="Layout" :class="frontmatter\.pageClass"/);
    expect(stripped).toContain('.Layout.versions-page .VPContent:not(.has-sidebar)');
    expect(stripped).toContain('.Layout.versions-page .site-footer');
  });

  // The sidebar pages take their offsets from 960px; the versions page only from the tightest desktop
  // tier, so a zoomed-in reader between 960 and 1279px keeps the page's full width.
  const VERSIONS_TIERS: Array<[string, string]> = [
    ['(min-width: 1280px)', '(min-width: 960px)'],
    ['(min-width: 1440px)', '(min-width: 1440px)'],
  ];

  test('the versions content offset mirrors VPContent.has-sidebar, from 1280px up', () => {
    const content = readFileSync(resolve(VITEPRESS, 'components/VPContent.vue'), 'utf-8');
    const hook = '.Layout.versions-page .VPContent:not(.has-sidebar)';
    expect(mediaBlocks(stripped, '(min-width: 960px)')).toEqual([]);
    for (const [ours, theirs] of VERSIONS_TIERS) {
      const stock = declarations(content, theirs, '.VPContent.has-sidebar').filter((d) => d.startsWith('padding'));
      expect(stock.length).toBeGreaterThan(0);
      expect(declarations(stripped, ours, hook)).toEqual(stock);
    }
  });

  test('the versions footer offset mirrors the site footer has-sidebar rules, from 1280px up', () => {
    const footer = readFileSync(resolve(THEME_DIR, 'SiteFooter.vue'), 'utf-8');
    const hook = '.Layout.versions-page .site-footer';
    for (const [ours, theirs] of VERSIONS_TIERS) {
      const stock = declarations(footer, theirs, '.site-footer.has-sidebar');
      expect(stock.length).toBeGreaterThan(0);
      expect(declarations(stripped, ours, hook)).toEqual(stock);
    }
  });

  test('sets no raw colors -- layout-only rules work in both themes', () => {
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(stripped).not.toMatch(/(?<![-\w])(?:color|background(?:-color)?):/);
  });
});
