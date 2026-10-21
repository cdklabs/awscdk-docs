import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { convertMathFences, generateDocs, loadConfig, renderApiOverviewPage, renderOverviewPage, submoduleSegments, TypeEntry } from '../src/docgen/index.js';

const ROOT = resolve(import.meta.dirname, '..');

// Overview/index pages open with frontmatter suppressing the redundant
// right-hand outline; a blank line then the page heading follow.
const OUTLINE_OFF = '---\noutline: false\n---\n\n';

describe('renderOverviewPage', () => {
  const types: TypeEntry[] = [
    {
      name: 'Widget',
      kind: 'Class',
      summary: 'A widget.',
      link: '/v2/docs/fake.sub.Widget',
      type: {} as any,
    },
  ];

  test('prepends the README above the preview list, README H1 as page title', () => {
    const readme = [
      '# Fake Construct Library',
      '',
      'Usage:',
      '',
      '```ts',
      "new Widget(this, 'W');",
      '```',
    ].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme });
    expect(page.startsWith('# Fake Construct Library')).toBe(true);
    expect(page).not.toContain('# fake.sub');
    const readmeIdx = page.indexOf('Usage:');
    const typesIdx = page.indexOf('## Types');
    const tableIdx = page.indexOf('| Name | Kind | Summary |');
    expect(readmeIdx).toBeGreaterThan(0);
    expect(typesIdx).toBeGreaterThan(readmeIdx);
    expect(tableIdx).toBeGreaterThan(typesIdx);
    expect(page).toContain('[`Widget`](/v2/docs/fake.sub.Widget)');
  });

  test('escapes Vue-hostile prose but leaves code fences untouched, strips HTML comments', () => {
    const readme = [
      '# Lib',
      '',
      '<!--BEGIN BANNER-->',
      'Use Map<string, string> with {placeholders}.',
      '<!--END BANNER-->',
      '',
      '```ts',
      'const m = new Map<string, string>();',
      '```',
    ].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme });
    expect(page).not.toContain('<!--');
    // escapeProse escapes '<' and '{'/'}' in prose ('>' is safe as-is)
    expect(page).toContain('Map&lt;string, string> with &#123;placeholders&#125;.');
    expect(page).toContain('const m = new Map<string, string>();');
  });

  test('adds a fallback fqn title when the README has no leading heading', () => {
    const page = renderOverviewPage({ title: 'fake.sub', types, readme: 'Just some prose.' });
    expect(page.startsWith('# fake.sub')).toBe(true);
    expect(page).toContain('Just some prose.');
    expect(page).toContain('## Types');
  });

  test('no README or whitespace-only README falls back to the table-only layout', () => {
    for (const readme of [undefined, '', '  \n \n']) {
      const page = renderOverviewPage({ title: 'fake.sub', types, readme });
      expect(page.startsWith(OUTLINE_OFF + '# fake.sub')).toBe(true);
      expect(page).not.toContain('## Types');
      expect(page).toContain('| Name | Kind | Summary |');
    }
  });

  test('renders a caller-supplied breadcrumb above the heading, outside the v-pre container', () => {
    const link = '[fake](/v2/docs/fake-readme)';
    const breadcrumb = [`${link}.**fake.sub**`, ''];
    // README-backed layout: the breadcrumb sits ABOVE the hoisted H1 —
    // matching type pages, which prepend it to the whole page
    // — and outside the v-pre container, so its markdown links render as
    // real anchors (v-pre would leave them as literal text).
    const page = renderOverviewPage({ title: 'fake.sub', types, readme: '# Title\n\nProse.', breadcrumb });
    const crumbIdx = page.indexOf(link);
    expect(crumbIdx).toBeLessThan(page.indexOf('# Title'));
    expect(crumbIdx).toBeLessThan(page.indexOf('<div v-pre>'));
    // The nav block contributes no heading, so the README's own H1 is
    // still the FIRST heading in the file — which is what VitePress
    // derives the page title from. Hoisting the trail must not displace it.
    expect(page.split('\n').find((l) => /^#{1,6}\s/.test(l))).toBe('# Title');
    // Table-only layout carries the trail too, in the same order.
    const bare = renderOverviewPage({ title: 'fake.sub', types, breadcrumb });
    expect(bare.indexOf(link)).toBeLessThan(bare.indexOf('# fake.sub'));
    // ...but frontmatter still comes first of all: VitePress only parses
    // it at the very top, so a breadcrumb hoisted above it would silently
    // lose the `outline: false` frontmatter.
    expect(bare.startsWith('---\noutline: false\n---\n')).toBe(true);
    // Default: no breadcrumb, unchanged layout.
    expect(renderOverviewPage({ title: 'fake.sub', types, readme: '# Title\n\nProse.' })).not.toContain(link);
  });

  test('wraps the README body in a v-pre container so mustache/JS interpolation cannot reach the Vue compiler', () => {
    // Real aws-s3-deployment README patterns: mustache in inline code,
    // nested mustache, and a `${...}` JS template literal.
    const readme = [
      '# Bucket Deployment',
      '',
      'Template syntax is `{{ variableName }}` in your files.',
      'Nested like `{{ {{ foo }} }}` only replaces the inner one.',
      'A URL such as `https://api.example.com/${process.env.stage}/x`.',
      '',
      'And a bare mustache in prose {{ notInterpolated }} too.',
    ].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme });
    // The body sits inside a v-pre container...
    const open = page.indexOf('<div v-pre>');
    const close = page.indexOf('</div>');
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
    // ...and the interpolation-bearing text lives strictly inside it.
    const mustacheIdx = page.indexOf('{{ variableName }}');
    const nestedIdx = page.indexOf('{{ {{ foo }} }}');
    const dollarIdx = page.indexOf('${process.env.stage}');
    for (const idx of [mustacheIdx, nestedIdx, dollarIdx]) {
      expect(idx).toBeGreaterThan(open);
      expect(idx).toBeLessThan(close);
    }
    // Preview list stays outside the v-pre block.
    expect(page.indexOf('## Types')).toBeGreaterThan(close);
  });

  test('README-backed pages keep the outline and open with the hoisted H1', () => {
    const readme = ['# Lib', '', 'Body prose.', '', '## Usage', '', 'More prose.'].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme });
    // No outline-off frontmatter: the README's section headings feed the
    // right-hand "On this page" quick nav — suppression is scoped to pages
    // that merely mirror the sidebar. The hoisted H1 leads.
    expect(page).not.toContain('outline: false');
    expect(page.startsWith('# Lib')).toBe(true);
  });

  test('table-only submodule pages still suppress the outline', () => {
    const page = renderOverviewPage({ title: 'fake.sub', types });
    // Without a README the page is just the types table the sidebar
    // already mirrors — the outline stays off, and the frontmatter is
    // the very first thing on the page (VitePress parses it on line 1).
    expect(page.startsWith(OUTLINE_OFF + '# fake.sub')).toBe(true);
    expect(page.indexOf('outline: false')).toBe(page.lastIndexOf('outline: false'));
  });

  test('strips a literal inline Table of Contents list from the README', () => {
    const readme = [
      '# Lib',
      '',
      'Intro prose.',
      '',
      '## Table of Contents',
      '',
      '- [Defining APIs](#defining-apis)',
      '  - [Nested entry](#nested-entry)',
      '- [Integration Targets](#integration-targets)',
      '',
      '## Defining APIs',
      '',
      'Real content stays.',
      '',
      '```md',
      '## Table of Contents',
      '- [inside a fence, untouched](#x)',
      '```',
    ].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme });
    // The ToC heading and its link list are gone — the only surviving
    // 'Table of Contents' text is the one inside the code fence.
    expect(page.match(/Table of Contents/g)).toHaveLength(1);
    expect(page.indexOf('Table of Contents')).toBeGreaterThan(page.indexOf('```md'));
    expect(page).not.toContain('[Defining APIs](#defining-apis)');
    expect(page).not.toContain('[Nested entry](#nested-entry)');
    // …while surrounding prose, the next section, and fenced code survive.
    expect(page).toContain('Intro prose.');
    expect(page).toContain('## Defining APIs');
    expect(page).toContain('Real content stays.');
    expect(page).toContain('[inside a fence, untouched](#x)');
  });

  test('rewrites GitHub ```math fences to $$…$$ display math with TeX braces intact', () => {
    // Real aws-batch README pattern: fairshare scheduling equations in
    // GitHub-flavored math fences (a GitHub-only Markdown extension).
    const readme = [
      '# Batch',
      '',
      'Fairshare scheduling divides compute by weight:',
      '',
      '```math',
      'A_{vCpus} / A_{Weight} = B_{vCpus} / B_{Weight}',
      '```',
      '',
      'And reserves capacity as {computeReservation} percent:',
      '',
      '```math',
      '(\\frac{computeReservation}{100})^{ActiveFairShares}',
      '```',
      '',
      '```ts',
      "new FairshareSchedulingPolicy(this, 'P');",
      '```',
    ].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme });
    // There is no `math` fence (so Shiki never sees the
    // unknown language)...
    expect(page).not.toContain('```math');
    // ...and display-math blocks carry TeX braces LITERAL
    // (never `&#123;`-escaped — MathJax must parse them).
    expect(page).toContain('$$\nA_{vCpus} / A_{Weight} = B_{vCpus} / B_{Weight}\n$$');
    expect(page).toContain('$$\n(\\frac{computeReservation}{100})^{ActiveFairShares}\n$$');
    // Prose braces outside math are still escaped as before.
    expect(page).toContain('&#123;computeReservation&#125; percent');
    // A real language fence is untouched.
    expect(page).toContain("```ts\nnew FairshareSchedulingPolicy(this, 'P');\n```");
    // Math sits inside the v-pre container with the rest of the body.
    expect(page.indexOf('$$')).toBeGreaterThan(page.indexOf('<div v-pre>'));
    expect(page.lastIndexOf('$$')).toBeLessThan(page.indexOf('</div>'));
  });

  test('a math fence terminated by its blockquote is left untouched, not sliced', () => {
    // The span has no closer line, so treating its last line as one would
    // drop content.
    const md = '> Note:\n> ```math\n> a + b\n> c + d\n\nafter';
    expect(convertMathFences(md)).toBe(md);
  });

  test('rewrites GitHub inline math $`…`$ to $…$ but leaves plain code spans and fence interiors alone', () => {
    const readme = [
      '# Lib',
      '',
      'The ratio $`a_{x} / b_{y}`$ stays fixed.',
      'A normal code span `a_{x}` is not math.',
      '',
      '```ts',
      'const s = "$`not math`$";',
      '```',
    ].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme });
    expect(page).toContain('The ratio $a_{x} / b_{y}$ stays fixed.');
    // Plain inline code (no surrounding $) untouched.
    expect(page).toContain('`a_{x}` is not math');
    // Fence interiors are never rewritten.
    expect(page).toContain('const s = "$`not math`$";');
  });

  test('strips repo-relative image/link targets but keeps absolute URLs, anchors and root-absolute paths', () => {
    const readme = [
      '# Synthetics',
      '',
      'A screenshot: ![UI screenshot](./images/ui-screenshot.png)',
      'Parent image: ![diagram](../assets/diagram.svg "title")',
      'See the [contributing guide](../CONTRIBUTING.md) for details.',
      'Bare relative [changelog](CHANGELOG.md).',
      '',
      '[![npm](https://img.shields.io/npm/v/x.svg)](https://www.npmjs.com/package/x)',
      'Jump to [the section](#usage) or the [API](/v2/).',
    ].join('\n');
    const page = renderOverviewPage({ title: 'fake.sub', types, readme });
    // Relative image/link targets are gone (hard Vite bundler errors).
    expect(page).not.toContain('./images/ui-screenshot.png');
    expect(page).not.toContain('../assets/diagram.svg');
    expect(page).not.toContain('../CONTRIBUTING.md');
    expect(page).not.toContain('(CHANGELOG.md)');
    // Their alt text / label survives as plain text.
    expect(page).toContain('UI screenshot');
    expect(page).toContain('contributing guide');
    // Absolute URLs, anchors and root-absolute paths are preserved.
    expect(page).toContain('https://img.shields.io/npm/v/x.svg');
    expect(page).toContain('https://www.npmjs.com/package/x');
    expect(page).toContain('(#usage)');
    expect(page).toContain('(/v2/)');
  });
});

describe('renderApiOverviewPage', () => {
  test('hoists the README H1 and wraps the body in v-pre', () => {
    const page = renderApiOverviewPage({
      readme: { markdown: '# The Library\n\nUse {{ placeholders }} carefully.' },
    } as any);
    expect(page.startsWith('# The Library')).toBe(true);
    expect(page).toContain('<div v-pre>');
    // Vue-hostile braces in prose are escaped, fence-aware.
    expect(page).toContain('&#123;&#123; placeholders &#125;&#125;');
  });

  test('falls back to a generic title when the assembly has no README', () => {
    const page = renderApiOverviewPage({} as any);
    expect(page.startsWith('# API Reference')).toBe(true);
    expect(page).not.toContain('<div v-pre>');
    // No link to the /v2/ modules index, which does not exist: a "browse the
    // modules" line would be a self-link on /api/ anyway. The invariant is
    // that no dead root is linked.
    expect(page).not.toContain('(/v2/)');
  });
});

describe('docgen config', () => {
  test('docgen.config.json lists aws-cdk-lib, constructs, and the mixin-only module', () => {
    const config = loadConfig(join(ROOT, 'docgen.config.json'));
    expect(config.modules).toContain('aws-cdk-lib');
    expect(config.modules).toContain('constructs');
    expect(config.includeKinds?.['@aws-cdk/cfn-property-mixins']).toEqual(['Mixin']);
    expect(config.emitExamples?.['@aws-cdk/cfn-property-mixins']).toBe(false);
  });

  test('lists the CDK ecosystem packages and every module is installed', () => {
    const config = loadConfig(join(ROOT, 'docgen.config.json'));
    // Representative spot checks: alpha service module and alpha framework module.
    expect(config.modules).toContain('@aws-cdk/aws-lambda-python-alpha');
    expect(config.modules).toContain('@aws-cdk/integ-tests-alpha');
    // docgen.config.json and the .projenrc.ts devDependencies must stay
    // in sync: docgen loads each configured module's jsii assembly from
    // node_modules at generate time and hard-fails on a missing one.
    for (const m of config.modules) {
      expect(existsSync(join(ROOT, 'node_modules', m, 'package.json'))).toBe(true);
    }
  });

  test('loadConfig rejects a config without a modules array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docgen-config-'));
    try {
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, '{"modules": "aws-cdk-lib"}');
      expect(() => loadConfig(bad)).toThrow(/array of package names/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('loadConfig rejects includeKinds entries for unconfigured modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docgen-config-'));
    try {
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, '{"modules":["constructs"],"includeKinds":{"other":["Mixin"]}}');
      expect(() => loadConfig(bad)).toThrow(/includeKinds/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('loadConfig rejects emitExamples entries for unconfigured modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docgen-config-'));
    try {
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, '{"modules":["constructs"],"emitExamples":{"other":false}}');
      expect(() => loadConfig(bad)).toThrow(/emitExamples/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('generateDocs rejects includeKinds classifications absent from a module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docgen-kinds-'));
    try {
      expect(() => generateDocs(
        { modules: ['constructs'], includeKinds: { constructs: ['Mixins'] } },
        { outDir: dir, packageRoot: ROOT, languages: ['ts'] },
      )).toThrow(/unknown includeKinds classifications: Mixins/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('submoduleSegments', () => {
  // The set stands for "submodules this build actually emitted a page for".
  const emitted = new Set(['aws_s3', 'aws_cloudfront', 'aws_cloudfront.experimental', 'interfaces.aws_s3']);

  test('a plain submodule is one linked segment', () => {
    expect(submoduleSegments('aws-cdk-lib', 'aws_s3', emitted)).toEqual([
      { label: 'aws_s3', link: '/v2/docs/aws-cdk-lib.aws_s3-readme' },
    ]);
  });

  test('no submodule contributes no segments', () => {
    expect(submoduleSegments('aws-cdk-lib', '', emitted)).toEqual([]);
  });

  test('a structural submodule splits, and an intermediate without a page is unlinked', () => {
    // `interfaces` is a grouping, not a submodule of its own,
    // so it is absent from the emitted set and must NOT be linked — that
    // would be a 404. The leaf still links to its real overview page.
    expect(submoduleSegments('aws-cdk-lib', 'interfaces.aws_s3', emitted)).toEqual([
      { label: 'interfaces' },
      { label: 'aws_s3', link: '/v2/docs/aws-cdk-lib.interfaces.aws_s3-readme' },
    ]);
  });

  test('an intermediate that IS its own submodule links', () => {
    // Whether a prefix has a page is a property of the build, so it is
    // looked up rather than assumed: here `aws_cloudfront` really exists.
    expect(submoduleSegments('aws-cdk-lib', 'aws_cloudfront.experimental', emitted)).toEqual([
      { label: 'aws_cloudfront', link: '/v2/docs/aws-cdk-lib.aws_cloudfront-readme' },
      {
        label: 'experimental',
        link: '/v2/docs/aws-cdk-lib.aws_cloudfront.experimental-readme',
      },
    ]);
  });

  test('linkLast: false leaves the final part unlinked for the overview page itself', () => {
    // The submodule overview page IS the last part, so it is the current
    // page and carries no link, while its ancestors still do.
    expect(
      submoduleSegments('aws-cdk-lib', 'aws_cloudfront.experimental', emitted, { linkLast: false }),
    ).toEqual([
      { label: 'aws_cloudfront', link: '/v2/docs/aws-cdk-lib.aws_cloudfront-readme' },
      { label: 'experimental' },
    ]);
  });
});

describe('docgen generation', () => {
  // A full generateDocs run over the real aws-cdk-lib assembly writes
  // ~21k files and dominates this suite's runtime, so run it exactly
  // ONCE (ts + python) in beforeAll and let every test assert on the
  // shared output instead of regenerating per test.
  let outDir: string;
  let overviewFile: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'docgen-out-'));
    overviewFile = join(outDir, 'api-index.md');
    const config = loadConfig(join(ROOT, 'docgen.config.json'));
    generateDocs(config, {
      outDir,
      packageRoot: ROOT,
      languages: ['ts', 'python'],
      overviewFile,
      overviewSourceFile: join(ROOT, 'docs', 'aws-construct-library.md'),
    });
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('generates docs for the constructs module', () => {
    const indexMd = readFileSync(join(outDir, 'docs', 'constructs-readme.md'), 'utf-8');
    // Package overviews are README-backed: the README's own
    // H1 is the page title, not a synthesized `# <package name>`.
    expect(indexMd).toContain('# Constructs');
    expect(indexMd).toContain('`Construct`');
    expect(indexMd).toContain('| Name | Kind | Summary |');
  });

  test('the API root renders the authored construct-library overview', () => {
    const overview = readFileSync(overviewFile, 'utf-8');
    const authored = readFileSync(join(ROOT, 'docs', 'aws-construct-library.md'), 'utf-8');
    expect(overview).toBe(authored);
    expect(overview).toContain('# AWS Construct Library');
    expect(overview).toContain('## Construct levels');
  });

  test('generates docs for every configured module, incl. compressed aws-cdk-lib assembly', () => {
    expect(existsSync(join(outDir, 'docs', 'aws-cdk-lib-readme.md'))).toBe(true);
    expect(existsSync(join(outDir, 'docs', 'constructs-readme.md'))).toBe(true);

    const cdkIndex = readFileSync(join(outDir, 'docs', 'aws-cdk-lib-readme.md'), 'utf-8');
    expect(cdkIndex).toContain('## Submodules');
    expect(cdkIndex).toContain('aws_s3');

    expect(existsSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'))).toBe(true);
    const s3Page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'), 'utf-8');
    expect(s3Page).toContain('`Bucket`');
  });

  test('generates property mixins with mixin classification and service grouping', () => {
    const page = readFileSync(
      join(outDir, 'docs', '@aws-cdk_cfn-property-mixins.aws_lambda.CfnFunctionPropsMixin.md'),
      'utf-8',
    );
    expect(page).toContain('class="api-badge api-badge-mixin" text="Mixin"');
    expect(page).toContain('href="/v2/docs/constructs.IMixin.html">IMixin</a>');
    expect(page).toContain('## Initializer');
    expect(page).toContain('## Methods');
    expect(page).not.toContain('## Example');
    expect(
      existsSync(join(outDir, 'docs', '@aws-cdk_cfn-property-mixins.aws_lambda.CfnFunctionMixinProps.md')),
    ).toBe(false);
    expect(page).not.toContain(
      'href="/v2/docs/@aws-cdk_cfn-property-mixins.aws_lambda.CfnFunctionMixinProps.html"',
    );
    const packagePages = readdirSync(join(outDir, 'docs')).filter(
      (name) => name.startsWith('@aws-cdk_cfn-property-mixins') && name.endsWith('.md'),
    );
    const propertyMixinPages = packagePages.filter((name) => name.endsWith('PropsMixin.md'));
    const classifiedPages = packagePages.filter((name) =>
      readFileSync(join(outDir, 'docs', name), 'utf-8').includes('class="api-badge api-badge-'),
    );
    expect(propertyMixinPages.length).toBeGreaterThan(1000);
    expect(classifiedPages).toEqual(propertyMixinPages);

    const paths: string[][] = [];
    const walk = (items: Array<{ text: string; items?: unknown[] }>, path: string[] = []) => {
      for (const item of items) {
        const next = [...path, item.text];
        paths.push(next);
        if (item.items) walk(item.items as Array<{ text: string; items?: unknown[] }>, next);
      }
    };
    walk(JSON.parse(readFileSync(join(outDir, 'sidebar.json'), 'utf-8')));
    expect(paths).toContainEqual([
      'Services',
      'Lambda',
      'Function',
      'Mixins',
      'CfnFunctionPropsMixin',
    ]);
  });

  test('omits synthetic mixin submodule overview pages while keeping their type pages', () => {
    // The mixin package's submodules carry only mixin types and ship no upstream README, so their generated
    // `…-readme` overview is noise: it must not be written, and nothing may link to it.
    const mixinReadmePages = readdirSync(join(outDir, 'docs')).filter(
      (name) => name.startsWith('@aws-cdk_cfn-property-mixins.') && name.endsWith('-readme.md'),
    );
    expect(mixinReadmePages).toEqual([]);

    // The mixin TYPE pages in that submodule still render.
    expect(
      existsSync(join(outDir, 'docs', '@aws-cdk_cfn-property-mixins.aws_lambda.CfnFunctionPropsMixin.md')),
    ).toBe(true);

    // The mixin package root overview no longer links the removed submodule readmes.
    const mixinRoot = readFileSync(join(outDir, 'docs', '@aws-cdk_cfn-property-mixins-readme.md'), 'utf-8');
    expect(mixinRoot).not.toContain('-readme.html');

    // A real submodule with its own upstream README keeps its overview page untouched.
    expect(existsSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'))).toBe(true);

    // No sidebar entry points a mixin submodule's types at a readme page that was never written.
    const sidebar = readFileSync(join(outDir, 'sidebar.json'), 'utf-8');
    expect(sidebar).not.toContain('@aws-cdk_cfn-property-mixins.aws_lambda-readme');
  });

  test('submodule start page renders the README above the type preview list', () => {
    const s3Page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'), 'utf-8');
    // README's own H1 is the page's first HEADING, so it is still the
    // title and there is no duplicate fqn one. The breadcrumb nav precedes
    // it, so this is a first-heading check rather than a startsWith.
    expect(s3Page.split('\n').find((l) => /^#{1,6}\s/.test(l))).toBe(
      '# Amazon S3 Construct Library',
    );
    expect(s3Page).not.toContain('# aws-cdk-lib.aws_s3');
    // README first, then the preview list under a Types heading
    const typesIdx = s3Page.indexOf('## Types');
    const tableIdx = s3Page.indexOf('| Name | Kind | Summary |');
    expect(typesIdx).toBeGreaterThan(0);
    expect(tableIdx).toBeGreaterThan(typesIdx);
    // The interactive preview list is intact
    expect(s3Page).toContain('[`Bucket`](/v2/docs/aws-cdk-lib.aws_s3.Bucket)');
    // HTML comments from the README are stripped, not rendered as text
    expect(s3Page).not.toContain('&lt;!--');
  });

  test('type-table rows follow the sidebar order — L3, L2, L1, then unleveled', () => {
    const s3Page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'), 'utf-8');
    const LEVEL_RANK: Record<string, number> = { L3: 0, L2: 1, L1: 2 };
    // Rows of the single type table: `| [`Name`](link) | Kind | Summary |`
    const rows = s3Page.slice(s3Page.indexOf('| Name | Kind | Summary |'))
      .split('\n')
      .map((line) => /^\| \[?`([^`]+)`\]?[^|]*\| ([^|]*?) *\|/.exec(line))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({
        name: m[1],
        rank: LEVEL_RANK[/Construct \((L[123])\)/.exec(m[2])?.[1] ?? ''] ?? 3,
      }));

    expect(rows.length).toBeGreaterThan(10);
    // The L2 `Bucket` precedes the L1 `CfnBucket` even though the names
    // sort the other way round — the level is the primary key.
    const nameOrder = rows.map((r) => r.name);
    expect(nameOrder.indexOf('Bucket')).toBeLessThan(nameOrder.indexOf('CfnBucket'));
    // Ranks never decrease down the table, and each tier is alphabetical
    // within itself.
    const ranks = rows.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (let i = 1; i < rows.length; i++) {
      if (ranks[i] === ranks[i - 1]) {
        expect(rows[i - 1].name.localeCompare(rows[i].name)).toBeLessThan(0);
      }
    }
  });

  test('submodule without a README keeps the table-only layout', () => {
    // aws_cloudfront.experimental carries no README in the assembly
    const page = readFileSync(
      join(outDir, 'docs', 'aws-cdk-lib.aws_cloudfront.experimental-readme.md'),
      'utf-8',
    );
    // Frontmatter still opens the file; the breadcrumb then precedes the
    // H1, so the two are not adjacent.
    expect(page.startsWith(OUTLINE_OFF)).toBe(true);
    expect(page.split('\n').find((l) => /^#{1,6}\s/.test(l))).toBe(
      '# aws-cdk-lib.aws_cloudfront.experimental',
    );
    expect(page).not.toContain('## Types');
    expect(page).toContain('| Name | Kind | Summary |');
  });

  test('overview breadcrumbs are anchored at the module, not a synthetic root', () => {
    // Module overview: the trail is the package alone, unlinked. An
    // `AWS CDK API` segment would point at the /v2/ modules index, which
    // does not exist, and no trail carries a segment above the package.
    const cdkIndex = readFileSync(join(outDir, 'docs', 'aws-cdk-lib-readme.md'), 'utf-8');
    expect(cdkIndex).not.toContain('AWS CDK API');
    expect(cdkIndex).toContain('<strong>aws-cdk-lib</strong>');
    // The bar itself survives a single-segment trail: it hosts the
    // `breadcrumb-fav` mount point FavoriteStar teleports into, so
    // dropping it would silently remove the star from overview pages.
    expect(cdkIndex).toMatch(/<nav class="type-breadcrumb"[^>]*data-pagefind-ignore>/);
    expect(cdkIndex).toContain('<span class="breadcrumb-fav"></span>');
    // README-backed submodule overview: package linked, submodule plain,
    // and the trail sits OUTSIDE the v-pre container so its links render.
    const s3Page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'), 'utf-8');
    const trail = '<a href="/v2/docs/aws-cdk-lib-readme.html">aws-cdk-lib</a>.<wbr><strong>aws_s3</strong>';
    expect(s3Page).toContain(trail);
    expect(s3Page).not.toContain('AWS CDK API');
    expect(s3Page.indexOf(trail)).toBeLessThan(s3Page.indexOf('<div v-pre>'));
    // Table-only submodule overview (no README) carries the trail too.
    // Its name is dotted, so it splits into one segment
    // per part — the parent submodule links, the current part is bold.
    const bare = readFileSync(
      join(outDir, 'docs', 'aws-cdk-lib.aws_cloudfront.experimental-readme.md'),
      'utf-8',
    );
    expect(bare).toContain(
      '.<wbr><a href="/v2/docs/aws-cdk-lib.aws_cloudfront-readme.html">aws_cloudfront</a>.<wbr><strong>experimental</strong>',
    );
    expect(bare).not.toContain('AWS CDK API');
  });

  test('a dotted submodule contributes one breadcrumb segment per part', () => {
    // Rendering `aws_cloudfront.experimental` as a single crumb would read
    // `aws-cdk-lib.aws_cloudfront.experimental.Type` and hide a level of the
    // hierarchy, so each part is its own segment.
    const typePage = readFileSync(
      join(outDir, 'docs', 'aws-cdk-lib.aws_cloudfront.experimental.EdgeFunction.md'),
      'utf-8',
    );
    expect(typePage).toContain(
      '<a href="/v2/docs/aws-cdk-lib-readme.html">aws-cdk-lib</a>.<wbr><a href="/v2/docs/aws-cdk-lib.aws_cloudfront-readme.html">aws_cloudfront</a>.<wbr><a href="/v2/docs/aws-cdk-lib.aws_cloudfront.experimental-readme.html">experimental</a>.<wbr><strong>EdgeFunction</strong>',
    );
    // The single-crumb form appears nowhere.
    expect(typePage).not.toContain('aws_cloudfront.experimental]');
    expect(typePage).not.toContain('<strong>aws_cloudfront.<wbr>experimental</strong>');

    // A plain submodule has no dot, so its trail is untouched.
    const plain = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    expect(plain).toContain(
      '<a href="/v2/docs/aws-cdk-lib-readme.html">aws-cdk-lib</a>.<wbr><a href="/v2/docs/aws-cdk-lib.aws_s3-readme.html">aws_s3</a>.<wbr><strong>Bucket</strong>',
    );

    // Slugs and links are display-independent: the page filename and the
    // in-page links still use the full dotted identifier (no URL change).
    expect(typePage).toContain('/v2/docs/aws-cdk-lib.aws_cloudfront.experimental');
  });

  test('README-backed overview pages carry their upstream edit target', () => {
    // An overview page's prose is an upstream README, so the page records that
    // file for the theme to link rather than this repo's docgen directory,
    // which is not a file a reader can fix a typo in.
    const s3 = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'), 'utf-8');
    expect(s3.startsWith(
      '---\nupstreamEditUrl: "https://github.com/aws/aws-cdk/blob/HEAD/packages/aws-cdk-lib/aws-s3/README.md"\n---\n',
    )).toBe(true);

    // The package root's own README, same mechanism.
    const root = readFileSync(join(outDir, 'docs', 'aws-cdk-lib-readme.md'), 'utf-8');
    expect(root).toContain(
      'upstreamEditUrl: "https://github.com/aws/aws-cdk/blob/HEAD/packages/aws-cdk-lib/README.md"',
    );

  });

  test('pages with no upstream markdown file record no edit target', () => {
    // A type page's prose is jsii docstrings in TypeScript source, and a
    // table-only overview has no README at all — neither has a markdown
    // file a reader can edit, so the footer must render no link rather
    // than a misleading one.
    const typePage = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    expect(typePage).not.toContain('upstreamEditUrl');
    const tableOnly = readFileSync(
      join(outDir, 'docs', 'aws-cdk-lib.aws_cloudfront.experimental-readme.md'),
      'utf-8',
    );
    expect(tableOnly).not.toContain('upstreamEditUrl');
    expect(tableOnly.startsWith('---\noutline: false\n---\n')).toBe(true);
  });

  test('every overview renderer puts the breadcrumb above the H1, like type pages', () => {
    // Three call sites assemble the same renderBreadcrumb() output by hand, so
    // any one of them emitting it AFTER the heading makes the trail jump as a
    // reader moves between a README overview and a type page. Pin all three
    // page kinds together so they cannot diverge.
    const overviews = [
      // renderModuleIndex()
      'aws-cdk-lib-readme.md',
      // renderOverviewPage({  }), README branch
      'aws-cdk-lib.aws_s3-readme.md',
      // renderOverviewPage({  }), table-only branch
      'aws-cdk-lib.aws_cloudfront.experimental-readme.md',
    ];
    for (const name of overviews) {
      const page = readFileSync(join(outDir, 'docs', name), 'utf-8');
      const crumb = page.indexOf('<nav class="type-breadcrumb"');
      const lines = page.split('\n');
      const headingIdx = lines.findIndex((l) => /^#{1,6}\s/.test(l));
      expect(crumb).toBeGreaterThanOrEqual(0);
      expect(headingIdx).toBeGreaterThanOrEqual(0);
      // Byte offset of the first heading line, compared against the nav's.
      const headingOffset = lines.slice(0, headingIdx).join('\n').length;
      expect(crumb).toBeLessThan(headingOffset);
      // Frontmatter, where a page has it, still precedes everything —
      // VitePress only parses it at the very top of the file. README-backed
      // pages carry a block too (the upstream edit target), and they still
      // must not carry `outline: false`.
      if (page.startsWith('---')) {
        const end = page.indexOf('\n---\n');
        expect(end).toBeGreaterThan(0);
        expect(end + 5).toBeLessThan(crumb);
        const block = page.slice(4, end);
        for (const key of block.split('\n').filter(Boolean)) {
          expect(key).toMatch(/^(outline: false|upstreamEditUrl: ".*")$/);
        }
      }
    }
    // A type page is the shape the overviews now match: its trail is
    // prepended to the whole rendered page, ahead of its first heading.
    const typePage = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    const typeLines = typePage.split('\n');
    const typeHeadingIdx = typeLines.findIndex((l) => /^#{1,6}\s/.test(l));
    expect(typeHeadingIdx).toBeGreaterThanOrEqual(0);
    expect(typePage.indexOf('<nav class="type-breadcrumb"')).toBeLessThan(
      typeLines.slice(0, typeHeadingIdx).join('\n').length,
    );
  });

  test('gives every type page an explicit title, so H1 markup cannot leak into it', () => {
    // The H1 line carries raw HTML: the weighted-title span and the kind
    // badge. VitePress infers a page title from the H1 with
    // `shouldAllowHtml: false`, which drops the tags but KEEPS their inner
    // text — which is how raw HTML in an H1 leaks its words into `<title>`
    // and into the Favorites list, which snapshots `page.title`. Explicit
    // frontmatter is what stops the badge text leaking that way.
    const cases: [string, string][] = [
      // Source-link chip (has an upstream location).
      ['aws-cdk-lib.aws_s3.Bucket.md', 'Bucket'],
      // "Generated code" chip (an L1, from a .generated. file).
      ['aws-cdk-lib.aws_s3.CfnBucket.md', 'CfnBucket'],
      // Non-construct kinds go through symbols.ts / mixins.ts call sites.
      ['aws-cdk-lib.aws_s3.BucketProps.md', 'BucketProps'],
      ['aws-cdk-lib.aws_s3.IBucket.md', 'IBucket'],
    ];
    for (const [name, title] of cases) {
      const page = readFileSync(join(outDir, 'docs', name), 'utf-8');
      // Frontmatter must be the very first bytes or VitePress does not
      // parse it at all, which would silently restore H1 inference.
      expect(page.startsWith(`---\ntitle: ${JSON.stringify(title)}\n---\n`)).toBe(true);
      // ...and still ahead of the breadcrumb and the H1.
      const end = page.indexOf('\n---\n');
      expect(end + 5).toBeLessThan(page.indexOf('<nav class="type-breadcrumb"'));
    }
    // The visible chip itself is untouched — it is a deliberate feature
    // and only the inferred title is at stake here.
    const bucket = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    const cfn = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.CfnBucket.md'), 'utf-8');
    // The badge is the H1's remaining raw HTML, and its text is exactly what
    // inference would otherwise append to the title.
    expect(bucket.split('\n').find((l) => l.startsWith('# '))).toContain('text="L2 construct"');
    expect(cfn.split('\n').find((l) => l.startsWith('# '))).toContain('text="L1 construct"');
    // The source-link chip is not in the H1 at all.
    expect(bucket.split('\n').find((l) => l.startsWith('# '))).not.toContain('header-tag');
    expect(cfn.split('\n').find((l) => l.startsWith('# '))).not.toContain('header-tag');
  });

  test('generates pages for standalone packages under the standard path convention', () => {
    // Alpha service module: index page + a type page for its main construct.
    const alphaIndex = readFileSync(
      join(outDir, 'docs', '@aws-cdk_aws-lambda-python-alpha-readme.md'),
      'utf-8',
    );
    expect(alphaIndex).toContain('# Amazon Lambda Python Library');
    expect(
      existsSync(join(outDir, 'docs', '@aws-cdk_aws-lambda-python-alpha.PythonFunction.md')),
    ).toBe(true);
    // Standalone stable library.
    expect(existsSync(join(outDir, 'docs', 'constructs-readme.md'))).toBe(true);
  });

  test('standalone packages carry the separate-install alert; aws-cdk-lib does not', () => {
    const alphaIndex = readFileSync(
      join(outDir, 'docs', '@aws-cdk_aws-lambda-python-alpha-readme.md'),
      'utf-8',
    );
    // Experimental module: warning container + stability caveat + both installs.
    expect(alphaIndex).toContain('::: warning Separate package');
    expect(alphaIndex).toContain('npm install @aws-cdk/aws-lambda-python-alpha');
    expect(alphaIndex).toContain('pip install aws-cdk.aws-lambda-python-alpha');
    // The caveat links the guide that explains the level; VitePress prefixes the site base on render.
    expect(alphaIndex).toContain('This module is [**experimental**](/stability) (alpha)');

    // Stable standalone module: info container, no stability caveat.
    const constructsIndex = readFileSync(
      join(outDir, 'docs', 'constructs-readme.md'),
      'utf-8',
    );
    expect(constructsIndex).toContain('::: info Separate package');
    expect(constructsIndex).not.toContain('**experimental**');

    // The core library needs no separate install.
    const cdkIndex = readFileSync(join(outDir, 'docs', 'aws-cdk-lib-readme.md'), 'utf-8');
    expect(cdkIndex).not.toContain('Separate package');
  });

  test('type pages of an alpha package open with the experimental banner above the title', () => {
    const banner = '::: warning Experimental\n'
      + '`@aws-cdk/aws-lambda-python-alpha` is an [**experimental**](/stability) (alpha) package: its API may change in'
      + ' any release, without a major version bump.\n:::';
    // Banner between the breadcrumb and the H1; the frontmatter still opens the file.
    const alphaType = readFileSync(
      join(outDir, 'docs', '@aws-cdk_aws-lambda-python-alpha.PythonFunction.md'),
      'utf-8',
    );
    expect(alphaType.startsWith('---\ntitle: "PythonFunction"\n---\n')).toBe(true);
    expect(alphaType).toContain(banner);
    expect(alphaType.indexOf('</nav>')).toBeLessThan(alphaType.indexOf(banner));
    expect(alphaType.indexOf(banner)).toBeLessThan(alphaType.search(/^# /m));
    // The module overview carries the README's own notice and the install alert, so no banner there.
    const alphaIndex = readFileSync(
      join(outDir, 'docs', '@aws-cdk_aws-lambda-python-alpha-readme.md'),
      'utf-8',
    );
    expect(alphaIndex).not.toContain('::: warning Experimental');
    // Stable pages carry no banner: neither the stable library nor a stable standalone package, and not even a
    // type that is itself marked experimental inside the stable library — the banner is about the package.
    for (const file of [
      'aws-cdk-lib.aws_s3.Bucket.md',
      'aws-cdk-lib.interfaces.aws_s3.IBucketRef.md',
      'constructs.Construct.md',
    ]) {
      expect(readFileSync(join(outDir, 'docs', file), 'utf-8')).not.toContain('::: warning Experimental');
    }
  });

  test('type pages mark experimental types in the metadata block and stable ones not at all', () => {
    const stabilityRow = '<dt class="type-metadata-label">Stability</dt><dd class="type-metadata-value">'
      + '<a class="type-metadata-stability" data-pagefind-ignore href="/stability.html">Experimental</a></dd>';
    // Every type of an alpha module inherits the module's level.
    const alphaType = readFileSync(
      join(outDir, 'docs', '@aws-cdk_aws-lambda-python-alpha.PythonFunction.md'),
      'utf-8',
    );
    expect(alphaType).toContain(stabilityRow);
    // A per-type mark inside the stable library surfaces too.
    const refInterface = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.interfaces.aws_s3.IBucketRef.md'), 'utf-8');
    expect(refInterface).toContain(stabilityRow);
    // Stable types stay silent: the absence of the row is the stable indicator.
    const bucket = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    expect(bucket).not.toContain('type-metadata-label">Stability<');
  });

  test('writes a service-grouped VitePress sidebar.json', () => {
    const sidebar = JSON.parse(readFileSync(join(outDir, 'sidebar.json'), 'utf-8'));
    // Framework precedes Services at the top level.
    expect(sidebar.map((s: any) => s.text)).toEqual(['Framework', 'Services']);
    const framework = sidebar[0].items;
    const serviceSections = sidebar[1].items;
    const texts = [...framework, ...serviceSections].map((s: any) => s.text);

    // The Core group leads Framework, headed by the bare package name;
    // services follow alphabetically.
    expect(texts[0]).toBe('aws-cdk-lib');
    expect(texts).toEqual(expect.arrayContaining(['S3', 'Lambda', 'DynamoDB']));
    const services = serviceSections.map((s: any) => s.text);
    expect(services).toEqual([...services].sort((a: string, b: string) => a.localeCompare(b)));

    // Still no package-level grouping NODE wrapping the tree: the
    // package name appears only as the Core group's own Framework
    // heading, never as a Services section.
    expect(services).not.toContain('aws-cdk-lib');
    expect(texts).toContain('constructs');

    // The Framework top level is the curated allow list in its own order;
    // every other framework module nests under `aws-cdk-lib`.
    const frameworkTexts = framework.map((s: any) => s.text);
    expect(frameworkTexts).toContain('aws-cdk-lib.assertions');
    expect(frameworkTexts).not.toContain('Assertions');
    expect(frameworkTexts[frameworkTexts.length - 1]).toBe('constructs');
    expect(frameworkTexts.filter((t: string) => t.startsWith('@'))).toEqual([]);
    expect(framework.find((s: any) => s.text === 'aws-cdk-lib.assertions').label).toBe('Testing');

    // Within a service, types group by resource; construct types sit
    // flat inside the resource.
    const s3 = serviceSections.find((s: any) => s.text === 'S3');
    expect(s3.collapsed).toBe(true);
    const bucket = s3.items.find((i: any) => i.text === 'Bucket');
    expect(bucket).toBeDefined();
    expect(bucket.collapsed).toBe(true);
    const bucketKinds = bucket.items.map((i: any) => i.text);
    expect(bucketKinds).toEqual(expect.arrayContaining(['Bucket', 'CfnBucket', 'Others']));
    // The L2 construct leaf carries its level, from the same
    // determination that badges the type's page — real assemblies, so this
    // proves the field survives the whole generate path into the asset.
    expect(bucket.items).toEqual(
      expect.arrayContaining([
        { text: 'Bucket', link: '/v2/docs/aws-cdk-lib.aws_s3.Bucket', level: 'L2' },
        { text: 'CfnBucket', link: '/v2/docs/aws-cdk-lib.aws_s3.CfnBucket', level: 'L1' },
      ]),
    );
    // Non-constructs carry none: the Others group's leaves are bare.
    const bucketProps = bucket.items
      .find((i: any) => i.text === 'Others')
      .items.find((i: any) => i.text === 'BucketProps');
    expect(bucketProps.level).toBeUndefined();
    // The remaining kind groups start collapsed.
    const bucketOthers = bucket.items.find((i: any) => i.text === 'Others');
    expect(bucketOthers.collapsed).toBe(true);

    // Core keeps aws-cdk-lib core types in its flat kind grouping; the
    // constructs package has its own section.
    const core = framework.find((s: any) => s.text === 'aws-cdk-lib');
    const coreConstructs = core.items.find((i: any) => i.text === 'Constructs');
    expect(coreConstructs.collapsed).toBe(true);
    const coreNames = coreConstructs.items.map((i: any) => i.text);
    expect(coreNames).toContain('Stack'); // from aws-cdk-lib root
    expect(coreNames).not.toContain('Construct');
    const constructsSection = framework.find((s: any) => s.text === 'constructs');
    const sectionConstructs = constructsSection.items.find((i: any) => i.text === 'Constructs');
    expect(sectionConstructs.items.map((i: any) => i.text)).toContain('Construct');
  });

  test('generates one canonical page tree regardless of enabled languages', () => {
    expect(existsSync(join(outDir, 'docs', 'aws-cdk-lib-readme.md'))).toBe(true);
    expect(existsSync(join(outDir, 'sidebar.json'))).toBe(true);
    // No per-language duplicate trees or sidebars.
    expect(existsSync(join(outDir, 'python'))).toBe(false);

    // Links use the canonical prefix.
    const tsIndex = readFileSync(join(outDir, 'docs', 'aws-cdk-lib-readme.md'), 'utf-8');
    expect(tsIndex).toContain('/v2/');
  });

  test('outline suppression is scoped to sidebar-mirroring pages only', () => {
    // The package overview is README-backed by default, so it KEEPS its
    // outline like any other README page — the
    // library README's section headings are real quick navigation.
    const moduleIndex = readFileSync(join(outDir, 'docs', 'aws-cdk-lib-readme.md'), 'utf-8');
    expect(moduleIndex.startsWith(OUTLINE_OFF)).toBe(false);
    expect(moduleIndex.split('\n').find((l) => /^#{1,6}\s/.test(l))).toBe(
      '# AWS Cloud Development Kit Library',
    );
    // The table-only submodule variant still suppresses it:
    // aws_cloudfront.experimental carries no README, so its page merely
    // mirrors the sidebar…
    const tableOnly = readFileSync(
      join(outDir, 'docs', 'aws-cdk-lib.aws_cloudfront.experimental-readme.md'),
      'utf-8',
    );
    expect(tableOnly.startsWith(OUTLINE_OFF)).toBe(true);
    // …but the README-backed submodule page keeps its quick nav: the
    // README's section headings are navigation the sidebar
    // does not provide.
    const s3Page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'), 'utf-8');
    expect(s3Page).not.toContain('outline: false');
  });

  test('outline suppression does not leak to type pages', () => {
    const bucketPage = readFileSync(
      join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'),
      'utf-8',
    );
    expect(bucketPage).not.toContain('outline: false');
  });
});

describe('projen integration', () => {
  const tasksJson = JSON.parse(
    readFileSync(join(ROOT, '.projen/tasks.json'), 'utf-8'),
  );

  // The pages this task produces are asserted throughout this suite. What is
  // pinned here is the entry point that produces them, which the output cannot
  // name.
  test('docs:generate task is defined', () => {
    expect(tasksJson.tasks['docs:generate']).toBeDefined();
    expect(tasksJson.tasks['docs:generate'].steps[0].exec).toBe('tsx src/docgen/cli.ts');
  });

  // Config shape with no produced-output counterpart: a site built from stale
  // generated pages is indistinguishable from one built after a regeneration,
  // so only the task order says the pages are fresh.
  test('docs:build runs docs:generate first', () => {
    expect(tasksJson.tasks['docs:build'].steps[0].spawn).toBe('docs:generate');
    expect(tasksJson.tasks['docs:build'].steps[1].exec).toBe('vitepress build docs');
  });

  // Same absence of an observable: the dev server has no build output to check
  // at all.
  test('docs:dev runs docs:generate first', () => {
    expect(tasksJson.tasks['docs:dev'].steps[0].spawn).toBe('docs:generate');
  });

  // Config shape with no produced-output counterpart: whether a path is
  // tracked is a fact about the repository, and the pages render the same
  // either way.
  test('generated docs directory is gitignored', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('docs/v2/');
  });

  test('docgen inputs are devDependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    // Config shape with no produced-output counterpart: nothing of these packages ships in the site,
    // so only the manifest expresses that they are build tooling, not part of the output.
    expect(packageJson.devDependencies['@jsii/spec']).toBeDefined();
    expect(packageJson.devDependencies.htmlparser2).toBeDefined();
    expect(packageJson.devDependencies['aws-cdk-lib']).toBeDefined();
    expect(packageJson.dependencies['@jsii/spec']).toBeUndefined();
  });
});
