import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  collapseScrollDelta,
  isStuck,
  resolvePinned,
  stickyRootMargins,
} from '../docs/.vitepress/theme/sidebar-sticky.js';

const THEME_DIR = resolve(import.meta.dirname, '../docs/.vitepress/theme');

describe('pinned group heading', () => {
  describe('stickyRootMargins', () => {
    test('cuts the root to a 1px line under the header', () => {
      expect(stickyRootMargins(68, 536).line).toBe('-68px 0px -467px 0px');
    });

    test('leaves 1px of slack above the area under the header', () => {
      expect(stickyRootMargins(68, 536).belowLine).toBe('-67px 0px 0px 0px');
    });

    test('rounds fractional offsets and never goes negative', () => {
      expect(stickyRootMargins(67.6, 100.2)).toEqual({ line: '-68px 0px -31px 0px', belowLine: '-67px 0px 0px 0px' });
      expect(stickyRootMargins(0, 0)).toEqual({ line: '-0px 0px -0px 0px', belowLine: '-0px 0px 0px 0px' });
    });
  });

  describe('resolvePinned', () => {
    // A chain: service > resource > kind group never reaches here; only
    // eligible groups are tracked. Containment by name prefix.
    const contains = (outer: string, inner: string) => inner !== outer && inner.startsWith(`${outer}/`);

    test('pins the deepest group spanning the band and covers its ancestors', () => {
      const result = resolvePinned(['sns', 'sns/topic'], new Set(['sns', 'sns/topic']), contains);
      expect(result).toEqual({ pinned: 'sns/topic', covered: ['sns'] });
    });

    test('a heading being pushed away no longer counts, so its ancestor shows again', () => {
      const result = resolvePinned(['sns', 'sns/topic'], new Set(['sns']), contains);
      expect(result).toEqual({ pinned: 'sns', covered: [] });
    });

    test('nothing pinned when no spanning group has its heading fully shown', () => {
      expect(resolvePinned(['sns'], new Set<string>(), contains)).toEqual({ pinned: undefined, covered: [] });
      expect(resolvePinned([], new Set(['sns']), contains)).toEqual({ pinned: undefined, covered: [] });
    });

    test('order of the spanning list does not matter', () => {
      const result = resolvePinned(['sns/topic', 'sns'], new Set(['sns/topic', 'sns']), contains);
      expect(result.pinned).toBe('sns/topic');
    });
  });

  test('collapseScrollDelta brings the collapsed row under the header', () => {
    expect(collapseScrollDelta(-18, 132)).toBe(-150);
    expect(collapseScrollDelta(132, 132)).toBe(0);
  });

  test('isStuck tells a displaced heading from one at its natural top', () => {
    expect(isStuck(132, -18)).toBe(true);
    expect(isStuck(139, 139)).toBe(false);
    expect(isStuck(139.3, 139)).toBe(false);
  });

  describe('styles', () => {
    const css = readFileSync(resolve(THEME_DIR, 'api-sidebar.css'), 'utf-8');

    test('only non-kind group headings are sticky, at the measured header offset', () => {
      expect(css).toMatch(
        /\.api-sidebar-item:not\(\[data-kind-group\]\) > \.api-sidebar-group \{[^}]*position: sticky;[^}]*top: var\(--api-sidebar-sticky-top, 0px\);[^}]*background-color: var\(--vp-sidebar-bg-color\);/,
      );
    });

    test('pinned headings stack under the header block and above rotated carets', () => {
      const header = css.match(/\.VPSidebar \.sidebar-header \{[^}]*\}/)![0];
      expect(header).toContain('z-index: 2;');
      // A row's caret rotates with `transform`, which makes it a stacking
      // context at level 0; the pinned heading must sit above that level.
      expect(css).toMatch(/\.api-sidebar-caret \{[^}]*transform: rotate\(0deg\);/);
      expect(css).toMatch(/:not\(\[data-kind-group\]\) > \.api-sidebar-group \{[^}]*z-index: 1;/);
      expect(css).toMatch(/\[data-sticky-covered\] > \.api-sidebar-group:focus-visible \{[^}]*z-index: 2;/);
    });
  });
});
