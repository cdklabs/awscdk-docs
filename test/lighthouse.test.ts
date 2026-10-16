import { spawn } from 'child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'fs';
import { get as httpGet } from 'http';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
const require = createRequire(import.meta.url);

const ROOT = resolve(import.meta.dirname, '..');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const budget = require('../scripts/lighthouse-budget.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const runner = require('../scripts/lighthouse-run.cjs');

/**
 * Guards the Lighthouse performance gate: the maintainer-confirmed
 * thresholds (score 90, 400KB gzipped JS+CSS), the gzip-served collect step
 * those bytes are measured against, the combined budget Lighthouse cannot
 * express, and the projen-generated workflow that runs it.
 */
describe('Lighthouse performance gate', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(ROOT, 'package.json'), 'utf-8'),
  );
  const tasks = JSON.parse(
    readFileSync(resolve(ROOT, '.projen/tasks.json'), 'utf-8'),
  ).tasks;
  const config = JSON.parse(readFileSync(resolve(ROOT, 'lighthouse.config.json'), 'utf-8'));

  // Config shape with no produced-output counterpart: which runner is
  // installed, and which one was dropped, leaves no trace in the site it
  // measures.
  test('lighthouse is a devDependency, @lhci/cli is gone', () => {
    expect(packageJson.devDependencies.lighthouse).toBeDefined();
    expect(packageJson.devDependencies['@lhci/cli']).toBeUndefined();
  });

  describe('lighthouse.config.json', () => {
    test('asserts the confirmed performance score of 90', () => {
      expect(config.minScore).toBe(0.9);
    });

    test('audits the homepage, a module overview and a construct detail page', () => {
      const paths = config.urls.map((u: string) => new URL(u).pathname);
      expect(paths).toEqual([
        '/',
        '/v2/docs/aws-cdk-lib.aws_sqs-readme.html',
        '/v2/docs/aws-cdk-lib.aws_sns.Topic.html',
      ]);
    });

    test('medians over three runs per page', () => {
      expect(config.numberOfRuns).toBe(3);
    });
  });

  describe('lighthouse invocation', () => {
    test('pins the audit shape: performance only, desktop, headless, JSON+HTML', () => {
      const args = runner.lighthouseArgs('http://127.0.0.1:1234/', '/tmp/out');
      expect(args[0]).toBe('http://127.0.0.1:1234/');
      expect(args).toContain('--only-categories=performance');
      expect(args).toContain('--preset=desktop');
      expect(args).toContain('--chrome-flags=--headless=new');
      expect(args).toContain('--output=json');
      expect(args).toContain('--output=html');
      expect(args).toContain('--output-path=/tmp/out');
      expect(args).toContain('--blocked-url-patterns=*docs.aws.amazon.com*');
    });
  });

  describe('median score assertion', () => {
    const report = (url: string, score: number | null) => ({
      requestedUrl: url,
      categories: { performance: { score } },
    });

    test('even run counts take the lower middle, never rounding a failure up', () => {
      expect(runner.median([0.8, 1.0])).toBe(0.8);
      expect(runner.median([0.7, 0.95, 1.0])).toBe(0.95);
      expect(runner.median([1.0])).toBe(1.0);
    });

    test('fails a page whose median is below the threshold', () => {
      const { failures } = runner.assertScores([
        report('http://x/a', 0.95),
        report('http://x/a', 0.85),
        report('http://x/a', 0.8),
      ], 0.9);
      expect(failures).toHaveLength(1);
      expect(failures[0].score).toBe(0.85);
    });

    test('passes when every page medians at or above the threshold', () => {
      const { results, failures } = runner.assertScores([
        report('http://x/a', 0.9),
        report('http://x/b', 1.0),
      ], 0.9);
      expect(results).toHaveLength(2);
      expect(failures).toHaveLength(0);
    });

    test('a null score (Lighthouse runtime error) throws rather than being skipped', () => {
      expect(() => runner.assertScores([report('http://x/a', null)], 0.9))
        .toThrow(/no performance score/);
    });
  });

  describe('docs:lighthouse task', () => {
    const task = tasks['docs:lighthouse'];

    test('builds the fixture, then asserts score then budget', () => {
      const steps = task.steps;
      expect(steps[0]).toEqual({ spawn: 'docs:generate' });
      expect(steps[1].exec).toBe('node scripts/e2e-fixture-prune.cjs');
      expect(steps[2].exec).toContain('vitepress build docs');
      expect(steps[3].exec).toBe('node scripts/lighthouse-run.cjs');
      expect(steps[4].exec).toBe('node scripts/lighthouse-budget.cjs');
    });

    test('the runner does not override the configured URL list', () => {
      // Only the port is substituted; a subset would shrink the audit while
      // still reporting success.
      const urls = runner.urlsForPort(12345);
      expect(urls).toHaveLength(config.urls.length);
      expect(urls.map((u: string) => new URL(u).pathname)).toEqual(
        config.urls.map((u: string) => new URL(u).pathname),
      );
      expect(new Set(urls.map((u: string) => new URL(u).port))).toEqual(new Set(['12345']));
    });

    // Config shape with no produced-output counterpart: a step that must NOT
    // run produces nothing an output check could look for.
    test('is not part of the default build task', () => {
      const collectSpawns = (name: string, seen = new Set<string>()): Set<string> => {
        if (seen.has(name)) return seen;
        seen.add(name);
        for (const step of tasks[name]?.steps ?? []) {
          if (step.spawn) collectSpawns(step.spawn, seen);
        }
        return seen;
      };
      expect(collectSpawns('build')).not.toContain('docs:lighthouse');
    });
  });

  describe('combined gzipped JS+CSS budget', () => {
    const report = (script: number, stylesheet: number, url = 'https://example.test/') => ({
      finalDisplayedUrl: url,
      audits: {
        'resource-summary': {
          details: {
            items: [
              { resourceType: 'total', transferSize: script + stylesheet + 5000 },
              { resourceType: 'script', transferSize: script },
              { resourceType: 'stylesheet', transferSize: stylesheet },
              { resourceType: 'image', transferSize: 900_000 },
            ],
          },
        },
      },
    });

    test('the budget is 400KB', () => {
      expect(budget.BUDGET_BYTES).toBe(400 * 1024);
    });

    test('sums script and stylesheet, ignoring other resource types', () => {
      const m = budget.measure(report(300_000, 20_000));
      expect(m.bytes).toBe(320_000);
      expect(m.url).toBe('https://example.test/');
    });

    test('passes a page inside the budget', () => {
      const { violations } = budget.check([report(300_000, 20_000)]);
      expect(violations).toHaveLength(0);
    });

    test('fails a page whose JS and CSS only exceed the budget COMBINED', () => {
      // 300KB each: within any per-resource-type 400KB cap, over the
      // combined budget — the case Lighthouse budgets cannot express.
      const { violations } = budget.check([report(300 * 1024, 300 * 1024)]);
      expect(violations).toHaveLength(1);
      expect(violations[0].bytes).toBe(600 * 1024);
    });

    test('reports a missing resource type as zero rather than throwing', () => {
      // items is PRESENT but empty — a page that ships neither JS nor CSS.
      const m = budget.measure({ audits: { 'resource-summary': { details: { items: [] } } } });
      expect(m.bytes).toBe(0);
      expect(m.breakdown).toEqual({ script: 0, stylesheet: 0 });
    });

    test('throws when the resource-summary audit is absent, rather than measuring zero', () => {
      // resource-summary is a hidden diagnostic audit, so a lighthouse bump
      // could rename or drop it. Measuring zero would pass the budget while
      // measuring nothing.
      expect(() => budget.measure({
        finalDisplayedUrl: 'https://example.test/p',
        audits: {},
      })).toThrow(/resource-summary/);
      expect(() => budget.measure({ audits: {} })).toThrow(/no resource-summary audit items/);
    });

    test('names the offending URL when it throws', () => {
      expect(() => budget.measure({
        finalDisplayedUrl: 'https://example.test/broken',
        audits: { 'resource-summary': { details: {} } },
      })).toThrow(/https:\/\/example\.test\/broken/);
    });

    test('flags only the offending page when several are audited', () => {
      const { measurements, violations } = budget.check([
        report(100_000, 10_000, 'https://example.test/ok'),
        report(500 * 1024, 10_000, 'https://example.test/fat'),
      ]);
      expect(measurements).toHaveLength(2);
      expect(violations.map((v: any) => v.url)).toEqual(['https://example.test/fat']);
    });

    test('collapses repeated runs of one URL to the worst run', () => {
      // One report per run per URL; the gate must not let a lighter run
      // excuse a heavier one.
      const { measurements, violations } = budget.check([
        report(100_000, 10_000, 'https://example.test/p'),
        report(500 * 1024, 10_000, 'https://example.test/p'),
        report(120_000, 10_000, 'https://example.test/p'),
      ]);
      expect(measurements).toHaveLength(1);
      expect(measurements[0].bytes).toBe(500 * 1024 + 10_000);
      expect(violations).toHaveLength(1);
    });
  });

  test('the budget script the gate invokes exists', () => {
    expect(existsSync(resolve(ROOT, 'scripts/lighthouse-budget.cjs'))).toBe(true);
  });

  describe('stale report hygiene', () => {
    // Without this the budget check reads earlier runs' reports as if they
    // belonged to this one.
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'lh-reports-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test('removes reports left by an earlier run', () => {
      writeFileSync(join(dir, 'host-_-20260101.report.json'), '{}');
      writeFileSync(join(dir, 'lhr-1735689600000.json'), '{}');
      writeFileSync(join(dir, 'host-_-20260101.report.html'), '<html></html>');
      runner.clearReports(dir);
      expect(readdirSync(dir)).toHaveLength(0);
    });

    test('is a no-op when the directory does not exist', () => {
      expect(() => runner.clearReports(join(dir, 'missing'))).not.toThrow();
    });
  });

  describe('audited pages must really be served', () => {
    // --only-categories=performance means Lighthouse never runs
    // http-status-code, so it would score the 404 page — which is small and
    // fast, so it passes both gates while measuring nothing.
    test('reports every non-200 page', async () => {
      const status: Record<string, number> = {
        'http://x/ok': 200,
        'http://x/missing': 404,
        'http://x/boom': 500,
      };
      const bad = await runner.checkUrls(
        Object.keys(status),
        async (u: string) => ({ status: status[u] }),
      );
      expect(bad.map((b: any) => b.url)).toEqual(['http://x/missing', 'http://x/boom']);
    });

    test('passes when every page returns 200', async () => {
      const bad = await runner.checkUrls(
        ['http://x/a', 'http://x/b'],
        async () => ({ status: 200 }),
      );
      expect(bad).toEqual([]);
    });

    test('treats a connection error as a failure rather than throwing', async () => {
      const bad = await runner.checkUrls(['http://x/a'], async () => {
        throw new Error('ECONNREFUSED');
      });
      expect(bad).toHaveLength(1);
      expect(bad[0].status).toBe('ECONNREFUSED');
    });
  });

  describe('static server gate mode (behavioral)', () => {
    // Every byte the budget compares against depends on this behavior, so it
    // is tested against a running server rather than by grepping the source.
    const HASHED = 'assets/style.CF53hZYg.css';
    const UNHASHED = 'plain.css';
    const RAW = '.a{color:red}'.repeat(3000);

    // Each of these spawns a Node process and waits on its stdout, inside a
    // 58-suite run where workers contend. The per-test timeout MUST exceed the
    // boot guard: with Jest's 5s default the guard can never fire, so a slow
    // boot reports an unrelated Jest timeout while boot's promise is still
    // pending — `finally` never runs and the server is orphaned on its port.
    const BOOT_GUARD_MS = 15_000;
    const TEST_TIMEOUT_MS = BOOT_GUARD_MS + 5_000;

    let fixture: string;

    beforeAll(() => {
      fixture = mkdtempSync(join(tmpdir(), 'lh-serve-'));
      mkdirSync(join(fixture, 'assets'), { recursive: true });
      writeFileSync(join(fixture, HASHED), RAW);
      writeFileSync(join(fixture, UNHASHED), RAW);
    });
    afterAll(() => {
      rmSync(fixture, { recursive: true, force: true });
    });

    /** Boot the server on an OS-assigned port and resolve the bound port. */
    const boot = (env: NodeJS.ProcessEnv): Promise<{ port: number; stop: () => void }> =>
      new Promise((res, rej) => {
        const child = spawn(process.execPath, [resolve(ROOT, 'scripts/e2e-serve.cjs'), '0'], {
          cwd: ROOT,
          env: { ...process.env, E2E_SERVE_ROOT: fixture, ...env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          rej(new Error('server did not start'));
        }, BOOT_GUARD_MS);
        child.stdout.on('data', (b: Buffer) => {
          const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(b.toString());
          if (m) {
            clearTimeout(timer);
            res({ port: Number(m[1]), stop: () => child.kill('SIGTERM') });
          }
        });
      });

    /** One raw request; returns headers and the exact bytes on the wire. */
    const get = (
      port: number,
      path_: string,
      headers: Record<string, string>,
    ): Promise<{ headers: any; bytes: number }> =>
      new Promise((res, rej) => {
        const req = httpGet(
          { host: '127.0.0.1', port, path: `/${path_}`, headers },
          (r) => {
            let bytes = 0;
            r.on('data', (c: Buffer) => {
              bytes += c.length;
            });
            r.on('end', () => res({ headers: r.headers, bytes }));
          },
        );
        req.on('error', rej);
      });

    test('gate mode gzips a CSS asset when the client accepts it', async () => {
      const s = await boot({ E2E_SERVE_GZIP: '1' });
      try {
        const r = await get(s.port, HASHED, { 'accept-encoding': 'gzip' });
        expect(r.headers['content-encoding']).toBe('gzip');
        // Highly repetitive CSS: compressed must be a small fraction of raw.
        expect(r.bytes).toBeLessThan(RAW.length / 10);
      } finally {
        s.stop();
      }
    }, TEST_TIMEOUT_MS);

    test('gate mode serves plain when the client does not accept gzip', async () => {
      const s = await boot({ E2E_SERVE_GZIP: '1' });
      try {
        const r = await get(s.port, HASHED, { 'accept-encoding': 'identity' });
        expect(r.headers['content-encoding']).toBeUndefined();
        expect(r.bytes).toBe(RAW.length);
      } finally {
        s.stop();
      }
    }, TEST_TIMEOUT_MS);

    test('default mode never gzips, so the e2e suite is unaffected', async () => {
      const s = await boot({});
      try {
        const r = await get(s.port, HASHED, { 'accept-encoding': 'gzip' });
        expect(r.headers['content-encoding']).toBeUndefined();
        expect(r.bytes).toBe(RAW.length);
      } finally {
        s.stop();
      }
    }, TEST_TIMEOUT_MS);

    test('hashed assets are immutable, unhashed get a short TTL', async () => {
      const s = await boot({ E2E_SERVE_GZIP: '1' });
      try {
        const hashed = await get(s.port, HASHED, { 'accept-encoding': 'gzip' });
        const unhashed = await get(s.port, UNHASHED, { 'accept-encoding': 'gzip' });
        expect(hashed.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(unhashed.headers['cache-control']).toBe('public, max-age=600');
      } finally {
        s.stop();
      }
    }, TEST_TIMEOUT_MS);

    test('default mode sends no cache-control at all', async () => {
      const s = await boot({});
      try {
        const r = await get(s.port, HASHED, { 'accept-encoding': 'gzip' });
        expect(r.headers['cache-control']).toBeUndefined();
      } finally {
        s.stop();
      }
    }, TEST_TIMEOUT_MS);
  });

  describe('docs-lighthouse workflow', () => {
    // Config shape with no produced-output counterpart throughout: this
    // workflow measures the site without changing it, so its call site,
    // triggers and artifact upload are observable only here.
    const workflow = readFileSync(
      resolve(ROOT, '.github/workflows/docs-lighthouse.yml'),
      'utf-8',
    );

    test('runs the gate via the projen task', () => {
      expect(workflow).toContain('npx projen docs:lighthouse');
    });

    test('runs on pull requests and in the merge queue', () => {
      expect(workflow).toContain('pull_request:');
      expect(workflow).toContain('merge_group:');
    });

    test('uploads the reports even when the gate fails', () => {
      expect(workflow).toContain('lighthouse-reports');
      expect(workflow).toContain('always()');
    });
  });
});
