import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
const require = createRequire(import.meta.url);

const ROOT = resolve(import.meta.dirname, '..');
const PRUNE = join(ROOT, 'scripts', 'shard-prune.cjs');
const MERGE = join(ROOT, 'scripts', 'merge-shards.cjs');
const VERIFY = join(ROOT, 'scripts', 'shard-verify.cjs');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assignShards, unitFor, splitOversized } = require(PRUNE) as {
  assignShards: (services: { name: string; pages: number }[], total: number) => number[];
  unitFor: (fileName: string) => string | null;
  splitOversized: (units: { name: string; files: string[] }[], cap: number) => { name: string; files: string[] }[];
};

/**
 * Build a fake generated-docs tree in the FLAT historical layout:
 * `docs/v2/docs/<docId>[.<submodule>][.<Type>].md`. N aws-cdk-lib service
 * submodules, each with an unequal member-page count (service i gets i%7+1
 * member pages plus its `-readme` overview) so the tests exercise the
 * page-count-balanced assignment, not just the trivial one-page-each case.
 * Returns the prune-unit names (`aws-cdk-lib/<submodule>`) the services map to.
 */
function fakeDocs(root: string, serviceCount: number): string[] {
  const base = join(root, 'docs', 'v2', 'docs');
  mkdirSync(base, { recursive: true });
  // The package overview must exist — the prune script uses it as the
  // "docs generated" sentinel and keeps it in every shard.
  writeFileSync(join(base, 'aws-cdk-lib-readme.md'), '# aws-cdk-lib\n');
  const units: string[] = [];
  for (let i = 0; i < serviceCount; i++) {
    const sub = `aws_svc${String(i).padStart(3, '0')}`;
    units.push(`aws-cdk-lib/${sub}`);
    for (let p = 0; p < (i % 7) + 1; p++) {
      writeFileSync(join(base, `aws-cdk-lib.${sub}.Thing${p}.md`), `# aws-cdk-lib.${sub}.Thing${p}\n`);
    }
    // submodule overview page kept with its unit
    writeFileSync(join(base, `aws-cdk-lib.${sub}-readme.md`), `# aws-cdk-lib.${sub}\n`);
  }
  // A standalone module: atomic prune unit `constructs`,
  // member page + readme, that must survive in exactly one shard.
  writeFileSync(join(base, 'constructs.Construct.md'), '# constructs.Construct\n');
  writeFileSync(join(base, 'constructs-readme.md'), '# constructs\n');
  return units;
}

/** Prune units still present in the flat docs dir, derived via unitFor. */
function unitsPresent(root: string): string[] {
  const base = join(root, 'docs', 'v2', 'docs');
  const units = new Set<string>();
  for (const name of readdirSync(base)) {
    if (!name.endsWith('.md')) continue;
    const unit = unitFor(name);
    if (unit !== null) units.add(unit);
  }
  return [...units].sort();
}

describe('shard-prune', () => {
  test('unitFor classifies flat page files into service-sized prune units', () => {
    // aws-cdk-lib submodules (types + their -readme overview) group per service.
    expect(unitFor('aws-cdk-lib.aws_s3.Bucket.md')).toBe('aws-cdk-lib/aws_s3');
    expect(unitFor('aws-cdk-lib.aws_s3-readme.md')).toBe('aws-cdk-lib/aws_s3');
    // Nested types stay in their submodule's unit.
    expect(unitFor('aws-cdk-lib.aws_s3.CfnBucket.PolicyProperty.md')).toBe('aws-cdk-lib/aws_s3');
    // Dotted STRUCTURAL submodules keep their full dotted
    // name — `interfaces.*` must not collapse into one giant unit.
    expect(unitFor('aws-cdk-lib.interfaces.aws_s3.IBucketRef.md')).toBe('aws-cdk-lib/interfaces.aws_s3');
    // Package-root types are the historical `core` unit.
    expect(unitFor('aws-cdk-lib.App.md')).toBe('aws-cdk-lib/core');
    // The package overview stays in every shard.
    expect(unitFor('aws-cdk-lib-readme.md')).toBeNull();
    // Standalone modules are atomic units, readme included.
    expect(unitFor('constructs.Construct.md')).toBe('constructs');
    expect(unitFor('constructs-readme.md')).toBe('constructs');
    expect(unitFor('@aws-cdk_aws-glue-alpha.CfnJob.md')).toBe('@aws-cdk_aws-glue-alpha');
  });

  test('shards are disjoint and their union is the full unit set (services + standalone modules)', () => {
    const total = 4;
    const full = (() => {
      const t = mkdtempSync(join(tmpdir(), 'shard-full-'));
      const units = fakeDocs(t, 37);
      rmSync(t, { recursive: true, force: true });
      // The standalone module `constructs` is a prune unit too.
      return [...units, 'constructs'].sort();
    })();

    const seen = new Set<string>();
    for (let index = 0; index < total; index++) {
      const dir = mkdtempSync(join(tmpdir(), `shard-${index}-`));
      fakeDocs(dir, 37);
      execFileSync('node', [PRUNE], {
        cwd: dir,
        env: { ...process.env, SHARD_INDEX: String(index), SHARD_TOTAL: String(total) },
      });
      const kept = unitsPresent(dir);
      const base = join(dir, 'docs/v2/docs');
      // The package overview stays in every shard (kept, not a prune unit).
      expect(existsSync(join(base, 'aws-cdk-lib-readme.md'))).toBe(true);
      for (const unit of kept) {
        expect(seen.has(unit)).toBe(false); // disjoint
        seen.add(unit);
        // A submodule unit keeps its sibling `-readme` overview page.
        if (unit.startsWith('aws-cdk-lib/')) {
          const sub = unit.slice('aws-cdk-lib/'.length);
          expect(existsSync(join(base, `aws-cdk-lib.${sub}-readme.md`))).toBe(true);
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
    expect([...seen].sort()).toEqual(full); // union == full set
  });

  test('rejects an out-of-range shard index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shard-bad-'));
    fakeDocs(dir, 3);
    expect(() =>
      execFileSync('node', [PRUNE], {
        cwd: dir,
        env: { ...process.env, SHARD_INDEX: '5', SHARD_TOTAL: '4' },
        stdio: 'pipe',
      }),
    ).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  test('a unit larger than the per-shard mean straddles shards; pages stay disjoint with full union', () => {
    // The aws_ec2 pattern: one unit whose page count exceeds the
    // ideal per-shard mean. Without splitting, the LPT floor is that unit
    // (759 pages at 32 shards) and no shard count can shrink it. With
    // splitting, no shard's load exceeds the mean by more than the rounding.
    const total = 4;
    const makeTree = (root: string): string[] => {
      const base = join(root, 'docs', 'v2', 'docs');
      mkdirSync(base, { recursive: true });
      writeFileSync(join(base, 'aws-cdk-lib-readme.md'), '# aws-cdk-lib\n');
      const pages: string[] = [];
      // Giant unit: 40 pages. 9 small units of 4 pages each -> 76 total,
      // mean = 19: the giant MUST straddle at least 2 shards.
      for (let p = 0; p < 39; p++) {
        pages.push(`aws-cdk-lib.aws_giant.Thing${String(p).padStart(2, '0')}.md`);
      }
      pages.push('aws-cdk-lib.aws_giant-readme.md');
      for (let i = 0; i < 9; i++) {
        const sub = `aws_small${i}`;
        for (let p = 0; p < 3; p++) {
          pages.push(`aws-cdk-lib.${sub}.Thing${p}.md`);
        }
        pages.push(`aws-cdk-lib.${sub}-readme.md`);
      }
      for (const page of pages) {
        writeFileSync(join(base, page), `# ${page}\n`);
      }
      return pages.sort();
    };

    const fullPages = (() => {
      const t = mkdtempSync(join(tmpdir(), 'shard-split-full-'));
      const pages = makeTree(t);
      rmSync(t, { recursive: true, force: true });
      return pages;
    })();

    const seenPages = new Set<string>();
    const shardsWithGiant = new Set<number>();
    const loads: number[] = [];
    for (let index = 0; index < total; index++) {
      const dir = mkdtempSync(join(tmpdir(), `shard-split-${index}-`));
      makeTree(dir);
      execFileSync('node', [PRUNE], {
        cwd: dir,
        env: { ...process.env, SHARD_INDEX: String(index), SHARD_TOTAL: String(total) },
      });
      const base = join(dir, 'docs/v2/docs');
      const kept = readdirSync(base).filter((f) => f.endsWith('.md') && unitFor(f) !== null);
      loads.push(kept.length);
      for (const page of kept) {
        expect(seenPages.has(page)).toBe(false); // page-level disjoint
        seenPages.add(page);
        if (page.startsWith('aws-cdk-lib.aws_giant')) shardsWithGiant.add(index);
      }
      rmSync(dir, { recursive: true, force: true });
    }
    expect([...seenPages].sort()).toEqual(fullPages); // union == full page set
    expect(shardsWithGiant.size).toBeGreaterThanOrEqual(2); // the giant straddles
    // The heaviest shard is not floored at the giant's 40 pages: without
    // splitting, LPT would have to put the whole giant on one shard.
    expect(Math.max(...loads)).toBeLessThan(40);
  });
});

describe('splitOversized', () => {
  const files = (n: number, prefix = 'p') =>
    Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}.md`);

  test('units at or under the cap pass through untouched', () => {
    const units = [
      { name: 'a', files: files(5, 'a') },
      { name: 'b', files: files(9, 'b') },
    ];
    expect(splitOversized(units, 9)).toEqual(units);
  });

  test('an oversized unit splits into near-equal contiguous sub-units under the cap', () => {
    const unit = { name: 'aws-cdk-lib/aws_ec2', files: files(10) };
    const out = splitOversized([unit], 4);
    // ceil(10/4) = 3 parts of sizes 4/3/3.
    expect(out.map((u) => u.name)).toEqual([
      'aws-cdk-lib/aws_ec2#0',
      'aws-cdk-lib/aws_ec2#1',
      'aws-cdk-lib/aws_ec2#2',
    ]);
    expect(out.map((u) => u.files.length)).toEqual([4, 3, 3]);
    // Contiguous slices in input order: concatenation reproduces the unit.
    expect(out.flatMap((u) => u.files)).toEqual(unit.files);
  });

  test('is deterministic across independent runs', () => {
    const mk = () => [
      { name: 'big', files: files(23, 'x') },
      { name: 'small', files: files(2, 'y') },
    ];
    expect(splitOversized(mk(), 7)).toEqual(splitOversized(mk(), 7));
  });
});

describe('assignShards (page-count balancing)', () => {
  test('balances shards by page count, not service count', () => {
    // One giant service (the aws-ec2 pattern) plus many small ones. Splitting
    // round-robin by name stacks the giant on top of other services, so LPT
    // must give the giant its own shard and spread the rest.
    const services = [
      { name: 'aws-ec2', pages: 3000 },
      ...Array.from({ length: 30 }, (_, i) => ({ name: `aws-small${String(i).padStart(2, '0')}`, pages: 100 })),
    ];
    const total = 4;
    const assignment = assignShards(services, total);

    const load = new Array(total).fill(0);
    services.forEach((svc, i) => {
      load[assignment[i]] += svc.pages;
    });

    // The giant's shard carries only the giant; the other 3000 small pages
    // split evenly (1000 each) across the remaining shards.
    const giantShard = assignment[0];
    expect(load[giantShard]).toBe(3000);
    load.forEach((pages, s) => {
      if (s !== giantShard) expect(pages).toBe(1000);
    });
  });

  test('is deterministic: independent runs over the same tree agree', () => {
    const services = Array.from({ length: 57 }, (_, i) => ({
      name: `aws-svc${String(i).padStart(3, '0')}`,
      pages: ((i * 37) % 11) + 1, // arbitrary but fixed unequal sizes
    }));
    const a = assignShards(services, 8);
    const b = assignShards([...services.map((s) => ({ ...s }))], 8);
    expect(a).toEqual(b);
  });

  test('ties are broken deterministically (equal pages, equal loads)', () => {
    const services = Array.from({ length: 12 }, (_, i) => ({
      name: `aws-tie${String(i).padStart(2, '0')}`,
      pages: 5,
    }));
    const a = assignShards(services, 3);
    const b = assignShards(services, 3);
    expect(a).toEqual(b);
    // Every service got a valid shard.
    a.forEach((s) => {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(3);
    });
  });
});

describe('merge-shards', () => {
  test('unions hashmap.json and overlays disjoint pages', () => {
    const work = mkdtempSync(join(tmpdir(), 'merge-'));
    const shardA = join(work, 'a');
    const shardB = join(work, 'b');
    const out = join(work, 'docs', '.vitepress', 'dist');

    // Shard A: page1 + shared chunk + hashmap subset
    mkdirSync(join(shardA, 'assets'), { recursive: true });
    writeFileSync(join(shardA, 'index.html'), '<html>A</html>');
    writeFileSync(join(shardA, 'p1.html'), '<html>p1</html>');
    writeFileSync(join(shardA, 'assets', 'shared.abc.js'), 'shared');
    writeFileSync(join(shardA, 'hashmap.json'), JSON.stringify({ p1: 'aaa' }));

    // Shard B: page2 + identical shared chunk + hashmap subset
    mkdirSync(join(shardB, 'assets'), { recursive: true });
    writeFileSync(join(shardB, 'index.html'), '<html>A</html>');
    writeFileSync(join(shardB, 'p2.html'), '<html>p2</html>');
    writeFileSync(join(shardB, 'assets', 'shared.abc.js'), 'shared');
    writeFileSync(join(shardB, 'hashmap.json'), JSON.stringify({ p2: 'bbb' }));

    execFileSync('node', [MERGE, out, shardA, shardB], { cwd: work });

    expect(existsSync(join(out, 'p1.html'))).toBe(true);
    expect(existsSync(join(out, 'p2.html'))).toBe(true);
    expect(existsSync(join(out, 'assets', 'shared.abc.js'))).toBe(true);
    const merged = JSON.parse(readFileSync(join(out, 'hashmap.json'), 'utf-8'));
    expect(merged).toEqual({ p1: 'aaa', p2: 'bbb' });

    // projen's receiveArgs forwards the CLI `--` separator; merge must ignore
    // it rather than treat it as a shard dir.
    rmSync(out, { recursive: true, force: true });
    execFileSync('node', [MERGE, out, '--', shardA, shardB], { cwd: work });
    expect(existsSync(join(out, 'p1.html'))).toBe(true);
    expect(existsSync(join(out, 'p2.html'))).toBe(true);

    rmSync(work, { recursive: true, force: true });
  });

  test('refuses an out directory outside the dist root before deleting anything', () => {
    const work = mkdtempSync(join(tmpdir(), 'merge-'));
    const shard = join(work, 'a');
    mkdirSync(shard, { recursive: true });
    writeFileSync(join(shard, 'index.html'), '<html>A</html>');
    const outside = join(work, 'elsewhere');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'keep.txt'), 'keep');

    for (const out of [outside, join(work, 'docs', '.vitepress', 'dist', '..', '..', 'x'), '/']) {
      expect(() => execFileSync('node', [MERGE, out, shard], { cwd: work, stdio: 'pipe' })).toThrow(/outside/);
    }
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);

    // The dist root itself and the hosted sub-path both merge.
    for (const out of [join(work, 'docs', '.vitepress', 'dist'), join(work, 'docs', '.vitepress', 'dist', 'cdk', 'api')]) {
      execFileSync('node', [MERGE, out, shard], { cwd: work });
      expect(existsSync(join(out, 'index.html'))).toBe(true);
    }

    rmSync(work, { recursive: true, force: true });
  });

  test('rejects prototype-shaped hashmap keys and keeps ordinary ones', () => {
    const work = mkdtempSync(join(tmpdir(), 'merge-'));
    const out = join(work, 'docs', '.vitepress', 'dist');
    const shard = join(work, 'a');
    mkdirSync(shard, { recursive: true });
    writeFileSync(join(shard, 'index.html'), '<html>A</html>');

    for (const key of ['__proto__', 'constructor', 'prototype']) {
      writeFileSync(join(shard, 'hashmap.json'), `{"ok":"aaa",${JSON.stringify(key)}:{"polluted":true}}`);
      expect(() => execFileSync('node', [MERGE, out, shard], { cwd: work, stdio: 'pipe' })).toThrow(key);
    }

    writeFileSync(join(shard, 'hashmap.json'), JSON.stringify({ 'ok': 'aaa', 'v2_docs_x.md': 'bbb' }));
    execFileSync('node', [MERGE, out, shard], { cwd: work });
    expect(JSON.parse(readFileSync(join(out, 'hashmap.json'), 'utf-8'))).toEqual({ 'ok': 'aaa', 'v2_docs_x.md': 'bbb' });

    rmSync(work, { recursive: true, force: true });
  });
});

describe('shard-verify', () => {
  /** Build a minimal docs tree + dist with the given md/html page counts. */
  function fakeBuild(mdPages: number, htmlPages: number): string {
    const root = mkdtempSync(join(tmpdir(), 'shard-verify-'));
    const docs = join(root, 'docs');
    const dist = join(docs, '.vitepress', 'dist');
    mkdirSync(dist, { recursive: true });
    for (let i = 0; i < mdPages; i++) {
      writeFileSync(join(docs, `page${i}.md`), `# page ${i}\n`);
    }
    for (let i = 0; i < htmlPages; i++) {
      writeFileSync(join(dist, `page${i}.html`), '<html></html>');
    }
    return root;
  }

  test('passes when every markdown page has a rendered HTML page', () => {
    const root = fakeBuild(3, 3);
    expect(() => execFileSync('node', [VERIFY], { cwd: root })).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  test('fails when the dist has fewer HTML pages than markdown sources (OOM-dropped pages)', () => {
    const root = fakeBuild(3, 0);
    expect(() => execFileSync('node', [VERIFY], { cwd: root })).toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  test('fails when the dist directory is missing entirely', () => {
    const root = mkdtempSync(join(tmpdir(), 'shard-verify-nodist-'));
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'index.md'), '# hi\n');
    expect(() => execFileSync('node', [VERIFY], { cwd: root })).toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  test('ignores srcExclude trees (adr/, spike/) and .vitepress when counting sources', () => {
    const root = fakeBuild(2, 2);
    for (const excluded of ['adr', 'spike']) {
      mkdirSync(join(root, 'docs', excluded), { recursive: true });
      writeFileSync(join(root, 'docs', excluded, 'not-built.md'), '# excluded\n');
    }
    // Pages under docs/.vitepress (e.g. theme docs) are never built either.
    writeFileSync(join(root, 'docs', '.vitepress', 'note.md'), '# internal\n');
    expect(() => execFileSync('node', [VERIFY], { cwd: root })).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });
});
