import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { jest } from '@jest/globals';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

// Layout-density state module, modeled on code-theme.ts. A tri-state choice
// (compact / balanced / spacious) stored in localStorage drives a
// `data-density` attribute on <html>; `balanced` (today's values) is the
// absence of the attribute. A pre-hydration script in config.mts re-applies a
// stored non-default choice before first paint.
describe('layout density state', () => {
  const statePath = resolve(THEME_DIR, 'density.ts');
  const state = readFileSync(statePath, 'utf-8');
  const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');

  describe('source shape', () => {
    test('tri-state model persisted to localStorage under the settled key', () => {
      expect(existsSync(statePath)).toBe(true);
      expect(state).toContain("export type Density = 'compact' | 'balanced' | 'spacious'");
      expect(state).toContain("DENSITY_KEY = 'cdk-docs-density'");
      expect(state).toContain('localStorage.setItem(DENSITY_KEY');
    });

    test('balanced is the ABSENCE of the attribute; compact/spacious set it', () => {
      // Following today's layout must be the absence of any override, so it
      // cannot drift from the bare :root tokens in density.css.
      expect(state).toMatch(/removeAttribute\(['"]data-density['"]\)/);
      expect(state).toMatch(/setAttribute\(['"]data-density['"], value\)/);
    });
  });

  // Behavioral tests. The repo runs node-env Jest with no jsdom (and adding
  // one is out of scope — no new dependency), so we install the minimal
  // window/document surface the module actually touches: localStorage and
  // documentElement's attribute methods.
  describe('behavior', () => {
    let store: Record<string, string>;
    let attrs: Record<string, string>;

    beforeEach(() => {
      jest.resetModules();
      store = {};
      attrs = {};
      const fakeWindow = {
        localStorage: {
          getItem: (k: string) => (k in store ? store[k] : null),
          setItem: (k: string, v: string) => {
            store[k] = v;
          },
        },
      };
      const documentElement = {
        setAttribute: (name: string, value: string) => {
          attrs[name] = value;
        },
        removeAttribute: (name: string) => {
          delete attrs[name];
        },
        getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      };
      (globalThis as Record<string, unknown>).window = fakeWindow;
      (globalThis as Record<string, unknown>).document = {
        documentElement,
        // Vue's runtime-dom touches document.createElement at import time;
        // a no-op element keeps the import from throwing under node-env.
        createElement: () => ({ style: {}, setAttribute() {}, removeAttribute() {} }),
      };
    });

    afterEach(() => {
      delete (globalThis as Record<string, unknown>).window;
      delete (globalThis as Record<string, unknown>).document;
    });

    test('default is balanced, and applying it leaves no attribute', async () => {
      const mod = await import('../docs/.vitepress/theme/density.js');
      mod.initDensity();
      expect(mod.density.value).toBe('balanced');
      expect('data-density' in attrs).toBe(false);
    });

    test('a stored compact value is read and applied before first paint', async () => {
      store['cdk-docs-density'] = 'compact';
      const mod = await import('../docs/.vitepress/theme/density.js');
      mod.initDensity();
      expect(mod.density.value).toBe('compact');
      expect(attrs['data-density']).toBe('compact');
    });

    test('an unknown stored value falls back to balanced (no attribute)', async () => {
      store['cdk-docs-density'] = 'cozy';
      const mod = await import('../docs/.vitepress/theme/density.js');
      mod.initDensity();
      expect(mod.density.value).toBe('balanced');
      expect('data-density' in attrs).toBe(false);
    });

    test('setDensity persists and applies — sets the attribute, then removes it for balanced', async () => {
      const mod = await import('../docs/.vitepress/theme/density.js');
      mod.setDensity('spacious');
      expect(store['cdk-docs-density']).toBe('spacious');
      expect(attrs['data-density']).toBe('spacious');

      mod.setDensity('balanced');
      expect(store['cdk-docs-density']).toBe('balanced');
      expect('data-density' in attrs).toBe(false);
    });
  });

  describe('no flash on reload', () => {
    test('config head carries the density pre-hydration bootstrap script', () => {
      // Mirrors the code-theme bootstrap: a stored non-default choice applies
      // before first paint. The key must match the state module's DENSITY_KEY,
      // and only compact/spacious apply (balanced is the absent attribute).
      expect(config).toContain('localStorage.getItem("cdk-docs-density")');
      expect(config).toMatch(/setAttribute\("data-density", d\)/);
      expect(config).toMatch(/d === "compact" \|\| d === "spacious"/);
    });

    test('enhanceApp re-applies the stored choice at client boot', () => {
      expect(entry).toContain('initDensity()');
    });
  });
});
