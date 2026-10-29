import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const THEME_DIR = resolve(ROOT, 'docs/.vitepress/theme');

// Three-state Light/Device/Dark site theme picker with Device as the default.
// The code-theme
// group alongside it is covered by test/code-theme.test.ts.
describe('three-state theme picker', () => {
  const componentPath = resolve(THEME_DIR, 'ThemePicker.vue');
  const cssPath = resolve(THEME_DIR, 'theme-picker.css');
  const component = readFileSync(componentPath, 'utf-8');
  const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');

  test('component exists and offers Light, Device and Dark states', () => {
    expect(existsSync(componentPath)).toBe(true);
    expect(component).toContain("'light'");
    expect(component).toContain("'auto'");
    expect(component).toContain("'dark'");
    expect(component).toMatch(/label:\s*"Light"/);
    expect(component).toMatch(/label:\s*"Device"/);
    expect(component).toMatch(/label:\s*"Dark"/);
  });

  test('shares VitePress appearance state via useColorMode on its storage key', () => {
    expect(component).toContain('useColorMode');
    expect(component).toContain('from "@vueuse/core"');
    expect(component).toContain('"vitepress-theme-appearance"');
    // emitAuto exposes the stored 'auto' state instead of the resolved
    // light/dark, which is what makes the System option selectable.
    expect(component).toContain('emitAuto: true');
    // Must mirror VitePress's useDark class mapping (dark -> 'dark' class,
    // light -> no class) so both instances write the same <html> class.
    expect(component).toMatch(/modes:\s*\{\s*light:\s*"",\s*dark:\s*"dark"\s*\}/);
  });

  test('mirrored storage key matches the installed VitePress APPEARANCE_KEY', () => {
    // The key is not re-exported from the public 'vitepress' entry point,
    // so the component hard-codes it; fail loudly if upstream renames it.
    const shared = readFileSync(
      resolve(ROOT, 'node_modules/vitepress/dist/client/shared.js'),
      'utf-8',
    );
    expect(shared).toContain("APPEARANCE_KEY = 'vitepress-theme-appearance'");
  });

  test('is reachable in the navbar and mobile nav screen', () => {
    // The picker sits behind the gear-icon Settings dropdown in the navbar,
    // because two tri-state controls inlined in that row crowd it. The mobile
    // nav screen keeps a direct copy — no nested dropdown on touch — shared
    // with the language slider in that slot's array.
    expect(entry).toContain('import ThemePicker from "./ThemePicker.vue"');
    expect(entry).toContain('import SettingsMenu from "./SettingsMenu.vue"');
    expect(entry).toMatch(
      /"nav-bar-content-after":\s*\(\)\s*=>\s*\[[^\]]*h\(SettingsMenu\)[^\]]*\]/,
    );
    const menu = readFileSync(resolve(THEME_DIR, 'SettingsMenu.vue'), 'utf-8');
    expect(menu).toContain('<ThemePicker');
    expect(entry).toMatch(
      /"nav-screen-content-after":\s*\(\)\s*=>\s*\[[^\]]*h\(ThemePicker\)[^\]]*\]/,
    );
    expect(entry).toContain('./theme-picker.css');
  });

  test('hides the stock two-state appearance switch', () => {
    const css = readFileSync(cssPath, 'utf-8');
    expect(css).toMatch(/\.VPNavBarAppearance\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.VPNavScreenAppearance\s*\{[^}]*display:\s*none/);
  });

  test('config keeps the default appearance so fresh visitors follow the OS', () => {
    const config = readFileSync(
      resolve(ROOT, 'docs/.vitepress/config.mts'),
      'utf-8',
    );
    // The default appearance starts fresh visitors on 'auto'
    // (prefers-color-scheme). 'dark'/'force-dark' would change the default;
    // 'force-auto' would remove user choice; false kills it all. The only
    // override allowed is the options object carrying `onChanged` (which skips
    // a no-op restyle on mount): it keeps `true`'s behavior, so it must not
    // set `initialValue` or take any string/boolean form.
    const settings = config.match(/^\s*appearance\s*:\s*([^\n]*)$/gm) ?? [];
    expect(settings.length).toBeLessThanOrEqual(1);
    for (const line of settings) expect(line).toMatch(/appearance\s*:\s*\{\s*$/);
    expect(config).not.toMatch(/initialValue/);
    if (settings.length) expect(config).toMatch(/appearance\s*:\s*\{\s*\n\s*onChanged\s*:/);
  });

  test('offers a Layout density group: Spacious, Balanced, Compact, loosest to tightest', () => {
    // Third group, built like the other two: an icon button per state, the
    // descriptive title doubling as its accessible name, the active state on
    // aria-pressed, and a visible "Layout" caption in the Settings panel.
    expect(component).toContain('from "./density"');
    expect(component).toContain('aria-label="Layout"');
    expect(component).toMatch(/v-if="groupLabels" class="theme-picker-group-label">Layout</);
    const order = [...component.matchAll(/\{ value: "(compact|balanced|spacious)", label: "(\w+)"/g)]
      .map((m) => m[2]);
    expect(order).toEqual(['Spacious', 'Balanced', 'Compact']);
    expect(component).toContain('setDensity(value)');
    expect(component).toContain(':aria-pressed="mounted && density === option.value"');
    expect(component).toContain(':class="{ active: mounted && density === option.value }"');
    expect(component).toContain('initDensity()');
    // The Layout group sits after Site theme and Code theme.
    expect(component.indexOf('aria-label="Layout"')).toBeGreaterThan(
      component.indexOf('aria-label="Code theme"'),
    );
  });

  test('@vueuse/core is a declared dependency', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, 'package.json'), 'utf-8'),
    );
    expect(pkg.dependencies['@vueuse/core']).toBeDefined();
  });

});
