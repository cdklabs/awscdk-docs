import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { generateDocs } from '../src/docgen/index.js';
import { parseOverviews } from '../src/docgen/overviews.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUTLINE_OFF = '---\noutline: false\n---\n\n';

// Small assemblies only: the four overview kinds are a rendering decision,
// and running them over aws-cdk-lib would add minutes for no extra signal
// (test/docgen.test.ts already covers the real library). aws-cloud9-alpha is
// here for one reason — its published README has an unterminated code fence.
const MODULES = ['constructs', '@aws-cdk/aws-lambda-python-alpha', '@aws-cdk/aws-cloud9-alpha'];

function run(overviews?: Record<string, unknown>): string {
  const outDir = mkdtempSync(join(tmpdir(), 'overview-kinds-'));
  generateDocs(
    {
      modules: MODULES,
      ...(overviews ? { overviews: parseOverviews(overviews) } : {}),
    },
    { outDir, packageRoot: ROOT, languages: ['ts'] },
  );
  return outDir;
}

describe('per-module overview kinds end to end', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
  });
  const generate = (overviews?: Record<string, unknown>) => {
    const dir = run(overviews);
    dirs.push(dir);
    return dir;
  };

  test('default (unspecified) renders the package README then the type list', () => {
    const out = generate();
    const page = readFileSync(join(out, 'docs', 'constructs-readme.md'), 'utf-8');
    // The canonical overview URL still exists — it is the breadcrumb root
    // of every type page and the versions.ts switch target.
    expect(existsSync(join(out, 'docs', 'constructs-readme.md'))).toBe(true);
    expect(page).toContain('# Constructs');
    expect(page).toContain('<div v-pre>');
    expect(page).toContain('## What are constructs?');
    // README body precedes the type list, and the documented version
    // survives the move (the README cannot carry it) while the artificial
    // index's description preamble is gone — the README says it at length.
    expect(page.indexOf('## What are constructs?')).toBeLessThan(page.indexOf('## Types'));
    expect(page).toContain('> Version ');
    expect(page.indexOf('> Version ')).toBeLessThan(page.indexOf('## What are constructs?'));
    expect(page).toContain('| Name | Kind | Summary |');
  });

  test('the separate-install alert stays above the README body', () => {
    const out = generate();
    const page = readFileSync(
      join(out, 'docs', '@aws-cdk_aws-lambda-python-alpha-readme.md'),
      'utf-8',
    );
    // Order-sensitive: an alpha README opens with its OWN install
    // instructions, so a packaging/stability caveat below the whole README
    // is a caveat the reader meets after acting on it.
    const alert = page.indexOf('::: warning Separate package');
    const firstReadmeHeading = page.search(/^## /m);
    expect(alert).toBeGreaterThan(-1);
    expect(firstReadmeHeading).toBeGreaterThan(-1);
    expect(alert).toBeLessThan(firstReadmeHeading);
    // …and the submodule/type sections still come after it.
    expect(alert).toBeLessThan(page.indexOf('## Types'));
  });

  test('an unterminated README code fence cannot swallow the page', () => {
    const out = generate();
    // aws-cloud9-alpha ships a README whose last fence is never closed —
    // published jsii READMEs are not validated markdown. Unbalanced fences
    // make markdown-it swallow the `</div>` that closes the v-pre container,
    // and the Vue compiler then fails the ENTIRE shard build with "Element
    // is missing end tag". Only package roots render their own README, so
    // no submodule page ever exercised this.
    const page = readFileSync(
      join(out, 'docs', '@aws-cdk_aws-cloud9-alpha-readme.md'),
      'utf-8',
    );
    const fences = page.split('\n').filter((l) => /^\s*(```|~~~)/.test(l)).length;
    expect(fences % 2).toBe(0);
    const opens = (page.match(/<div v-pre>/g) ?? []).length;
    expect(opens).toBeGreaterThan(0);
    expect((page.match(/<\/div>/g) ?? []).length).toBeGreaterThanOrEqual(opens);
  });

  test('kind "none" yields the table-only layout at the same URL', () => {
    const out = generate({ constructs: { kind: 'none' } });
    const page = readFileSync(join(out, 'docs', 'constructs-readme.md'), 'utf-8');
    expect(page.startsWith(OUTLINE_OFF)).toBe(true);
    expect(page).toContain('# constructs');
    expect(page).not.toContain('## What are constructs?');
    expect(page).not.toContain('<div v-pre>');
    // The page is NOT removed and still carries the type table.
    expect(page).toContain('| Name | Kind | Summary |');
  });

  test('kind "generated" reproduces the artificial index page', () => {
    const out = generate({ constructs: { kind: 'generated' } });
    const page = readFileSync(join(out, 'docs', 'constructs-readme.md'), 'utf-8');
    expect(page.startsWith(OUTLINE_OFF)).toBe(true);
    expect(page).toContain('# constructs');
    expect(page).toContain('> Version ');
    expect(page).toContain('::: info Separate package');
    expect(page).not.toContain('## What are constructs?');
  });

  test('kind "copy" renders the source README body, not its title or type list', () => {
    const out = generate({
      '@aws-cdk/aws-lambda-python-alpha': { kind: 'copy', from: 'constructs' },
    });
    const page = readFileSync(
      join(out, 'docs', '@aws-cdk_aws-lambda-python-alpha-readme.md'),
      'utf-8',
    );
    // constructs' README body, under constructs' own H1 (the copied
    // README supplies the whole body including its heading).
    expect(page).toContain('## What are constructs?');
    // …but the alpha package's own sections and types, not constructs'.
    expect(page).toContain('::: warning Separate package');
    expect(page).toContain('`PythonFunction`');
    expect(page).not.toContain('`Construct`');
    // The source module's own page is untouched.
    const source = readFileSync(join(out, 'docs', 'constructs-readme.md'), 'utf-8');
    expect(source).toContain('`Construct`');
  });

  test('an unresolvable overviews key fails the generate step, naming the key', () => {
    expect(() => generate({ 'constructs.nope': { kind: 'none' } })).toThrow(
      /"overviews"\."constructs\.nope" does not name a documented module or submodule/,
    );
  });
});
