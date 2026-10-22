import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

describe('type page information density', () => {
  const densityPath = resolve(THEME_DIR, 'density.css');
  const density = () => readFileSync(densityPath, 'utf-8');
  const apiLayout = () => readFileSync(resolve(THEME_DIR, 'api-layout.css'), 'utf-8');

  test('density stylesheet exists and is imported by the theme entry', () => {
    expect(existsSync(densityPath)).toBe(true);
    const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
    expect(entry).toContain('./density.css');
  });

  describe('doc-body tables', () => {
    test('cell padding is tighter than the default theme (8px 16px)', () => {
      // Both dimensions shrink: the override must target .vp-doc th/td so
      // the sidebar and aside outline stay untouched.
      const block = density().slice(density().indexOf('.vp-doc th'));
      const padding = block.match(/padding:\s*(\d+)px\s+(\d+)px/);
      expect(padding).not.toBeNull();
      expect(Number(padding![1])).toBeLessThan(8);
      expect(Number(padding![2])).toBeLessThan(16);
    });

    test('table block margin is tighter than the default theme (20px)', () => {
      const block = density().slice(density().indexOf('.vp-doc table'));
      const margin = block.match(/margin:\s*(\d+)px/);
      expect(margin).not.toBeNull();
      expect(Number(margin![1])).toBeLessThan(20);
    });

    test('density does not shrink font sizes — spacing only', () => {
      expect(density()).not.toContain('font-size');
    });
  });

  describe('fold-outs keep the interaction, lose the padding', () => {
    test('member rows still expand via <details> with a visible affordance', () => {
      // Progressive disclosure stays. The affordance is a text label naming
      // what it opens, so it is the label's dotted underline rather than a
      // `::before` glyph, which deliberately does not exist.
      const css = apiLayout();
      expect(css).toContain('.member-disclosure > summary');
      const rule = css.slice(css.indexOf('.member-disclosure > summary'));
      expect(rule).toMatch(/text-decoration:\s*underline dotted/);
      expect(css).not.toMatch(/content:\s*"\+"/);
      expect(css).not.toMatch(/content:\s*"−"/);
    });

    test('member row padding keeps the density gain in the inset', () => {
      // Vertical padding is 10px top/bottom and the horizontal inset stays 0,
      // so the density claim lives in the zero inset (no disclosure triangle or
      // right-hand control reserves space); the exact value bounds a future
      // runaway.
      const css = apiLayout();
      // Scoped to the rule's OWN braces: an unbounded slice lets the match
      // slide to whatever declares a padding next, which is how a passing
      // assertion ends up measuring a rule it never named.
      const from = css.indexOf('.member-list .member-row {');
      expect(from).toBeGreaterThan(-1);
      const block = css.slice(from, css.indexOf('}', from));
      const padding = block.match(/padding:\s*(\d+)px\s+(\d+)(?:px)?/);
      expect(padding).not.toBeNull();
      expect(Number(padding![1])).toBe(10);
      expect(Number(padding![2])).toBe(0);
    });

    test('rows are separated by a divider, and the last one is not', () => {
      // The container lost its box, so the divider is the ONLY thing left
      // separating one member from the next — and a trailing border under the
      // last row would draw a line with nothing below it. The separator uses
      // --vp-c-border, the stronger token, so it stays visible in dark mode;
      // width 1px.
      const css = apiLayout();
      const from = css.indexOf('.member-list .member-row {');
      expect(from).toBeGreaterThan(-1);
      const row = css.slice(from, css.indexOf('}', from));
      expect(row).toMatch(/border-bottom:\s*1px solid var\(--vp-c-border\)/);

      const lastFrom = css.indexOf('.member-list .member-row:last-child {');
      expect(lastFrom).toBeGreaterThan(-1);
      const last = css.slice(lastFrom, css.indexOf('}', lastFrom));
      expect(last).toMatch(/border-bottom:\s*none/);
    });

    test('only the permalink is positioned out of flow, in the gutter of a relative line', () => {
      // A leaked `position: absolute` on any other control would place it over
      // the row it belongs to. The permalink is the one sanctioned exception:
      // it hangs in the left gutter like a heading anchor, so it costs the
      // row's content no indent, and the line it hangs from must be the
      // positioning context or it would land on the page instead.
      const css = apiLayout();
      const rows = css.slice(
        css.indexOf('/* ---------- Member rows'),
        css.indexOf('/* ---------- Type hover tooltips'),
      ).replace(/\/\*[\s\S]*?\*\//g, '');
      const blocks = [...rows.matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter(([, , body]) => /position:\s*absolute/.test(body))
        .map(([, selector]) => selector.trim());
      expect(blocks).toEqual(['.member-permalink']);

      const permalink = rows.match(/\.member-permalink \{([^}]*)\}/)![1];
      expect(permalink).toMatch(/left:\s*0/);
      expect(permalink).toMatch(/margin-left:\s*-0?\.\d+em/);
      expect(permalink).not.toMatch(/order:/);

      const line = rows.match(/\.member-list \.member-line \{([^}]*)\}/)![1];
      expect(line).toMatch(/position:\s*relative/);
    });

    test('the expanded body carries no indent of its own', () => {
      // The row has no horizontal inset, so a body that carried one would
      // render offset from the row that opened it. Sharing the rule with the
      // inline-prose surface is what keeps the two from diverging.
      const css = apiLayout();
      expect(css).toMatch(/\.member-extra,\s*\.member-details \{/);
      const body = css.slice(css.indexOf('.member-extra,'));
      const block = body.slice(0, body.indexOf('}'));
      expect(block).not.toContain('padding-left');
      expect(block).not.toMatch(/padding:\s*\d+px\s+\d+px\s+\d+px\s+[1-9]/);
    });

    test('the disclosure margin stays tighter than the pre-density value', () => {
      // Was `8px 0 24px` on a block of its own. The control is now a label
      // inside the row, so its margin is what separates it from the summary
      // line above it.
      const css = apiLayout();
      const block = css.slice(css.indexOf('.member-disclosure > summary {'));
      const margin = block.match(/margin:\s*(\d+)px\s+0\s+(\d+)/);
      expect(margin).not.toBeNull();
      expect(Number(margin![1])).toBeLessThan(24);
    });

    test('the disclosure is declared once, for both sections at once', () => {
      // Structural rather than enforced by a selector list: both sections emit
      // the SAME class, so there is nothing to keep in sync. A re-split would
      // have to scope a summary rule to one container or the other, which is
      // exactly what this forbids.
      const css = apiLayout();
      expect((css.match(/\.member-disclosure > summary \{/g) ?? []).length).toBe(1);
      expect(css).not.toMatch(/\.props-table[^,{]*\.member-disclosure/);
      expect(css).not.toMatch(/\.methods-table[^,{]*\.member-disclosure/);
    });

    test('neither section carries row rules of its own', () => {
      // A 3px left border on the method block is the second affordance the
      // density complaint is about. Both containers declare nothing but their
      // own margin.
      const css = apiLayout();
      const start = css.indexOf('.props-table,\n.methods-table {');
      expect(start).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf('}', start));
      expect(block).not.toContain('border');
      expect(block).not.toContain('radius');
      expect(block).not.toContain('overflow');
    });
  });
});
