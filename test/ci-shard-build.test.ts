import { execFileSync } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

describe('ci-shard-build.sh', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ci-shard-build-'));
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(join(ROOT, 'scripts', 'ci-shard-build.sh'), join(dir, 'scripts', 'ci-shard-build.sh'));
    // Stands in for the real build and reports the flags it received.
    writeFileSync(join(dir, 'scripts', 'local-shard-build.sh'), 'echo "$@"\n');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (env: Record<string, string> = {}) =>
    execFileSync('bash', [join(dir, 'scripts', 'ci-shard-build.sh'), '72', '12288', '10'], {
      encoding: 'utf-8',
      env: { PATH: process.env.PATH!, ...env },
    }).trim();

  test('passes its arguments as the build sizing', () => {
    expect(run()).toBe('--num-shards 72 --heap 12288 --concurrency 10');
  });

  test('environment variables override the arguments', () => {
    const out = run({ DOCS_BUILD_SHARDS: '40', DOCS_BUILD_HEAP_MB: '8192', DOCS_BUILD_CONCURRENCY: '6' });
    expect(out).toBe('--num-shards 40 --heap 8192 --concurrency 6');
  });

  test('overrides apply individually', () => {
    expect(run({ DOCS_BUILD_SHARDS: '96' })).toBe('--num-shards 96 --heap 12288 --concurrency 10');
  });

  test('empty environment variables are ignored', () => {
    expect(run({ DOCS_BUILD_SHARDS: '', DOCS_BUILD_HEAP_MB: '', DOCS_BUILD_CONCURRENCY: '' }))
      .toBe('--num-shards 72 --heap 12288 --concurrency 10');
  });
});
