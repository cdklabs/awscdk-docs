import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import {
  bustHashmapFetch,
  hashmapCacheBuster,
  resolveBuildId,
} from '../docs/.vitepress/hashmap-cache-buster.js';

const require = createRequire(import.meta.url);
const ROUTER_PATH = join(
  dirname(require.resolve('vitepress/package.json')),
  'dist',
  'client',
  'app',
  'router.js',
);
const ROUTER_SOURCE = readFileSync(ROUTER_PATH, 'utf-8');

describe('hashmap.json cache buster', () => {
  test('the installed router fetches hashmap.json with the build id as a query', () => {
    const out = bustHashmapFetch(ROUTER_SOURCE, 'abc123');
    expect(out).toContain(`fetch(siteDataRef.value.base + "hashmap.json?v=abc123")`);
    expect(out).not.toContain(`'hashmap.json'`);
  });

  test('the plugin rewrites only the router module', () => {
    const plugin = hashmapCacheBuster('abc123');
    expect(plugin.transform(ROUTER_SOURCE, ROUTER_PATH)).toContain('hashmap.json?v=abc123');
    expect(plugin.transform(ROUTER_SOURCE, '/somewhere/else/router.js')).toBeUndefined();
  });

  test('a build without a build id leaves the router untouched', () => {
    expect(hashmapCacheBuster('').transform(ROUTER_SOURCE, ROUTER_PATH)).toBeUndefined();
  });

  test('a build that never saw the router fails', () => {
    const plugin = hashmapCacheBuster('abc123');
    plugin.buildStart();
    expect(() => plugin.buildEnd()).toThrow('router module was not part of the build');
  });

  test('a router without exactly one hashmap.json fetch fails loudly', () => {
    expect(() => bustHashmapFetch('fetch(base + "other.json")', 'abc123')).toThrow('found 0');
  });

  test('DOCS_BUILD_ID wins over the git commit', () => {
    expect(resolveBuildId({ DOCS_BUILD_ID: ' build-7 ' }, () => 'deadbeef')).toBe('build-7');
    expect(resolveBuildId({}, () => 'deadbeef')).toBe('deadbeef');
  });

  test('a build id that is not URL- and source-safe is rejected', () => {
    expect(() => resolveBuildId({ DOCS_BUILD_ID: `x"+alert(1)+"` }, () => '')).toThrow('DOCS_BUILD_ID must match');
  });

  test('a shard build without a build id fails, a local build without one does not', () => {
    expect(() => resolveBuildId({ SHARD_BUILD: '1' }, () => '')).toThrow('needs DOCS_BUILD_ID');
    expect(resolveBuildId({}, () => '')).toBe('');
  });
});
