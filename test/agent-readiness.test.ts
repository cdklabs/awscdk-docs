import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
const require = createRequire(import.meta.url);

const ROOT = resolve(import.meta.dirname, '..');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runner = require('../scripts/agent-readiness-run.cjs');

/**
 * Guards the agent-readiness gate: the two thresholds it asserts,
 * the port substitution that keeps the scan pointed at the local server, the
 * 200 pre-check that stops the 404 page being scored, and the report parsing
 * that has to supply the verdict because the CLI exits 0 either way.
 */
describe('agent-readiness gate', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(ROOT, 'package.json'), 'utf-8'),
  );
  const tasks = JSON.parse(
    readFileSync(resolve(ROOT, '.projen/tasks.json'), 'utf-8'),
  ).tasks;
  const config = JSON.parse(
    readFileSync(resolve(ROOT, 'agent-readiness.config.json'), 'utf-8'),
  );

  // Config shape with no produced-output counterpart: which scanner is
  // installed leaves no trace in the site it measures.
  test('botvisibility is a devDependency', () => {
    expect(packageJson.devDependencies.botvisibility).toBeDefined();
  });

  // Same absence of an observable: the task's step order decides whether the
  // scan sees a freshly built site, and the built output cannot show it.
  test('the task builds the site before scanning it', () => {
    const steps = tasks['docs:agent-readiness'].steps;
    const buildAt = steps.findIndex((s: any) => s.exec === 'vitepress build docs');
    const scanAt = steps.findIndex(
      (s: any) => s.exec === 'node scripts/agent-readiness-run.cjs',
    );
    expect(buildAt).toBeGreaterThanOrEqual(0);
    expect(scanAt).toBeGreaterThan(buildAt);
  });

  // Config shape with no produced-output counterpart: the floors are the gate's
  // verdict, and a passing site looks identical to one with no floors at all.
  test('both floors are set, and the passing-check floor is the one that can bind', () => {
    expect(config.minLevel).toBe(0);
    expect(config.minPassed).toBeGreaterThan(0);
  });

  test('only the port is substituted, so the scan keeps its configured path', () => {
    expect(runner.urlForPort('http://127.0.0.1:4173/', 5199))
      .toBe('http://127.0.0.1:5199/');
  });

  test('a non-200 response is surfaced rather than scanned', async () => {
    const status = await runner.checkUrl('http://127.0.0.1:1/', async () => ({ status: 404 }));
    expect(status).toBe(404);
  });

  test('an unreachable server is surfaced as its failure reason', async () => {
    const reason = await runner.checkUrl('http://127.0.0.1:1/', async () => {
      throw new Error('connect ECONNREFUSED');
    });
    expect(reason).toContain('ECONNREFUSED');
  });

  test('the level and the check tallies are read off the report', () => {
    expect(runner.readLevel({
      currentLevel: 2,
      score: { passed: 9, failed: 4, total: 58 },
    })).toEqual({ level: 2, passed: 9, failed: 4, total: 58 });
  });

  test('a report without a level is rejected instead of scoring zero', () => {
    expect(() => runner.readLevel({ score: { passed: 6 } }))
      .toThrow('no integer currentLevel');
    expect(() => runner.readLevel(null)).toThrow('no JSON object');
  });
});
