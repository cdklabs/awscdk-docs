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
});
