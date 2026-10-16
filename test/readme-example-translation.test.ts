import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { renderApiOverviewPage, renderOverviewPage, TypeEntry } from '../src/docgen/index.js';
import { Language } from '../src/docgen/languages.js';
import { EMPTY_TABLET, loadTablet, parseTablet } from '../src/docgen/rosetta.js';

/**
 * README example translation: README code examples must flip
 * with the shared language state like every other Model B variant region,
 * sourced from the package's jsii-rosetta tablet rather than transliterated.
 */

const LANGS: Language[] = ['ts', 'python', 'java', 'dotnet', 'go'];

const TS_EXAMPLE = "const bucket = new s3.Bucket(this, 'MyFirstBucket');";

/** A tablet whose sole snippet is a README example with all translations. */
function tabletJson(moduleFqn = 'fake.sub', source = TS_EXAMPLE): string {
  return JSON.stringify({
    version: '2',
    toolVersion: '5.9.56',
    snippets: {
      abc123: {
        location: { api: { api: 'moduleReadme', moduleFqn }, field: { field: 'markdown', line: 7 } },
        translations: {
          $: { source, version: '0' },
          python: { source: 'bucket = s3.Bucket(self, "MyFirstBucket")', version: '2' },
          java: { source: 'Bucket bucket = new Bucket(this, "MyFirstBucket");', version: '1' },
          csharp: { source: 'var bucket = new Bucket(this, "MyFirstBucket");', version: '1' },
          go: { source: 'bucket := awss3.NewBucket(this, jsii.String("MyFirstBucket"))', version: '1' },
        },
      },
      // A per-type example, NOT a README one: must never be offered for a
      // README fence, or a type page's snippet could leak onto an overview.
      def456: {
        location: { api: { api: 'type', fqn: 'fake.sub.Widget' }, field: { field: 'markdown' } },
        translations: {
          $: { source: 'const other = 1;', version: '0' },
          python: { source: 'other = 1', version: '2' },
        },
      },
    },
  });
}

const types: TypeEntry[] = [
  { name: 'Widget', kind: 'Class', summary: 'A widget.', link: '/v2/docs/fake.sub.Widget', type: {} as any },
];

function readme(fences: string[][]): string {
  return ['# Lib', '', 'Define a bucket.', '', ...fences.flat()].join('\n');
}

describe('parseTablet', () => {
  test('indexes README snippets by module fqn and visible TypeScript source', () => {
    const tablet = parseTablet(tabletJson());
    const translations = tablet.translationsFor('fake.sub', TS_EXAMPLE);
    expect(translations).toBeDefined();
    // `dotnet` is the docgen's language id for the tablet's `csharp` key.
    expect(translations!.dotnet).toBe('var bucket = new Bucket(this, "MyFirstBucket");');
    expect(translations!.python).toBe('bucket = s3.Bucket(self, "MyFirstBucket")');
    expect(translations!.ts).toBe(TS_EXAMPLE);
  });

  test('matches on trimmed source, and misses on another module or an unknown fence', () => {
    const tablet = parseTablet(tabletJson());
    expect(tablet.translationsFor('fake.sub', `\n${TS_EXAMPLE}\n`)).toBeDefined();
    expect(tablet.translationsFor('fake.other', TS_EXAMPLE)).toBeUndefined();
    expect(tablet.translationsFor('fake.sub', 'const nope = 1;')).toBeUndefined();
  });

  test('ignores snippets that are not README examples', () => {
    // The per-type snippet in the fixture must not be reachable as a README
    // example under any module key.
    const tablet = parseTablet(tabletJson());
    expect(tablet.translationsFor('fake.sub', 'const other = 1;')).toBeUndefined();
    expect(tablet.translationsFor('fake.sub.Widget', 'const other = 1;')).toBeUndefined();
  });

  test('a package with no tablet degrades to no translations, it does not throw', () => {
    expect(loadTablet(import.meta.dirname).translationsFor('fake.sub', TS_EXAMPLE)).toBeUndefined();
    expect(EMPTY_TABLET.translationsFor('fake.sub', TS_EXAMPLE)).toBeUndefined();
  });

  test('reads and inflates a real gzipped tablet from a package directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabl-'));
    writeFileSync(join(dir, '.jsii.tabl.json.gz'), gzipSync(tabletJson()));
    expect(loadTablet(dir).translationsFor('fake.sub', TS_EXAMPLE)?.go)
      .toBe('bucket := awss3.NewBucket(this, jsii.String("MyFirstBucket"))');
  });
});

describe('README example translation', () => {
  const examples = { moduleFqn: 'fake.sub', languages: LANGS, tablet: parseTablet(tabletJson()) };

  test('a translated README fence becomes one variant per enabled language', () => {
    const page = renderOverviewPage({ title: 'fake.sub', types, readme: readme([['```ts', TS_EXAMPLE, '```']]), breadcrumb: [], examples });
    expect(page).toContain("<LanguageTabs :langs=\"['ts', 'python', 'java', 'dotnet', 'go']\">");
    for (const lang of LANGS) {
      expect(page).toContain(`data-lang="${lang}"`);
    }
    expect(page).toContain('```python\nbucket = s3.Bucket(self, "MyFirstBucket")\n```');
    expect(page).toContain('```csharp\nvar bucket = new Bucket(this, "MyFirstBucket");\n```');
    expect(page).toContain('```java\nBucket bucket = new Bucket(this, "MyFirstBucket");\n```');
    expect(page).toContain('```go\nbucket := awss3.NewBucket(this, jsii.String("MyFirstBucket"))\n```');
    expect(page).toContain(`\`\`\`ts\n${TS_EXAMPLE}\n\`\`\``);
  });

  test('example variants sit OUTSIDE the v-pre container so LanguageTabs compiles', () => {
    const page = renderOverviewPage({ title: 'fake.sub', types, readme: readme([['```ts', TS_EXAMPLE, '```']]), breadcrumb: [], examples });
    // The prose before the fence is still shielded, and the group opens
    // only after that container has closed.
    const proseOpen = page.indexOf('<div v-pre>');
    const proseClose = page.indexOf('</div>', proseOpen);
    const tabsOpen = page.indexOf('<LanguageTabs');
    expect(proseOpen).toBeGreaterThanOrEqual(0);
    expect(tabsOpen).toBeGreaterThan(proseClose);
    expect(page).toContain('Define a bucket.');
    // Non-canonical example variants stay hydrated: `v-pre` there would ship
    // VitePress's copy-code button dead on every non-TypeScript tab.
    expect(page).not.toMatch(/data-lang="python"[^>]*v-pre/);
  });

  test('an untranslated fence stays inside the v-pre container, unchanged', () => {
    const body = readme([
      ['```json', '{ "a": 1 }', '```'],
      [''],
      ['```ts', 'const untranslated = 1;', '```'],
    ]);
    const page = renderOverviewPage({ title: 'fake.sub', types, readme: body, breadcrumb: [], examples });
    expect(page).not.toContain('<LanguageTabs');
    expect(page).toContain('{ "a": 1 }');
    expect(page).toContain('const untranslated = 1;');
  });

  test('an indented opener does not stop a later column-0 fence from lifting', () => {
    // A legally-indented opener must not consume the next column-0 fence.
    const body = [
      '# Lib',
      '',
      'Indented but legal fence:',
      '',
      ' ```ts',
      'const docker = 1;',
      '```',
      '',
      'Translated fence:',
      '',
      '```ts',
      TS_EXAMPLE,
      '```',
    ].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme: body, breadcrumb: [], examples });
    expect(page).toContain('<LanguageTabs');
    expect(page).toContain('bucket = s3.Bucket(self, "MyFirstBucket")');
    // The indented fence itself is never lifted.
    expect(page).toContain('const docker = 1;');
  });

  test('a fence indented inside a list item stays in the prose container, translations or not', () => {
    // Deliberate exclusion (see splitReadmeExamples): only column-0 fences are
    // candidates. Lifting an indented fence out of its list to make a
    // <LanguageTabs> group would break the list structure, so it keeps the
    // authored TypeScript in the v-pre container even though the tablet
    // carries every translation for it. 34 aws-cdk-lib README fences hit
    // this as of 2026-08 (aws_eks, aws_eks_v2, aws_elasticsearch).
    const body = [
      '# Lib',
      '',
      '1. Create a bucket:',
      '',
      '   ```ts',
      `   ${TS_EXAMPLE}`,
      '   ```',
      '',
      '2. Done.',
    ].join('\n');
    // The tablet DOES have translations for the trimmed fence body — the
    // exclusion must come from the fence position, not a tablet miss.
    expect(examples.tablet.translationsFor('fake.sub', TS_EXAMPLE)).toBeDefined();
    const page = renderOverviewPage({ title: 'fake.sub', types, readme: body, breadcrumb: [], examples });
    expect(page).not.toContain('<LanguageTabs');
    expect(page).not.toContain('bucket = s3.Bucket(self, "MyFirstBucket")');
    // The indented fence survives verbatim inside the shielded container.
    const container = page.slice(page.indexOf('<div v-pre>'), page.indexOf('</div>'));
    expect(container).toContain(`   \`\`\`ts\n   ${TS_EXAMPLE}\n   \`\`\``);
  });

  test('a variant missing its translation falls back to a fence tagged ts, not the requested language', () => {
    // A snippet rosetta translated for some languages but not `go`: the Go
    // tab must carry the TypeScript source in a ```ts fence — stamping
    // ```go would highlight (and offer for copy) TS mislabeled as Go.
    const partial = JSON.parse(tabletJson());
    delete partial.snippets.abc123.translations.go;
    const page = renderOverviewPage({ title: 'fake.sub', types, readme: readme([['```ts', TS_EXAMPLE, '```']]), breadcrumb: [], examples: { moduleFqn: 'fake.sub', languages: LANGS, tablet: parseTablet(JSON.stringify(partial)) } });
    const goVariant = page.slice(page.indexOf('data-lang="go"'));
    expect(goVariant).toContain(`\`\`\`ts\n${TS_EXAMPLE}\n\`\`\``);
    expect(goVariant).not.toContain('```go');
    // The translated variants are unaffected.
    expect(page).toContain('```python\nbucket = s3.Bucket(self, "MyFirstBucket")\n```');
  });

  test('without options the rendering is byte-identical to the single-container form', () => {
    const body = readme([['```ts', TS_EXAMPLE, '```']]);
    const single = renderOverviewPage({
      title: 'fake.sub',
      types,
      readme: body,
      breadcrumb: [],
      examples: {
        ...examples,
        languages: ['ts'],
      },
    });
    expect(renderOverviewPage({ title: 'fake.sub', types, readme: body })).toBe(single);
    expect(single).not.toContain('<LanguageTabs');
  });

  test('the /api/ overview page translates the root README examples too', () => {
    const assembly: any = {
      name: 'fake',
      readme: { markdown: readme([['```ts', TS_EXAMPLE, '```']]) },
    };
    const page = renderApiOverviewPage(assembly, {
      moduleFqn: 'fake',
      languages: LANGS,
      tablet: parseTablet(tabletJson('fake')),
    });
    expect(page).toContain('<LanguageTabs');
    expect(page).toContain('```python\nbucket = s3.Bucket(self, "MyFirstBucket")\n```');
  });

  test('prose between two translated fences keeps its own shielded container', () => {
    const body = [
      '# Lib',
      '',
      'First.',
      '',
      '```ts',
      TS_EXAMPLE,
      '```',
      '',
      'Between with {braces}.',
      '',
      '```ts',
      TS_EXAMPLE,
      '```',
      '',
      'Last.',
    ].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme: body, breadcrumb: [], examples });
    expect(page.match(/<LanguageTabs/g)).toHaveLength(2);
    expect(page).toContain('Between with &#123;braces&#125;.');
    expect(page).toContain('Last.');
    // Every prose container is balanced.
    expect(page.match(/<div v-pre>/g)).toHaveLength(3);
  });
});
