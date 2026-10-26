import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { jest } from '@jest/globals';
import { createCollapseMemory, EXPANDED_STORE_KEY, type StorageLike } from '../docs/.vitepress/theme/sidebar-collapse.js';
import { createScrollMemory, SCROLL_STORE_KEY } from '../docs/.vitepress/theme/sidebar-scroll.js';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

// Navigation-style state module, modeled on code-theme.ts: a two-state choice
// (service / package) stored in localStorage that tells ApiSidebar.vue how to
// group the data it already holds (docs/adr/2026-10-23-sidebar-navigation-styles.md).
describe('navigation style state', () => {
  const statePath = resolve(THEME_DIR, 'nav-style.ts');
  const state = readFileSync(statePath, 'utf-8');

  describe('source shape', () => {
    test('two-state model persisted to localStorage under the settled key', () => {
      expect(existsSync(statePath)).toBe(true);
      expect(state).toContain("export type NavStyle = 'service' | 'package'");
      expect(state).toContain("NAV_STYLE_KEY = 'cdk-docs-nav-style'");
      expect(state).toContain('localStorage.setItem(NAV_STYLE_KEY');
    });

    test('a reader who never picks sees the service style and no bootstrap script is needed', () => {
      expect(state).toContain("DEFAULT_NAV_STYLE: NavStyle = 'service'");
      // The style changes no attribute and no stylesheet, so unlike the code
      // theme and density there is nothing to apply before first paint.
      expect(state).not.toMatch(/setAttribute|removeAttribute/);
      const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
      expect(config).not.toContain('cdk-docs-nav-style');
    });
  });

  // Behavioral tests under node-env Jest (no jsdom): install the minimal
  // window surface the module touches, localStorage only.
  describe('behavior', () => {
    let store: Record<string, string>;

    beforeEach(() => {
      jest.resetModules();
      store = {};
      (globalThis as Record<string, unknown>).window = {
        localStorage: {
          getItem: (k: string) => (k in store ? store[k] : null),
          setItem: (k: string, v: string) => {
            store[k] = v;
          },
        },
      };
      (globalThis as Record<string, unknown>).document = {
        documentElement: { setAttribute() {}, removeAttribute() {}, getAttribute: () => null },
        // Vue's runtime-dom touches document.createElement at import time.
        createElement: () => ({ style: {}, setAttribute() {}, removeAttribute() {} }),
      };
    });

    afterEach(() => {
      delete (globalThis as Record<string, unknown>).window;
      delete (globalThis as Record<string, unknown>).document;
    });

    test('defaults to service', async () => {
      const mod = await import('../docs/.vitepress/theme/nav-style.js');
      mod.initNavStyle();
      expect(mod.navStyle.value).toBe('service');
    });

    test('a stored package choice is read on init', async () => {
      store['cdk-docs-nav-style'] = 'package';
      const mod = await import('../docs/.vitepress/theme/nav-style.js');
      mod.initNavStyle();
      expect(mod.navStyle.value).toBe('package');
    });

    test('an unknown stored value falls back to service', async () => {
      store['cdk-docs-nav-style'] = 'alphabetical';
      const mod = await import('../docs/.vitepress/theme/nav-style.js');
      mod.initNavStyle();
      expect(mod.navStyle.value).toBe('service');
    });

    test('setNavStyle persists the choice', async () => {
      const mod = await import('../docs/.vitepress/theme/nav-style.js');
      mod.setNavStyle('package');
      expect(mod.navStyle.value).toBe('package');
      expect(store['cdk-docs-nav-style']).toBe('package');
      mod.setNavStyle('service');
      expect(store['cdk-docs-nav-style']).toBe('service');
    });

    test('a throwing storage leaves the choice in effect for the session', async () => {
      (globalThis as Record<string, unknown>).window = {
        localStorage: {
          getItem: () => {
            throw new Error('denied');
          },
          setItem: () => {
            throw new Error('denied');
          },
        },
      };
      const mod = await import('../docs/.vitepress/theme/nav-style.js');
      expect(() => mod.initNavStyle()).not.toThrow();
      expect(() => mod.setNavStyle('package')).not.toThrow();
      expect(mod.navStyle.value).toBe('package');
    });
  });

  describe('per-style storage keys', () => {
    test('the service style keeps the existing keys; the package style suffixes them', async () => {
      const { styleStorageKey } = await import('../docs/.vitepress/theme/nav-style.js');
      expect(styleStorageKey(EXPANDED_STORE_KEY, 'service')).toBe('cdk-docs:sidebar-expanded:v1');
      expect(styleStorageKey(EXPANDED_STORE_KEY, 'package')).toBe('cdk-docs:sidebar-expanded:v1:package');
      expect(styleStorageKey(SCROLL_STORE_KEY, 'service')).toBe('cdk-docs-sidebar-scroll');
      expect(styleStorageKey(SCROLL_STORE_KEY, 'package')).toBe('cdk-docs-sidebar-scroll:package');
    });

    test('two collapse stores over one storage keep their choices apart, and pruning one leaves the other whole', async () => {
      const { styleStorageKey } = await import('../docs/.vitepress/theme/nav-style.js');
      const storage = fakeStorage();
      const service = createCollapseMemory(storage, styleStorageKey(EXPANDED_STORE_KEY, 'service'));
      const pkg = createCollapseMemory(storage, styleStorageKey(EXPANDED_STORE_KEY, 'package'));
      service.set('Services\u0000aws_s3', true);
      pkg.set('aws-cdk-lib.aws_s3', true);
      pkg.set('API Reference', false);

      expect(service.get('aws-cdk-lib.aws_s3')).toBeUndefined();
      expect(pkg.get('Services\u0000aws_s3')).toBeUndefined();

      // Loading the package style prunes to the package tree's live keys only.
      pkg.prune(new Set(['API Reference', 'aws-cdk-lib.aws_s3']));
      expect(service.entries()).toEqual([['Services\u0000aws_s3', true]]);
      // And the service style's prune does not see the package keys as dead.
      service.prune(new Set(['Services\u0000aws_s3']));
      expect(pkg.entries()).toEqual([['aws-cdk-lib.aws_s3', true], ['API Reference', false]]);

      // A current reader's existing store is the service store, untouched in name.
      expect([...storage.data.keys()].sort()).toEqual([
        'cdk-docs:sidebar-expanded:v1',
        'cdk-docs:sidebar-expanded:v1:package',
      ]);
    });

    test('two scroll memories over one storage remember the same route separately', async () => {
      const { styleStorageKey } = await import('../docs/.vitepress/theme/nav-style.js');
      const storage = fakeStorage();
      const service = createScrollMemory(storage, styleStorageKey(SCROLL_STORE_KEY, 'service'));
      const pkg = createScrollMemory(storage, styleStorageKey(SCROLL_STORE_KEY, 'package'));
      service.save('v2/docs/aws-cdk-lib.aws_s3.Bucket', 120);
      pkg.save('v2/docs/aws-cdk-lib.aws_s3.Bucket', 480);
      expect(service.get('v2/docs/aws-cdk-lib.aws_s3.Bucket')).toBe(120);
      expect(pkg.get('v2/docs/aws-cdk-lib.aws_s3.Bucket')).toBe(480);
    });
  });

  describe('picker and sidebar wiring', () => {
    const picker = readFileSync(resolve(THEME_DIR, 'NavStylePicker.vue'), 'utf-8');
    const menu = readFileSync(resolve(THEME_DIR, 'SettingsMenu.vue'), 'utf-8');
    const sidebar = readFileSync(resolve(THEME_DIR, 'ApiSidebar.vue'), 'utf-8');

    test('the Settings menu hosts a Navigation group with the two settled options', () => {
      expect(menu).toContain('import NavStylePicker from "./NavStylePicker.vue"');
      expect(menu).toContain('<NavStylePicker');
      expect(picker).toContain('class="nav-style-group-label">Navigation<');
      expect(picker).toContain('aria-label="Navigation"');
      expect(picker).toContain('label: "By service"');
      expect(picker).toContain('label: "By package"');
    });

    test('the options follow the theme pickers\' control contract', () => {
      // Real buttons with aria-pressed, the active state gated on `mounted`
      // so hydration cannot leave the server-rendered default highlighted.
      expect(picker).toMatch(/<button[^>]*type="button"/s);
      expect(picker).toContain(':aria-pressed="mounted && navStyle === option.value"');
      expect(picker).toContain(':class="{ active: mounted && navStyle === option.value }"');
      expect(picker).toContain('role="group"');
      // Same 40px track and 24px minimum target as ThemePicker.vue.
      expect(picker).toMatch(/\.nav-style-group\s*\{[^}]*height:\s*40px/);
      expect(picker).toMatch(/\.nav-style-option\s*\{[^}]*min-width:\s*24px/);
    });

    test('the sidebar regroups the same loaded data and keys its memories per style', () => {
      expect(sidebar).toContain('buildPackageSidebar(packageModules.value, serviceTree.value, chunkItems, API_ROOT)');
      expect(sidebar).toMatch(/navStyle\.value === "package" \? packageTree\.value : serviceTree\.value/);
      expect(sidebar).toContain('styleStorageKey(EXPANDED_STORE_KEY, "package")');
      expect(sidebar).toContain('styleStorageKey(SCROLL_STORE_KEY, "package")');
      // No second skeleton or package chunk is fetched: every load goes through the one loader.
      expect(sidebar.match(/loadApiSidebar\(/g)?.length).toBe(2);
      expect(sidebar).toContain('loadApiSidebar(withBase(skeleton), "skeleton")');
      expect(sidebar).toContain('loadApiSidebar(withBase(chunkAsset(name)), `chunk:${name}`)');
    });
  });
});
