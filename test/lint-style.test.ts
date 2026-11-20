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
    out = (err as { stdout: string }).stdout;
  }
  return JSON.parse(out)[0].messages;
}

describe('stylistic lint rules', () => {
  test('clean code passes', () => {
    expect(lint("export const a = { b: 'x', c: 1 };\n")).toEqual([]);
  });

  test('style violations are reported by the stylistic plugin', () => {
    const rules = new Set(lint('export   const a = {b:"x" ,  c: 1}\n').map((m) => m.ruleId));
    expect(rules).toEqual(new Set([
      '@stylistic/no-multi-spaces',
      '@stylistic/object-curly-spacing',
      '@stylistic/key-spacing',
      '@stylistic/quotes',
      '@stylistic/comma-spacing',
      '@stylistic/semi',
    ]));
  });

  test('indentation and trailing commas are enforced', () => {
    const rules = new Set(lint('export const a = [\n    1,\n    2\n];\n').map((m) => m.ruleId));
    expect(rules).toEqual(new Set(['@stylistic/indent', '@stylistic/comma-dangle']));
  });
});
