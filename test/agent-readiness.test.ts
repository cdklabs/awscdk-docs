import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runner = require('../scripts/agent-readiness-run.cjs');

/**
 * Guards the agent-readiness gate: the two thresholds it asserts,
 * the port substitution that keeps the scan pointed at the local server, the
 * 200 pre-check that stops the 404 page being scored, and the report parsing
 * that has to supply the verdict because the CLI exits 0 either way.
 */
describe('agent-readiness gate', () => {
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
