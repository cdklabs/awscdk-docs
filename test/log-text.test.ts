import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sanitizeLogList, sanitizeLogText } from '../src/docgen/log-text.js';

const ROOT = resolve(import.meta.dirname, '..');
const REFRESH_CLIS = ['src/docgen/version-refresh-cli.ts', 'src/docgen/module-sync-cli.ts'];

describe('sanitizeLogText', () => {
  test('an ANSI sequence loses its introducer and renders as inert text', () => {
    expect(sanitizeLogText('\u001b[31m@aws-cdk/aws-glue-alpha\u001b[0m')).toBe('[31m@aws-cdk/aws-glue-alpha[0m');
  });

  test('carriage returns cannot overwrite what was already written', () => {
    expect(sanitizeLogText('@aws-cdk/aws-glue-alpha\rnothing moved')).toBe('@aws-cdk/aws-glue-alphanothing moved');
  });

  test('newlines cannot forge a second log line', () => {
    expect(sanitizeLogText('name\nversion-refresh: applied')).toBe('nameversion-refresh: applied');
  });

  test('every other C0 character and DEL go too', () => {
    expect(sanitizeLogText('a\u0000b\u0007c\td\u001fe\u007ff')).toBe('abcdef');
  });

  test('ordinary Unicode text is untouched', () => {
    expect(sanitizeLogText('@aws-cdk/aws-glue-alpha 2.269.0-alpha.0 — held, née, 構築, ✅')).toBe(
      '@aws-cdk/aws-glue-alpha 2.269.0-alpha.0 — held, née, 構築, ✅',
    );
  });

  test('a list is sanitized element by element', () => {
    expect(sanitizeLogList(['a\u001bb', 'plain', 'c\rd'])).toEqual(['ab', 'plain', 'cd']);
  });
});

describe('refresh CLI log sinks', () => {
  test.each(REFRESH_CLIS)('%s routes external text at every console sink', (file) => {
    // Source shape: the CLIs log from `main`, so a sink's output is not reachable from a unit test.
    const source = readFileSync(resolve(ROOT, file), 'utf-8');
    const sinks = source.match(/console\.(log|error)\((?:[^;]|\n)*?\);/g) ?? [];
    expect(sinks.length).toBeGreaterThan(3);
    const external = /\b(summary|held|missingAlphas|wanted|lines)\b|err\.message/;
    for (const sink of sinks) {
      if (!external.test(sink)) continue;
      expect(sink).toMatch(/sanitizeLog(Text|List)\(/);
    }
  });

  test.each(REFRESH_CLIS)('%s sanitizes only at the sink, never the plan it writes', (file) => {
    // Source shape: the plan file already on disk cannot show where sanitizing was skipped.
    const source = readFileSync(resolve(ROOT, file), 'utf-8');
    const body = source.split('\n').filter((line) => !line.startsWith('import ')).join('\n');
    const sinks = body.match(/console\.(log|error)\((?:[^;]|\n)*?\);/g) ?? [];
    const inSinks = sinks.join('\n').match(/sanitizeLog(Text|List)\(/g) ?? [];
    const everywhere = body.match(/sanitizeLog(Text|List)\(/g) ?? [];
    expect(everywhere.length).toBeGreaterThan(0);
    expect(everywhere).toHaveLength(inSinks.length);
  });
});
