import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

describe('MiniSearch site search integration', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(ROOT, 'package.json'), 'utf-8'),
  );
  const config = readFileSync(
    resolve(ROOT, 'docs/.vitepress/config.mts'),
    'utf-8',
  );

  // Config shape with no produced-output counterpart: the classification
  // records that the search engine ships as plain JavaScript in the built site.
  test('minisearch is listed in dependencies and the Pagefind packages are gone', () => {
    expect(packageJson.dependencies.minisearch).toBeDefined();
    expect(packageJson.dependencies.pagefind).toBeUndefined();
    expect(packageJson.dependencies['vitepress-plugin-pagefind']).toBeUndefined();
  });

  test('VitePress config aliases the navbar search component to the theme dialog', () => {
    expect(config).toMatch(/VPNavBarSearch\\\.vue\$/);
    expect(config).toContain('theme/SearchBox.vue');
  });

  test('VitePress config exposes the hashed search index asset to the theme', () => {
    expect(config).toMatch(/\^index\\\.\[0-9a-f\]\{8\}\\\.json\$/);
    expect(config).toContain('...searchAsset()');
  });

  test('no WebAssembly search runtime is wired: no plugin, preload or config file remains', () => {
    expect(config).not.toMatch(/pagefind/i);
    expect(config).not.toMatch(/modulepreload/);
    expect(existsSync(resolve(ROOT, 'pagefind.yml'))).toBe(false);
  });

  test('built-in VitePress local search stays off; the theme dialog is the search', () => {
    expect(config).not.toMatch(/search:\s*\{\s*provider:\s*"local"/);
  });
});
