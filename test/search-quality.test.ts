import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import {
  matchesFilters,
  parseSearchQuery,
  SiteSearch,
  tokenize,
} from '../docs/.vitepress/theme/search-client.js';
import { buildTypeIndex, renderConstructPage, TypeIndex } from '../src/docgen/constructs.js';
import { loadAssembly as loadCachedAssembly } from '../src/docgen/index.js';
import {
  buildSearchIndex,
  MODULE_KIND,
  searchKind,
  searchModule,
  searchSummary,
  SUMMARY_MAX_CHARS,
} from '../src/docgen/search.js';
import { buildUsageIndex, renderStructPage } from '../src/docgen/symbols.js';

const ROOT = resolve(import.meta.dirname, '..');

function loadAssembly(module: string): spec.Assembly {
  return loadCachedAssembly(join(ROOT, 'node_modules', module));
}

describe('search index helpers', () => {
  test('searchKind collapses construct levels to a small vocabulary', () => {
    expect(searchKind('Construct (L2)')).toBe('construct');
    expect(searchKind('Class')).toBe('class');
    expect(searchKind('Struct (datatype)')).toBe('struct');
    expect(searchKind('Enum')).toBe('enum');
  });

  test('searchModule prefers the submodule slug and normalizes separators', () => {
    expect(searchModule('aws-cdk-lib', 'aws_s3')).toBe('aws-s3');
    expect(searchModule('aws-cdk-lib', '')).toBe('aws-cdk-lib');
    expect(searchModule('@scoped/pkg', '')).toBe('scoped-pkg');
  });

  test('searchSummary keeps the first paragraph as plain text', () => {
    const markdown = [
      '# Title',
      '',
      'An **S3** bucket with a [link](https://example.com) and `code`.',
      'Second line of the same paragraph.',
      '',
      'A second paragraph that is not part of the summary.',
    ].join('\n');
    expect(searchSummary(markdown)).toBe('Title');
    expect(searchSummary(markdown.replace('# Title\n\n', ''))).toBe(
      'An S3 bucket with a link and code. Second line of the same paragraph.',
    );
    expect(searchSummary('<span class="x">Inline</span> html <b>stripped</b>')).toBe('Inline html stripped');
    expect(searchSummary(undefined)).toBe('');
  });

  test('searchSummary truncates long prose on a word boundary', () => {
    const summary = searchSummary(Array(80).fill('word').join(' '));
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 1);
    expect(summary.endsWith('word…')).toBe(true);
  });

  test('buildSearchIndex dedupes by link and sorts for a stable asset hash', () => {
    const entry = (link: string, title: string) => ({ link, title, kind: 'class', module: 'aws-s3', summary: '' });
    const index = buildSearchIndex([entry('/b', 'B'), entry('/a', 'A'), entry('/b', 'B2')]);
    expect(index.map((e) => e.link)).toEqual(['/a', '/b']);
    expect(index[1].title).toBe('B2');
  });
});

describe('generated pages carry no search-engine markup', () => {
  let cdk: spec.Assembly;
  let index: TypeIndex;

  beforeAll(() => {
    cdk = loadAssembly('aws-cdk-lib');
    index = buildTypeIndex([cdk, loadAssembly('constructs')]);
  });

  test('construct page title and tables are plain markup', () => {
    const type = index.get('aws-cdk-lib.aws_s3.Bucket')!.type as spec.ClassType;
    const page = renderConstructPage({
      type,
      assembly: cdk,
      index,
      linkFor: () => undefined,
    });
    expect(page).toContain('# Bucket');
    expect(page).toContain('<div class="props-table member-list" v-pre>');
    expect(page).toMatch(/<span class="sig-name">grantRead<\/span><span class="sig-punct">\(/);
    expect(page).not.toContain('data-pagefind');
  });

  test('struct page cross-reference lists are plain lists', () => {
    const type = index.get('aws-cdk-lib.aws_s3.BucketProps')!.type as spec.InterfaceType;
    const usage = buildUsageIndex(index);
    const page = renderStructPage({
      type,
      assembly: cdk,
      index,
      usage,
      linkFor: () => undefined,
    });
    expect(page).toContain('# BucketProps');
    expect(page).toMatch(/## Used as props by \{#used-as-props-by\}\n\n- /);
    expect(page).not.toContain('data-pagefind');
  });
});

describe('query token filters', () => {
  test('parseSearchQuery splits module:/kind: tokens from text', () => {
    expect(parseSearchQuery('bucket module:aws-s3 kind:construct')).toEqual({
      text: 'bucket',
      filters: { module: ['aws-s3'], kind: ['construct'] },
    });
  });

  test('parseSearchQuery leaves unknown keys and bare colons in the text', () => {
    expect(parseSearchQuery('foo:bar module: s3:CreateBucket')).toEqual({
      text: 'foo:bar module: s3:CreateBucket',
      filters: {},
    });
  });

  test('parseSearchQuery lowercases filter values', () => {
    expect(parseSearchQuery('Kind:Construct').filters).toEqual({ kind: ['construct'] });
  });

  test('matchesFilters requires every key and accepts any listed value', () => {
    const doc = { link: '/x', title: 'X', kind: 'construct', module: 'aws-s3', summary: '' };
    expect(matchesFilters(doc, {})).toBe(true);
    expect(matchesFilters(doc, { module: ['aws-s3'] })).toBe(true);
    expect(matchesFilters(doc, { module: ['aws-sqs', 'aws-s3'] })).toBe(true);
    expect(matchesFilters(doc, { module: ['aws-s3'], kind: ['class'] })).toBe(false);
  });
});

describe('MiniSearch site search', () => {
  const docs = [
    { link: '/v2/docs/aws-cdk-lib.aws_s3.Bucket', title: 'Bucket', kind: 'construct', module: 'aws-s3', summary: 'An S3 bucket with helpers to define website hosting and notifications.' },
    { link: '/v2/docs/aws-cdk-lib.aws_s3.BucketProps', title: 'BucketProps', kind: 'struct', module: 'aws-s3', summary: 'Properties for a bucket.' },
    { link: '/v2/docs/aws-cdk-lib.aws_sqs.Queue', title: 'Queue', kind: 'construct', module: 'aws-sqs', summary: 'A new Amazon SQS queue. Dead-letter targets can be a bucket notification.' },
    { link: '/v2/docs/aws-cdk-lib.aws_lambda.Function', title: 'Function', kind: 'construct', module: 'aws-lambda', summary: 'Deploys a file from inside the construct library as a function.' },
    { link: '/v2/docs/@aws-cdk_aws-lambda-python-alpha.PythonFunction', title: 'PythonFunction', kind: 'construct', module: 'aws-lambda-python-alpha', summary: 'A Python Lambda function.' },
    { link: '/v2/docs/aws-cdk-lib.aws_s3-readme', title: 'aws-cdk-lib.aws_s3', kind: MODULE_KIND, module: 'aws-s3', summary: 'Amazon S3 construct library.' },
  ];
  const search = new SiteSearch(docs);

  test('tokenize splits camelCase identifiers but keeps the whole name', () => {
    expect(tokenize('PythonFunction')).toEqual(['PythonFunction', 'Python', 'Function']);
    expect(tokenize('aws-cdk-lib.aws_s3')).toEqual(['aws', 'cdk', 'lib', 'aws', 's3']);
  });

  test('a title match outranks a summary mention', () => {
    const hits = search.search('bucket');
    expect(hits[0].title).toBe('Bucket');
    expect(hits.map((h) => h.title)).toContain('Queue');
    expect(hits.findIndex((h) => h.title === 'Queue')).toBeGreaterThan(hits.findIndex((h) => h.title === 'BucketProps'));
  });

  test('camelCase parts are searchable', () => {
    expect(search.search('python').map((h) => h.title)).toEqual(['PythonFunction']);
    expect(search.search('function').map((h) => h.title)).toEqual(['Function', 'PythonFunction']);
  });

  test('module: and kind: tokens narrow the results', () => {
    expect(search.search('bucket module:aws-sqs').map((h) => h.title)).toEqual(['Queue']);
    expect(search.search('bucket kind:struct').map((h) => h.title)).toEqual(['BucketProps']);
  });

  test('a filter-only query lists the matching pages by title', () => {
    expect(search.search('module:aws-s3').map((h) => h.title)).toEqual(['aws-cdk-lib.aws_s3', 'Bucket', 'BucketProps']);
    expect(search.search('kind:module').map((h) => h.link)).toEqual(['/v2/docs/aws-cdk-lib.aws_s3-readme']);
  });

  test('an empty query returns nothing and an unknown term returns nothing', () => {
    expect(search.search('')).toEqual([]);
    expect(search.search('   ')).toEqual([]);
    expect(search.search('zzzzqqq')).toEqual([]);
  });
});

describe('search wiring', () => {
  const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
  const themeIndex = readFileSync(resolve(ROOT, 'docs/.vitepress/theme/index.ts'), 'utf-8');

  test('the theme search component takes the navbar search slot', () => {
    expect(config).toMatch(/VPNavBarSearch\\\.vue\$/);
    expect(config).toContain('theme/SearchBox.vue');
    expect(config).toContain('...searchAsset()');
  });

  test('search runs without WebAssembly: no Pagefind runtime or preload remains', () => {
    expect(config).not.toMatch(/pagefind/i);
    expect(themeIndex).not.toMatch(/pagefind/i);
    expect(themeIndex).toContain('./site-search.css');
  });

  test('search placeholder advertises the filter token syntax', () => {
    const box = readFileSync(resolve(ROOT, 'docs/.vitepress/theme/SearchBox.vue'), 'utf-8');
    expect(box).toContain('module:aws-s3 kind:construct');
  });
});
