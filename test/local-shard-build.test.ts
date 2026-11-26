import { execFileSync } from 'child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
const require = createRequire(import.meta.url);

const ROOT = resolve(import.meta.dirname, '..');
const PRUNE = join(ROOT, 'scripts', 'shard-prune.cjs');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dispatchOrder, planShards } = require(PRUNE) as {
  dispatchOrder: (docsDir: string, total: number) => number[];
  planShards: (docsDir: string, total: number) => { units: { name: string; files: string[] }[]; assignment: number[] };
};

/**
 * A generated tree with equal page counts per service but unequal page sizes: service i's pages are
 * `bytesFor(i)` bytes each, so shards balance on pages while their content differs.
 */
function fakeDocs(root: string, services: number, bytesFor: (i: number) => number): string {
  const docsDir = join(root, 'docs', 'v2', 'docs');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, 'aws-cdk-lib-readme.md'), '# aws-cdk-lib\n');
  for (let i = 0; i < services; i++) {
    const sub = `aws_svc${String(i).padStart(3, '0')}`;
    for (let p = 0; p < 3; p++) {
      writeFileSync(join(docsDir, `aws-cdk-lib.${sub}.Thing${p}.md`), 'x'.repeat(bytesFor(i)));
    }
  }
  return docsDir;
}

function shardBytes(docsDir: string, total: number): number[] {
  const { units, assignment } = planShards(docsDir, total);
  const bytes = new Array(total).fill(0);
  units.forEach((unit, i) => {
    for (const f of unit.files) bytes[assignment[i]] += statSync(join(docsDir, f)).size;
  });
  return bytes;
}

describe('shard dispatch order', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shard-order-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('starts the shard with the most page bytes first and ends with the lightest', () => {
    const docsDir = fakeDocs(dir, 8, (i) => (i === 5 ? 5000 : 100 + i));
    const order = dispatchOrder(docsDir, 8);
    const { units, assignment } = planShards(docsDir, 8);
    const heavy = assignment[units.findIndex((u) => u.name === 'aws-cdk-lib/aws_svc005')];
    const light = assignment[units.findIndex((u) => u.name === 'aws-cdk-lib/aws_svc000')];
    expect(order[0]).toBe(heavy);
    expect(order[order.length - 1]).toBe(light);
  });

  test('is every shard exactly once, sorted by page bytes descending', () => {
    const docsDir = fakeDocs(dir, 23, (i) => ((i * 37) % 11) * 50 + 10);
    const order = dispatchOrder(docsDir, 6);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    const bytes = shardBytes(docsDir, 6);
    for (let k = 1; k < order.length; k++) expect(bytes[order[k - 1]]).toBeGreaterThanOrEqual(bytes[order[k]]);
    const out = execFileSync('node', [PRUNE, '--dispatch-order'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, SHARD_TOTAL: '6' },
    });
    expect(out.trim().split('\n').map(Number)).toEqual(order);
  });

  test('equal shards keep ascending index order', () => {
    const docsDir = fakeDocs(dir, 4, () => 100);
    expect(dispatchOrder(docsDir, 4)).toEqual([0, 1, 2, 3]);
  });

  test('ordering does not change which units a shard keeps', () => {
    const docsDir = fakeDocs(dir, 23, (i) => i * 10 + 1);
    const before = planShards(docsDir, 6);
    dispatchOrder(docsDir, 6);
    expect(planShards(docsDir, 6)).toEqual(before);
  });
});

describe('local-shard-build.sh', () => {
  let dir: string;

  // A project root whose build tools are stand-ins: docs generation, Pagefind and the merge do nothing, and the
  // VitePress stand-in allocates memory scaled to its shard's page bytes, so the peak RSS line is a real reading.
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'local-shard-build-'));
    const scripts = join(dir, 'scripts');
    mkdirSync(scripts);
    for (const f of ['local-shard-build.sh', 'shard-prune.cjs', 'report-peak-rss.cjs']) {
      copyFileSync(join(ROOT, 'scripts', f), join(scripts, f));
    }
    writeFileSync(join(scripts, 'site-paths.cjs'), "module.exports = { distDir: () => 'dist' };\n");
    writeFileSync(join(scripts, 'merge-shards.cjs'), '');
    writeFileSync(join(scripts, 'shard-verify.cjs'), '');
    writeFileSync(join(scripts, 'verify-site.sh'), '');
    mkdirSync(join(dir, 'docs', '.vitepress'), { recursive: true });
    writeFileSync(join(dir, 'docs', '.vitepress', 'config.mts'), '');
    fakeDocs(dir, 6, (i) => (i + 1) * 1000);
    const bin = join(dir, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'vitepress'), [
      "const fs = require('fs');",
      "const d = 'docs/v2/docs';",
      'const bytes = fs.readdirSync(d).reduce((s, f) => s + fs.statSync(d + "/" + f).size, 0);',
      'globalThis.keep = Buffer.alloc(bytes * 4096, 1);',
    ].join('\n'));
    const stubs = join(dir, 'stub-bin');
    mkdirSync(stubs);
    writeFileSync(join(stubs, 'npx'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(stubs, 'npx'), 0o755);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (concurrency: number) =>
    execFileSync('bash', [join(dir, 'scripts', 'local-shard-build.sh'), '--num-shards', '3', '--concurrency',
      String(concurrency)], {
      cwd: dir,
      encoding: 'utf-8',
      env: { PATH: `${join(dir, 'stub-bin')}:${process.env.PATH}`, TMPDIR: dir, HOME: dir },
    });

  test('starts shards in dispatch order', () => {
    const out = run(1);
    const started = [...out.matchAll(/^shard (\d+)\/3: started/gm)].map((m) => Number(m[1]));
    expect(started).toEqual(dispatchOrder(join(dir, 'docs', 'v2', 'docs'), 3));
  });

  test('logs one done line per shard with its wall time and peak RSS', () => {
    const out = run(3);
    const done = [...out.matchAll(/^shard (\d+)\/3: done wall_s=(\d+) peak_rss_mb=(\d+)$/gm)];
    expect(done.map((m) => Number(m[1])).sort()).toEqual([0, 1, 2]);
    // The reading is in MB: at least the stand-in's own allocation, plus no more than Node's own footprint.
    const bytes = shardBytes(join(dir, 'docs', 'v2', 'docs'), 3);
    for (const m of done) {
      const allocatedMb = (bytes[Number(m[1])] * 4096) / 2 ** 20;
      expect(Number(m[3])).toBeGreaterThanOrEqual(Math.floor(allocatedMb));
      expect(Number(m[3])).toBeLessThan(allocatedMb + 512);
    }
  });
});
