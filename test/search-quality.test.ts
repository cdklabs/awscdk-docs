import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import {
  MAX_SEARCH_CANDIDATES,
  parseSearchQuery,
  withQueryFilters,
} from '../docs/.vitepress/theme/search-client.js';
import { buildTypeIndex, renderConstructPage, TypeIndex } from '../src/docgen/constructs.js';
import { loadAssembly as loadCachedAssembly } from '../src/docgen/index.js';
import {
  ignoreBlock,
  searchFilterHtml,
  searchKind,
  searchModule,
  weightedTitle,
} from '../src/docgen/search.js';
import { buildUsageIndex, renderStructPage } from '../src/docgen/symbols.js';

const ROOT = resolve(import.meta.dirname, '..');

function loadAssembly(module: string): spec.Assembly {
  return loadCachedAssembly(join(ROOT, 'node_modules', module));
}

describe('search markup helpers', () => {
  test('ignoreBlock wraps lines in a data-pagefind-ignore container with blank-line padding', () => {
    const block = ignoreBlock(['| a | b |']);
    expect(block[0]).toBe('<div data-pagefind-ignore>');
    expect(block[1]).toBe('');
    expect(block).toContain('| a | b |');
    expect(block[block.length - 2]).toBe('</div>');
  });

  test('weightedTitle boosts the symbol name above default h1 weight', () => {
    expect(weightedTitle('Bucket')).toBe('<span data-pagefind-weight="10">Bucket</span>');
  });

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

  test('searchFilterHtml emits hidden explicit-value filter spans', () => {
    const html = searchFilterHtml({ module: 'aws-s3', kind: 'construct' });
    expect(html).toContain('<span hidden data-pagefind-filter="module:aws-s3"></span>');
    expect(html).toContain('<span hidden data-pagefind-filter="kind:construct"></span>');
  });
});

describe('generated pages carry search relevance markup', () => {
  let cdk: spec.Assembly;
  let index: TypeIndex;

  beforeAll(() => {
    cdk = loadAssembly('aws-cdk-lib');
    index = buildTypeIndex([cdk, loadAssembly('constructs')]);
  });

  test('construct page weights its title and ignores props/facts boilerplate', () => {
    const type = index.get('aws-cdk-lib.aws_s3.Bucket')!.type as spec.ClassType;
    const page = renderConstructPage({
      type,
      assembly: cdk,
      index,
      linkFor: () => undefined,
    });
    expect(page).toContain('# <span data-pagefind-weight="10">Bucket</span>');
    // Props tables and the metadata block's `Source` value are excluded from
    // the index; the CloudFormation resource type is NOT, because it names
    // exactly one page and is what makes `AWS::S3::Bucket` find `Bucket`
    // (the searchability the api-reference-pages ADR gained).
    expect(page).toContain('<div class="props-table member-list" v-pre data-pagefind-ignore>');
    expect(page).toMatch(/<a class="type-metadata-source" data-pagefind-ignore [^>]*><code>aws-s3\/lib\/bucket\.ts<\/code><\/a>/);
    expect(page).toMatch(/<dd class="type-metadata-value"><a href="[^"]*aws-resource-s3-bucket\.html"[^>]*><code>AWS::S3::Bucket<\/code><\/a><\/dd>/);
    // Signatures are excluded, but only the header line that carries them:
    // a method's summary and prose are indexable, and property descriptions
    // already sit inside the props table's wholesale exclusion, so excluding
    // the methods container too would leave a type page with no indexable
    // prose at all.
    expect(page).toContain('<code class="member-signature">');
    // Neither the section nor the row line is excluded...
    expect(page).toContain('<div class="methods-table member-list" v-pre>');
    expect(page).not.toContain('<div class="methods-table member-list" v-pre data-pagefind-ignore>');
    expect(page).toContain('<div class="member-line">');
    expect(page).not.toContain('<div class="member-line" data-pagefind-ignore>');
    // ...so a method NAME stays indexable. It has no other route: members are
    // rows rather than `###` headings, and the symbol index lists types rather
    // than members. The exclusion starts immediately after the identifier and
    // covers the parameters and the return type, which are the repeated type
    // names that make a search for one type match every page using it.
    expect(page).toMatch(
      /<span class="sig-name">grantRead<\/span><span data-pagefind-ignore><span class="sig-punct">\(/,
    );
    // Breadcrumbs are excluded.
    expect(page).toMatch(/class="inheritance-chain"[^>]*data-pagefind-ignore/);
  });

  test('struct page ignores cross-reference lists', () => {
    const type = index.get('aws-cdk-lib.aws_s3.BucketProps')!.type as spec.InterfaceType;
    const usage = buildUsageIndex(index);
    const page = renderStructPage({
      type,
      assembly: cdk,
      index,
      usage,
      linkFor: () => undefined,
    });
    expect(page).toContain('# <span data-pagefind-weight="10">BucketProps</span>');
    expect(page).toMatch(/<nav class="inheritance-chain"[^>]*data-pagefind-ignore>[^\n]*id="used-as-props-by"/);
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

  test('withQueryFilters forwards parsed filters to the underlying handle', async () => {
    const calls: unknown[][] = [];
    const handle = {
      search: async (...args: unknown[]) => { calls.push(['search', ...args]); return null; },
      debouncedSearch: async (...args: unknown[]) => { calls.push(['debounced', ...args]); return null; },
    };
    const wrapped = withQueryFilters(handle);
    await wrapped.debouncedSearch!('bucket module:aws-s3', {}, 300);
    expect(calls[0]).toEqual([
      'debounced', 'bucket', { filters: { module: ['aws-s3'] } }, 300,
    ]);
    await wrapped.search!('queue kind:interface');
    expect(calls[1]).toEqual([
      'search', 'queue', { filters: { kind: ['interface'] } },
    ]);
  });

  test('withQueryFilters searches null text for a token-only query (filter browse)', async () => {
    const calls: unknown[][] = [];
    const handle = {
      debouncedSearch: async (...args: unknown[]) => { calls.push(args); return null; },
    };
    await withQueryFilters(handle).debouncedSearch!('module:aws-s3', {}, 300);
    expect(calls[0][0]).toBeNull();
  });

  test('withQueryFilters caps both search paths without changing order or metadata', async () => {
    const results = Array.from(
      { length: MAX_SEARCH_CANDIDATES + 5 },
      (_, index) => ({ index }),
    );
    const payload = {
      results,
      unfilteredResultCount: results.length + 100,
      filters: { module: { 'aws-s3': 17 } },
    };
    const handle = {
      search: async (..._args: unknown[]) => payload,
      debouncedSearch: async (..._args: unknown[]) => payload,
    };
    const wrapped = withQueryFilters(handle);

    const searches = [
      await wrapped.search!('bucket'),
      await wrapped.debouncedSearch!('bucket'),
    ];
    for (const search of searches) {
      expect(search.results).toEqual(results.slice(0, MAX_SEARCH_CANDIDATES));
      expect(search.unfilteredResultCount).toBe(payload.unfilteredResultCount);
      expect(search.filters).toBe(payload.filters);
    }
  });

  test('withQueryFilters passes plain queries through untouched', async () => {
    const calls: unknown[][] = [];
    const handle = {
      debouncedSearch: async (...args: unknown[]) => { calls.push(args); return null; },
    };
    await withQueryFilters(handle).debouncedSearch!('bucket', {}, 300);
    expect(calls[0]).toEqual(['bucket', {}, 300]);
  });
});

describe('search warm-up and ranking config', () => {
  const themeIndex = readFileSync(
    resolve(ROOT, 'docs/.vitepress/theme/index.ts'), 'utf-8',
  );
  const config = readFileSync(
    resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8',
  );

  test('theme eagerly warms the search index on client mount', () => {
    expect(themeIndex).toContain('warmSearchIndex()');
  });

  test('favorites trap composes the query-filter wrapper', () => {
    const client = readFileSync(
      resolve(ROOT, 'docs/.vitepress/theme/favorites-client.ts'), 'utf-8',
    );
    expect(client).toContain('withQueryFilters');
  });

  test('head preloads the pagefind engine module', () => {
    expect(config).toMatch(/rel:\s*"modulepreload"/);
    expect(config).toContain('pagefind/pagefind.js');
  });

  test('warm-up derives the base-prefixed url from the preload link', () => {
    const client = readFileSync(
      resolve(ROOT, 'docs/.vitepress/theme/search-client.ts'), 'utf-8',
    );
    // Must import the same base-aware URL config.mts preloads, not a
    // domain-root-only path that 404s under a DOCS_BASE-prefixed build.
    expect(client).toContain('link[rel="modulepreload"]');
    expect(client).toContain('pagefind/pagefind.js"]');
  });

  test('search placeholder advertises the filter token syntax', () => {
    expect(config).toContain('module:aws-s3 kind:construct');
  });

  test('ranking is tuned at search time on the loaded engine module', () => {
    const client = readFileSync(
      resolve(ROOT, 'docs/.vitepress/theme/search-client.ts'), 'utf-8',
    );
    // Ranking is a search-time Pagefind option (camelCase keys via
    // pagefind.options()), NOT a pagefind.yml index-time key — a
    // `ranking:` block in pagefind.yml is silently ignored.
    expect(client).toMatch(/termSimilarity/);
    expect(client).toMatch(/termFrequency/);
    expect(client).toMatch(/termSaturation/);
    expect(client).toMatch(/options\?\.\(\{ ranking: SEARCH_RANKING \}\)/);
  });

  test('pagefind.yml keeps exclude-selector parity and carries no inert ranking key', () => {
    const ymlPath = resolve(ROOT, 'pagefind.yml');
    expect(existsSync(ymlPath)).toBe(true);
    const yml = readFileSync(ymlPath, 'utf-8');
    // `ranking:` is not a valid Pagefind index-time config key and would
    // be silently ignored — it must not reappear here.
    expect(yml).not.toMatch(/^ranking:/m);
    expect(yml).toContain('div.aside');
    expect(yml).toContain('a.header-anchor');
  });

});
