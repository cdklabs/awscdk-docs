import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

/**
 * Rule bodies inside one media query, keyed by each individual selector.
 *
 * Brace-matched rather than sliced to end of file, so a declaration in a
 * later breakpoint cannot satisfy an assertion about this one. A shared
 * selector list maps every selector in it to the same body.
 */
function rulesInMediaBlock(source: string, query: string): Map<string, string> {
  const start = source.indexOf(query);
  if (start < 0) {
    throw new Error(`media query not found: ${query}`);
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error(`unterminated media block: ${query}`);
  }

  // Comments are stripped first: they sit between rules and would otherwise
  // be read as part of the following selector list.
  const block = source.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');

  const rules = new Map<string, string>();
  for (const [, selectors, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of selectors.split(',')) {
      const clean = selector.trim().replace(/\s+/g, ' ');
      if (clean) {
        rules.set(clean, body);
      }
    }
  }
  return rules;
}

describe('responsive mobile layout', () => {
  const cssPath = resolve(THEME_DIR, 'responsive.css');
  const css = readFileSync(cssPath, 'utf-8');

  test('responsive stylesheet exists and is imported by the theme entry', () => {
    expect(existsSync(cssPath)).toBe(true);
    const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
    expect(entry).toContain('./responsive.css');
  });

  describe('breakpoints mirror the default theme', () => {
    test('defines a tablet breakpoint at 767px', () => {
      expect(css).toContain('@media (max-width: 767px)');
    });

    test('defines a mobile-sidebar breakpoint at 959px', () => {
      expect(css).toContain('@media (max-width: 959px)');
    });
  });

  describe('horizontal overflow guard', () => {
    test('doc containers allow flex children to shrink (min-width: 0)', () => {
      expect(css).toMatch(/\.VPDoc[\s\S]*?min-width:\s*0/);
    });

    test('doc content wraps long words instead of overflowing', () => {
      expect(css).toMatch(/\.vp-doc\s*{[^}]*overflow-wrap/);
    });
  });

  describe('signature blocks', () => {
    test('signature blocks get touch momentum scrolling and a width cap', () => {
      const block = css.match(/pre\.signature\s*{[^}]*}/)?.[0] ?? '';
      expect(block).toContain('-webkit-overflow-scrolling: touch');
      expect(block).toContain('max-width: 100%');
    });

    test('signature blocks keep horizontal scroll from signatures.css', () => {
      // The scroll rule itself lives in signatures.css -- guard it there so
      // a refactor cannot silently drop mobile code scrolling.
      const signatures = readFileSync(resolve(THEME_DIR, 'signatures.css'), 'utf-8');
      expect(signatures).toMatch(/pre\.signature\s*{[^}]*overflow-x:\s*auto/);
    });

    test('mobile tightens signature padding inside the tablet breakpoint', () => {
      const mobile = css.slice(css.indexOf('@media (max-width: 767px)'));
      expect(mobile).toMatch(/pre\.signature\s*{[^}]*padding/);
    });

    test('initializer fences wrap on narrow screens instead of scrolling', () => {
      // The `## Initializer` block is a Shiki fence, so the narrow-viewport
      // wrap is scoped to the initializer's Pagefind-ignored container and
      // example fences keep scrolling.
      const mobile = css.slice(css.indexOf('@media (max-width: 767px)'));
      const block = mobile.match(/h2#initializer \+ div\[data-pagefind-ignore\] pre\.shiki,\s*h2#initializer \+ div\[data-pagefind-ignore\] pre\.shiki code\s*{[^}]*}/)?.[0] ?? '';
      expect(block).toContain('white-space: pre-wrap');
      expect(block).toContain('overflow-wrap: anywhere');
    });
  });

  describe('touch targets (WCAG 2.5.5)', () => {
    const mobileNavRules = rulesInMediaBlock(css, '@media (max-width: 959px)');

    /**
     * The dimensions each rule must declare for itself.
     *
     * The sidebar drawer rows are height-only: they are block-level and their
     * width is the drawer's (247px inside a 311px drawer at a 375px viewport),
     * so a 44px `min-width` could never bind.
     */
    const TOUCH_TARGETS: ReadonlyArray<
      readonly [string, string, ReadonlyArray<'min-height' | 'min-width'>]
    > = [
      ['.VPLocalNav .menu', 'local nav menu button', ['min-height', 'min-width']],
      ['.VPLocalNavOutlineDropdown > button', 'TOC dropdown button', ['min-height', 'min-width']],
      ['.VPSidebar .VPSidebarItem .item', 'sidebar drawer rows', ['min-height']],
      ['.VPSidebar .api-sidebar-group', 'API sidebar groups', ['min-height']],
      ['.VPSidebar .api-sidebar-link', 'API sidebar links', ['min-height']],
      ['.VPNavBarHamburger', 'navbar hamburger', ['min-height', 'min-width']],
      ['.favorite-star-button', 'breadcrumb favorite star', ['min-height', 'min-width']],
    ];

    // These two guards pin the parse: the block is brace-bounded, and every
    // selector in a list gets its own entry.
    test('the block is bounded and does not reach the next breakpoint', () => {
      expect(mobileNavRules.size).toBeGreaterThan(0);
      // `.search-dialog` lives in the 767px block below this one.
      expect(css).toContain('.search-dialog');
      expect([...mobileNavRules.keys()]).not.toContain('.search-dialog');
    });

    test('a shared selector list yields one entry per selector', () => {
      // These two share a single rule body; both must resolve to it.
      expect(mobileNavRules.get('.VPLocalNav .menu')).toBe(
        mobileNavRules.get('.VPLocalNavOutlineDropdown > button'),
      );
    });

    // Bounds the exemption: a second height-only target cannot be added
    // without editing this assertion, which is where the reason belongs.
    test('only the block-level sidebar rows are exempt from min-width', () => {
      const exempt = TOUCH_TARGETS.filter(([, , dims]) => !dims.includes('min-width')).map(
        ([selector]) => selector,
      );
      expect(exempt).toEqual([
        '.VPSidebar .VPSidebarItem .item',
        '.VPSidebar .api-sidebar-group',
        '.VPSidebar .api-sidebar-link',
      ]);
    });

    test.each(TOUCH_TARGETS)(
      '%s (%s) declares its own touch dimensions',
      (selector, _label, dimensions) => {
        const body = mobileNavRules.get(selector);
        expect(body).toBeDefined();
        for (const dimension of dimensions) {
          expect(body).toMatch(new RegExp(`${dimension}:\\s*44px`));
        }
      },
    );
  });

  describe('pagefind search dialog', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 767px)'));

    test('dialog goes full-width on small screens', () => {
      const dialog = mobile.match(/\.search-dialog\s*{[^}]*}/)?.[0] ?? '';
      expect(dialog).toMatch(/width:\s*100%/);
      expect(dialog).toMatch(/max-width:\s*none/);
    });

    test('search input uses 16px font to prevent iOS zoom-on-focus', () => {
      const input = mobile.match(/\.pagefind-ui__search-input\s*{[^}]*}/)?.[0] ?? '';
      expect(input).toContain('font-size: 16px');
    });
  });

  describe('light/dark mode safety', () => {
    test('sets no raw colors -- layout-only rules work in both themes', () => {
      // Any color must come from theme variables; a hard-coded color here
      // would only be correct in one of the two modes.
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/(?<![-\w])(?:color|background(?:-color)?):/);
    });
  });

  describe('default-theme mobile structure (dependency pin)', () => {
    // The responsive strategy relies on the default theme providing the
    // drawer, TOC dropdown, and table scroll. Pin those upstream facts so
    // a VitePress upgrade that changes them fails loudly here instead of
    // silently breaking mobile.
    const VP = resolve(ROOT, 'node_modules/vitepress/dist/client/theme-default');

    test('VPSidebar drawer and backdrop components exist', () => {
      expect(existsSync(resolve(VP, 'components/VPSidebar.vue'))).toBe(true);
      expect(existsSync(resolve(VP, 'components/VPBackdrop.vue'))).toBe(true);
    });

    test('local nav renders the TOC outline dropdown', () => {
      const localNav = readFileSync(resolve(VP, 'components/VPLocalNav.vue'), 'utf-8');
      expect(localNav).toContain('VPLocalNavOutlineDropdown');
    });

    test('doc tables scroll horizontally', () => {
      const vpDoc = readFileSync(resolve(VP, 'styles/components/vp-doc.css'), 'utf-8');
      const table = vpDoc.match(/\.vp-doc table\s*{[^}]*}/)?.[0] ?? '';
      expect(table).toContain('display: block');
      expect(table).toContain('overflow-x: auto');
    });

    test('doc code blocks scroll horizontally', () => {
      const vpDoc = readFileSync(resolve(VP, 'styles/components/vp-doc.css'), 'utf-8');
      expect(vpDoc).toMatch(
        /\.vp-doc div\[class\*='language-'\][^{]*{[^}]*overflow-x:\s*auto/,
      );
      expect(vpDoc).toMatch(/\[class\*='language-'\] pre\s*{[^}]*overflow-x:\s*auto/);
    });
  });
});
