import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { withoutLiteralsAndComments } from '../src/docgen/examples.js';
import { generateDocs } from '../src/docgen/index.js';
import { importBindings, importModules, readmeTypeLinksAttr } from '../src/docgen/readme-links.js';
import { importStatements } from '../src/docgen/rosetta.js';

const ROOT = resolve(import.meta.dirname, '..');

// README code examples link their types, resolved from the example's own imports
// (ADR 2026-10-26-readme-example-type-links).

const ASSEMBLIES = [
  { name: 'aws-cdk-lib', submodules: { 'aws-cdk-lib.aws_s3': {}, 'aws-cdk-lib.aws_sqs': {} } },
  { name: 'constructs' },
];
const PAGES = new Map([
  ['aws-cdk-lib.App', '/v2/docs/aws-cdk-lib.App'],
  ['aws-cdk-lib.Stack', '/v2/docs/aws-cdk-lib.Stack'],
  ['aws-cdk-lib.Duration', '/v2/docs/aws-cdk-lib.Duration'],
  ['aws-cdk-lib.aws_s3.Bucket', '/v2/docs/aws-cdk-lib.aws_s3.Bucket'],
  ['aws-cdk-lib.aws_s3.CfnBucket', '/v2/docs/aws-cdk-lib.aws_s3.CfnBucket'],
  ['aws-cdk-lib.aws_s3.CfnBucket.LoggingConfigurationProperty', '/v2/docs/aws-cdk-lib.aws_s3.CfnBucket.LoggingConfigurationProperty'],
  ['aws-cdk-lib.aws_sqs.Queue', '/v2/docs/aws-cdk-lib.aws_sqs.Queue'],
  ['constructs.Construct', '/v2/docs/constructs.Construct'],
]);
const modules = importModules(ASSEMBLIES);

/** Linked names and their hrefs, for one example whose imports are its own. */
function links(code: string, imports = importStatements(code)): Record<string, string> {
  const attr = readmeTypeLinksAttr(withoutLiteralsAndComments(code), {
    imports,
    modules,
    linkFor: (fqn) => PAGES.get(fqn),
  });
  return Object.fromEntries(
    attr ? attr.replace(/^type-links=/, '').split(',').map((pair) => pair.split(':') as [string, string]) : [],
  );
}

describe('README example imports', () => {
  test('import paths map to the package root and each submodule, spelled with dashes', () => {
    expect(modules.get('aws-cdk-lib')).toBe('aws-cdk-lib');
    expect(modules.get('aws-cdk-lib/aws-s3')).toBe('aws-cdk-lib.aws_s3');
    expect(modules.get('constructs')).toBe('constructs');
    expect(modules.get('aws-cdk-lib/aws_s3')).toBeUndefined();
  });

  test('named, aliased, namespace and require imports bind their local names', () => {
    const bindings = importBindings([
      "import { App, Stack as S, aws_s3 as s3, type Duration } from 'aws-cdk-lib';",
      "import * as sqs from 'aws-cdk-lib/aws-sqs';",
      "import cs = require('constructs');",
      "import def from 'aws-cdk-lib';",
      "import { Thing } from 'some-other-package';",
    ].join('\n'), modules);
    expect(Object.fromEntries(bindings)).toEqual({
      App: 'aws-cdk-lib.App',
      S: 'aws-cdk-lib.Stack',
      s3: 'aws-cdk-lib.aws_s3',
      Duration: 'aws-cdk-lib.Duration',
      sqs: 'aws-cdk-lib.aws_sqs',
      cs: 'constructs',
    });
  });
});

describe('README example type links', () => {
  test('a named import makes the bare name link', () => {
    const code = [
      "import { App, Stack } from 'aws-cdk-lib';",
      'const app = new App();',
      "new Stack(app, 'Stack');",
    ].join('\n');
    expect(links(code)).toEqual({
      App: '/v2/docs/aws-cdk-lib.App.html',
      Stack: '/v2/docs/aws-cdk-lib.Stack.html',
    });
  });

  test('an aliased submodule import makes the qualified name link', () => {
    const code = [
      "import { aws_s3 as s3 } from 'aws-cdk-lib';",
      "import * as sqs from 'aws-cdk-lib/aws-sqs';",
      "new s3.Bucket(this, 'Bucket');",
      "new sqs.Queue(this, 'Queue');",
    ].join('\n');
    expect(links(code)).toEqual({
      Bucket: '/v2/docs/aws-cdk-lib.aws_s3.Bucket.html',
      Queue: '/v2/docs/aws-cdk-lib.aws_sqs.Queue.html',
    });
  });

  test('a chain links each step that is a type, and never a member', () => {
    const code = [
      "import * as cdk from 'aws-cdk-lib';",
      "import * as s3 from 'aws-cdk-lib/aws-s3';",
      "const b = cdk.aws_s3.Bucket.fromBucketName(this, 'B', 'x');",
      'const p: s3.CfnBucket.LoggingConfigurationProperty = {};',
      'cdk.Duration.minutes(5);',
    ].join('\n');
    expect(links(code)).toEqual({
      Bucket: '/v2/docs/aws-cdk-lib.aws_s3.Bucket.html',
      CfnBucket: '/v2/docs/aws-cdk-lib.aws_s3.CfnBucket.html',
      LoggingConfigurationProperty: '/v2/docs/aws-cdk-lib.aws_s3.CfnBucket.LoggingConfigurationProperty.html',
      Duration: '/v2/docs/aws-cdk-lib.Duration.html',
    });
  });

  test('a name that is not imported stays plain, even when a page exists', () => {
    expect(links("new Stack(app, 'Stack');")).toEqual({});
    expect(links("import { App } from 'aws-cdk-lib';\nnew App();\nnew Stack(app, 'S');")).toEqual({
      App: '/v2/docs/aws-cdk-lib.App.html',
    });
  });

  test('a name that resolves to no page stays plain', () => {
    expect(links("import { Aspects, App } from 'aws-cdk-lib';\nAspects.of(new App());")).toEqual({
      App: '/v2/docs/aws-cdk-lib.App.html',
    });
    expect(links("import { Thing } from 'not-documented';\nnew Thing();")).toEqual({});
  });

  test('a name the example declares itself is not the import', () => {
    const code = [
      "import { App, Stack } from 'aws-cdk-lib';",
      'class Stack {}',
      'const app = new App();',
      'new Stack();',
    ].join('\n');
    expect(links(code)).toEqual({ App: '/v2/docs/aws-cdk-lib.App.html' });
  });

  test('a name inside a string or comment is never offered', () => {
    const code = [
      "import * as s3 from 'aws-cdk-lib/aws-s3';",
      "const id = 's3.Bucket'; // s3.Bucket",
    ].join('\n');
    expect(links(code)).toEqual({});
  });

  test('a name two imports resolve differently is dropped', () => {
    const imports = [
      "import { Duration } from 'aws-cdk-lib';",
      "import * as s3 from 'aws-cdk-lib/aws-s3';",
    ].join('\n');
    const pages = new Map([...PAGES, ['aws-cdk-lib.aws_s3.Duration', '/v2/docs/aws-cdk-lib.aws_s3.Duration']]);
    const attr = readmeTypeLinksAttr('Duration.minutes(1); s3.Duration;', {
      imports, modules, linkFor: (fqn) => pages.get(fqn),
    });
    expect(attr).toBe('');
  });

  test('imports rosetta compiled the example with count, so a fixture-only import resolves', () => {
    // A README example usually shows no imports; rosetta's fixture supplies them.
    expect(links("new s3.Bucket(this, 'B');", "import s3 = require('aws-cdk-lib/aws-s3');")).toEqual({
      Bucket: '/v2/docs/aws-cdk-lib.aws_s3.Bucket.html',
    });
  });
});

describe('README type links in the built pages', () => {
  let tmp: string;
  let docs: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'readme-links-'));
    generateDocs(
      { modules: ['aws-cdk-lib', 'constructs'] },
      { outDir: join(tmp, 'modules'), publicDir: join(tmp, 'public'), packageRoot: ROOT, languages: ['ts', 'python', 'java'] },
    );
    docs = join(tmp, 'modules', 'docs');
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('the aws-cdk-lib README example links App and Stack, on every language tab', () => {
    const page = readFileSync(join(docs, 'aws-cdk-lib-readme.md'), 'utf-8');
    const first = /^```(\w+) (type-links=\S+)$/m.exec(page);
    expect(first).not.toBeNull();
    expect(first![2]).toContain('App:/v2/docs/aws-cdk-lib.App.html');
    expect(first![2]).toContain('Stack:/v2/docs/aws-cdk-lib.Stack.html');
    for (const lang of ['ts', 'python', 'java']) {
      expect(page).toMatch(new RegExp(`^\`\`\`${lang} type-links=[^\\n]*App:/v2/docs/aws-cdk-lib\\.App\\.html`, 'm'));
    }
  });

  test('an inline code span naming a type of the README module links it; headings and tables stay as they were', () => {
    const page = readFileSync(join(docs, 'aws-cdk-lib.aws_sns-readme.md'), 'utf-8');
    const prose = page.split('\n').filter((l) => !l.startsWith('|'));
    expect(prose.some((l) => l.includes('[`TopicPolicy`](/v2/docs/aws-cdk-lib.aws_sns.TopicPolicy)'))).toBe(true);
    for (const heading of page.split('\n').filter((l) => /^#{1,6}\s/.test(l))) {
      expect(heading).not.toMatch(/\]\(\/v2\/docs\//);
    }
  });

  test('every link added to a README points at an existing page', () => {
    const targets = new Set<string>();
    for (const file of readdirSync(docs).filter((f) => f.endsWith('-readme.md'))) {
      const page = readFileSync(join(docs, file), 'utf-8');
      for (const [, attr] of page.matchAll(/ type-links=(\S+)/g)) {
        for (const pair of attr.split(',')) {
          targets.add(pair.slice(pair.indexOf(':') + 1).replace(/\.html$/, ''));
        }
      }
      for (const [, link] of page.matchAll(/\[`[A-Za-z0-9_]+`\]\((\/v2\/docs\/[^)]+)\)/g)) {
        targets.add(link);
      }
    }
    expect(targets.size).toBeGreaterThan(100);
    const missing = [...targets].filter((link) => !existsSync(join(tmp, 'modules', `${link.replace(/^\/v2\//, '')}.md`)));
    expect(missing).toEqual([]);
  });
});
