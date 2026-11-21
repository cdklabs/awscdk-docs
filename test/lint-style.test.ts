import { execFileSync } from 'child_process';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');

interface LintMessage { ruleId: string | null; message: string }

// Lints a snippet as if it were a source file in the TypeScript project, with the repo's ESLint config.
function lint(source: string): LintMessage[] {
  let out: string;
  try {
    out = execFileSync('npx', ['eslint', '--format', 'json', '--stdin', '--stdin-filename', 'src/docgen/cli.ts'], {
      cwd: root,
      input: source,
      encoding: 'utf8',
      env: { ...process.env, ESLINT_USE_FLAT_CONFIG: 'false', NODE_NO_WARNINGS: '1' },
    });
  } catch (err) {
    const e = err as { stdout: string; stderr: string };
    if (!e.stdout) throw new Error(e.stderr);
    out = e.stdout;
  }
  return JSON.parse(out)[0].messages;
}

function rulesHit(source: string): Set<string | null> {
  return new Set(lint(source).map((m) => m.ruleId));
}

// Each case starts an ESLint process with type-aware parsing, which can take seconds on a busy runner.
const TIMEOUT = 60_000;

describe('stylistic lint rules', () => {
  test('clean code passes', () => {
    expect(lint("export const a = { b: 'x', c: 1 };\n")).toEqual([]);
  }, TIMEOUT);

  test('style violations are reported by the stylistic plugin', () => {
    expect(rulesHit('export   const a = {b:"x" ,  c: 1}\n')).toEqual(new Set([
      '@stylistic/no-multi-spaces',
      '@stylistic/object-curly-spacing',
      '@stylistic/key-spacing',
      '@stylistic/quotes',
      '@stylistic/comma-spacing',
      '@stylistic/semi',
    ]));
  }, TIMEOUT);

  test('indentation and trailing commas are enforced', () => {
    expect(rulesHit('export const a = [\n    1,\n    2\n];\n')).toEqual(new Set(['@stylistic/indent', '@stylistic/comma-dangle']));
  }, TIMEOUT);

  test('braces of interfaces and enums need inner spaces', () => {
    expect(rulesHit('export interface A {b: string}\nexport enum E {X, Y}\n')).toEqual(new Set(['@stylistic/object-curly-spacing']));
  }, TIMEOUT);

  test('type members use semicolon delimiters and consistent brace newlines', () => {
    expect(rulesHit('export type A = { b: string,\n  c: number };\n'))
      .toEqual(new Set(['@stylistic/object-curly-newline', '@stylistic/member-delimiter-style']));
  }, TIMEOUT);

  test('a space is required after catch and before a namespace body', () => {
    expect(rulesHit('try {\n  JSON.parse(\'\');\n} catch(e) {\n  void e;\n}\nexport namespace N{\n  export const a = 1;\n}\n'))
      .toEqual(new Set(['@stylistic/space-before-function-paren', '@stylistic/space-before-blocks']));
  }, TIMEOUT);
});
