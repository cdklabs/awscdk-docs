import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, matchesGlob, resolve } from 'path';

// Reads the generated Jest config: which files coverage measures has no output a test run can observe about itself.
const root = resolve(import.meta.dirname, '..');
const jest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).jest;
const patterns: string[] = jest.collectCoverageFrom;
const includes = patterns.filter((p) => !p.startsWith('!'));
const excludes = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1));

const UNMEASURED = [/\.vue$/, /^\.projenrc\.ts$/];

function measured(file: string): boolean {
  return includes.some((p) => matchesGlob(file, p)) && !excludes.some((p) => matchesGlob(file, p));
}

const sources = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|mts|cts|tsx|js|mjs|cjs|vue)$/.test(f))
  .filter((f) => !f.startsWith('test/') && !f.endsWith('.d.ts'));

describe('Jest coverage scope', () => {
  test('every tracked source file is measured unless it is a Vue component or the projen config', () => {
    const missing = sources.filter((f) => !measured(f) && !UNMEASURED.some((re) => re.test(f)));
    expect(sources.length).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });

  test('test helpers and build output are not measured', () => {
    expect(measured('test/hashed-assets.ts')).toBe(false);
    expect(measured('docs/.vitepress/cache/deps/vue.ts')).toBe(false);
    expect(measured('docs/.vitepress/dist/assets/app.ts')).toBe(false);
  });

  test('the test task holds the full run to a floor on every coverage metric', () => {
    const tasks = JSON.parse(readFileSync(join(root, '.projen/tasks.json'), 'utf8')).tasks;
    const jestArgs: string[] = tasks.test.steps.find((s: { execArgs?: string[] }) => s.execArgs?.[0] === 'jest').execArgs;
    const flag = jestArgs.find((a) => a.startsWith('--coverageThreshold='))!;
    const floor = JSON.parse(flag.slice('--coverageThreshold='.length)).global;
    for (const metric of ['lines', 'statements', 'branches', 'functions']) {
      expect(floor[metric]).toBeGreaterThanOrEqual(80);
    }
  });

  test('the Jest config itself has no floor, so a single-file run is not held to it', () => {
    expect(jest.coverageThreshold).toBeUndefined();
  });
});
