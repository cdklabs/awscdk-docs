import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

describe('Pagefind local search integration', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(ROOT, 'package.json'), 'utf-8'),
  );
  const config = readFileSync(
    resolve(ROOT, 'docs/.vitepress/config.mts'),
    'utf-8',
  );

  // Config shape with no produced-output counterpart: the classification
  // records that the search runtime and index ship in the built site.
  test('pagefind is listed in dependencies', () => {
    expect(packageJson.dependencies.pagefind).toBeDefined();
  });

  test('vitepress-plugin-pagefind is listed in dependencies', () => {
    expect(packageJson.dependencies['vitepress-plugin-pagefind']).toBeDefined();
  });

  test('VitePress config imports the pagefind plugin', () => {
    expect(config).toContain(
      'import { pagefindPlugin } from "vitepress-plugin-pagefind"',
    );
  });

  test('VitePress config registers pagefindPlugin in vite plugins', () => {
    expect(config).toMatch(/plugins:\s*\[\s*pagefindPlugin\(/);
  });

  test('per-shard builds defer pagefind indexing (SHARD_BUILD gate)', () => {
    // Sharded builds render only a page subset, so per-shard
    // indexing would be partial; indexing runs once post-merge instead.
    expect(config).toMatch(/process\.env\.SHARD_BUILD/);
    expect(config).toMatch(/indexingCommand/);
  });

  test('built-in MiniSearch local search is removed', () => {
    expect(config).not.toMatch(/search:\s*\{\s*provider:\s*"local"/);
  });

});
