import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

// The VitePress page hashmap + site data is ~500KB and, when inlined, is
// duplicated into the initial HTML of every one of the ~21.9k pages — which
// pushed the GitHub Pages artifact over its 1GB limit.
describe('VitePress metaChunk (artifact size)', () => {
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');

  test('metaChunk is enabled so metadata is a shared chunk, not inlined per page', () => {
    expect(config).toMatch(/metaChunk:\s*true/);
  });

});
