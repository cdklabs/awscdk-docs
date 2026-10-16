import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

describe('aside outline shows full headers', () => {
  const cssPath = resolve(THEME_DIR, 'outline.css');
  const css = readFileSync(cssPath, 'utf-8');
  const block =
    css.match(/\.VPDocAsideOutline \.outline-link\s*{[^}]*}/)?.[0] ?? '';

  test('stylesheet exists and is imported by the theme entry', () => {
    expect(existsSync(cssPath)).toBe(true);
    const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
    expect(entry).toContain('./outline.css');
  });

  test('outline links wrap instead of truncating with an ellipsis', () => {
    expect(block).toContain('white-space: normal');
    expect(block).toContain('overflow: visible');
    expect(block).toContain('text-overflow: clip');
  });

  test('long unbroken identifiers break within the outline column', () => {
    expect(block).toContain('overflow-wrap: anywhere');
  });

  test('wrapped entries use a compact unitless line-height', () => {
    const lineHeight = parseFloat(
      block.match(/line-height:\s*([\d.]+)\s*;/)?.[1] ?? 'NaN',
    );
    expect(lineHeight).toBeGreaterThanOrEqual(1);
    expect(lineHeight).toBeLessThanOrEqual(1.5);
  });

  test('wrapped entries keep vertical spacing via padding', () => {
    expect(block).toMatch(/padding:\s*\d/);
  });

  test('rules stay scoped to the aside outline', () => {
    // Every selector in this file must target the desktop aside outline —
    // the main sidebar nav and mobile local-nav dropdown keep the
    // default theme treatment.
    const selectors = css
      .split('\n')
      .filter((line) => line.trimEnd().endsWith('{'))
      .map((line) => line.trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toMatch(/^\.VPDocAsideOutline /);
    }
  });
});
