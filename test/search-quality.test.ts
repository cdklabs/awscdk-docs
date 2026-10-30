import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import {
  closeModules,
  matchModules,
  MAX_SEARCH_CANDIDATES,
  MODULE_HINT_LIMIT,
  moduleHintText,
  normalizeModuleValue,
  OVERVIEW_KIND,
  parseSearchQuery,
  serviceWords,
  withQueryFilters,
} from '../docs/.vitepress/theme/search-client.js';
import { buildTypeIndex, renderConstructPage, TypeIndex } from '../src/docgen/constructs.js';
import { generateDocs, loadAssembly as loadCachedAssembly } from '../src/docgen/index.js';
import {
  ignoreBlock,
  OVERVIEW_SEARCH_KIND,
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
    // Property names are indexable in their owning type-page entry, while
    // property summaries, repeated types, defaults, and metadata sources stay out.
    expect(page).toContain('<div class="props-table member-list" v-pre>');
    expect(page).not.toContain('<div class="props-table member-list" v-pre data-pagefind-ignore>');
    expect(page).toMatch(/<code class="member-name">\w+<\/code><span class="member-type" data-pagefind-ignore /);
    expect(page).toMatch(/<span class="member-default" data-pagefind-ignore>/);
    expect(page).toMatch(/<div class="member-summary" data-pagefind-ignore>/);
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

  test('parseSearchQuery normalizes module values to the indexed slug shape', () => {
    // Readers type what the sidebar and import paths show: underscores, package scopes, mixed case.
    expect(parseSearchQuery('api module:aws_apigatewayv2').filters).toEqual({ module: ['aws-apigatewayv2'] });
    expect(parseSearchQuery('module:@aws-cdk/aws-s3-alpha').filters).toEqual({ module: ['aws-cdk-aws-s3-alpha'] });
    expect(parseSearchQuery('module:AWS_S3').filters).toEqual({ module: ['aws-s3'] });
    expect(normalizeModuleValue('@aws-cdk/aws_lambda_python-alpha')).toBe('aws-cdk-aws-lambda-python-alpha');
    // kind: stays an exact, lowercased value.
    expect(parseSearchQuery('kind:Construct_L2').filters).toEqual({ kind: ['construct_l2'] });
  });

  test('normalizeModuleValue produces exactly the slug docgen stores for the same module', () => {
    // The client and docgen each hold a copy of the slug transform; if either drifts, the module:
    // filter silently matches nothing while both unit suites stay green. This pins them together.
    for (const typed of ['aws_s3', 'aws-s3', '@aws-cdk/aws-s3-alpha', 'aws_lambda/python', 'AWS_S3', 'constructs']) {
      expect(normalizeModuleValue(typed)).toBe(searchModule('aws-cdk-lib', typed));
    }
  });

  const KNOWN = [
    'aws-ecs', 'aws-lambda', 'aws-lambda-python-alpha', 'aws-s3', 'aws-s3-assets', 'aws-s3-deployment',
    'aws-s3-notifications', 'aws-s3tables-alpha', 'aws-sns', 'aws-sqs', 'constructs',
  ];

  test('matchModules: an exact module name selects only that module', () => {
    expect(matchModules('aws-s3', KNOWN)).toEqual(['aws-s3']);
    expect(matchModules('aws-lambda', KNOWN)).toEqual(['aws-lambda']);
  });

  test('matchModules: otherwise each typed word prefixes a module word, in order', () => {
    expect(matchModules('s3', KNOWN)).toEqual([
      'aws-s3', 'aws-s3-assets', 'aws-s3-deployment', 'aws-s3-notifications', 'aws-s3tables-alpha',
    ]);
    expect(matchModules('lambda-python', KNOWN)).toEqual(['aws-lambda-python-alpha']);
    expect(matchModules('lam', KNOWN)).toEqual(['aws-lambda', 'aws-lambda-python-alpha']);
    // Words out of order, or a word prefixing nothing, select nothing.
    expect(matchModules('python-lambda', KNOWN)).toEqual([]);
    expect(matchModules('bucket', KNOWN)).toEqual([]);
    expect(matchModules('', KNOWN)).toEqual([]);
  });

  test('closeModules offers up to five near names, containing matches first', () => {
    expect(closeModules('s3bucket', KNOWN)).toHaveLength(MODULE_HINT_LIMIT);
    expect(closeModules('lambd', KNOWN).slice(0, 2)).toEqual(['aws-lambda', 'aws-lambda-python-alpha']);
    expect(closeModules('sqs', ['aws-sns', 'aws-sqs'])).toEqual(['aws-sqs', 'aws-sns']);
    expect(moduleHintText(['sq'], ['aws-sqs'])).toBe('No module matches module:sq. Try: aws-sqs');
    expect(moduleHintText([], ['aws-s3'])).toBe('No results in that module. Try: aws-s3');
  });

  test('withQueryFilters resolves module values against the modules the engine reports', async () => {
    const calls: unknown[][] = [];
    let filterReads = 0;
    const handle = {
      filters: async () => { filterReads++; return { module: Object.fromEntries(KNOWN.map((m) => [m, 1])) }; },
      search: async (...args: unknown[]) => { calls.push(args); return { results: [{}] }; },
    };
    const wrapped = withQueryFilters(handle);
    await wrapped.search!('bucket module:aws_s3');
    expect(calls[0]).toEqual(['bucket', { filters: { module: ['aws-s3'] } }]);
    await wrapped.search!('bucket module:s3');
    expect(calls[1]).toEqual(['bucket', {
      filters: {
        module: {
          any: [
            'aws-s3', 'aws-s3-assets', 'aws-s3-deployment', 'aws-s3-notifications', 'aws-s3tables-alpha',
          ],
        },
      },
    }]);
    // Several module tokens union; kind stays exact beside them.
    await wrapped.search!('module:aws-sns module:sqs kind:construct');
    expect(calls[2]).toEqual([null, { filters: { module: { any: ['aws-sns', 'aws-sqs'] }, kind: ['construct'] } }]);
    // The engine's module list is read once per handle.
    expect(filterReads).toBe(1);
  });

  test('withQueryFilters answers empty without searching when no module matches', async () => {
    const calls: unknown[][] = [];
    const handle = {
      filters: async () => ({ module: { 'aws-sns': 3, 'aws-sqs': 2 } }),
      debouncedSearch: async (...args: unknown[]) => { calls.push(args); return { results: [{}] }; },
    };
    const search = await withQueryFilters(handle).debouncedSearch!('topic module:nothing', {}, 300);
    expect(calls).toEqual([]);
    expect((search as { results: unknown[] }).results).toEqual([]);
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

  describe('service overview pin', () => {
    const MODULES = ['aws-rds', 'aws-s3', 'aws-sqs', 'aws-lambda', 'aws-cdk-lib', 'constructs'];
    const OVERVIEW = { id: 'rds-overview' };
    // A fake engine: the overview search answers the overview, the text search a long ranked pool
    // that also contains the overview further down.
    const fakeHandle = (overviewResults: unknown[] = [OVERVIEW]) => {
      const calls: unknown[][] = [];
      const pool = Array.from({ length: MAX_SEARCH_CANDIDATES + 10 }, (_, i) => ({ id: `r${i}` }));
      pool.splice(33, 0, OVERVIEW);
      const payload = { results: pool, unfilteredResultCount: 999, filters: { kind: { class: 5 } } };
      const answer = (_text: unknown, options?: { filters?: { kind?: unknown } }) =>
        options?.filters?.kind ? { results: overviewResults, unfilteredResultCount: 1, filters: {} } : payload;
      const handle = {
        filters: async () => ({ module: Object.fromEntries(MODULES.map((m) => [m, 1])) }),
        search: async (...args: unknown[]) => { calls.push(['search', ...args]); return answer(args[0], args[1] as never); },
        debouncedSearch: async (...args: unknown[]) => {
          calls.push(['debounced', ...args]); return answer(args[0], args[1] as never);
        },
      };
      return { handle, calls, payload };
    };
    const ids = (search: unknown) => (search as { results: { id: string }[] }).results.map((r) => r.id);

    test.each(['rds', 'RDS', ' rds ', 'aws_rds', 'aws-rds'])('%p pins the aws-rds overview first, once', async (query) => {
      const { handle, calls, payload } = fakeHandle();
      const search = await withQueryFilters(handle).search!(query);
      // The service word, so the overview has matched terms for the dialog to render it with.
      expect(calls).toContainEqual(['search', 'rds', { filters: { module: ['aws-rds'], kind: ['overview'] } }]);
      expect(ids(search)[0]).toBe('rds-overview');
      expect(ids(search).filter((id) => id === 'rds-overview')).toHaveLength(1);
      expect(ids(search)).toHaveLength(MAX_SEARCH_CANDIDATES);
      expect(ids(search).slice(1, 4)).toEqual(['r0', 'r1', 'r2']);
      // Counts and filter facets stay the main search's.
      expect((search as typeof payload).unfilteredResultCount).toBe(999);
      expect((search as typeof payload).filters).toBe(payload.filters);
    });

    test('debouncedSearch pins too, with an undebounced overview search', async () => {
      const { handle, calls } = fakeHandle();
      const search = await withQueryFilters(handle).debouncedSearch!('sqs', {}, 300);
      expect(calls).toEqual([
        ['debounced', 'sqs', {}, 300],
        ['search', 'sqs', { filters: { module: ['aws-sqs'], kind: ['overview'] } }],
      ]);
      expect(ids(search)[0]).toBe('rds-overview');
    });

    test.each(['rds instance', 'rds kind:construct', 'module:rds', 'bucket', 'cdk'])('%p makes no extra call', async (query) => {
      const { handle, calls } = fakeHandle();
      await withQueryFilters(handle).search!(query);
      expect(calls).toHaveLength(1);
      expect(calls.some(([, , options]) => JSON.stringify(options).includes('overview'))).toBe(false);
    });

    test('no pin when the engine reports no module list or the overview search finds nothing', async () => {
      const bare = fakeHandle();
      const noFilters = { search: bare.handle.search };
      const unpinned = await withQueryFilters(noFilters).search!('rds');
      expect(bare.calls).toHaveLength(1);
      expect(ids(unpinned)[0]).toBe('r0');

      const empty = fakeHandle([]);
      const search = await withQueryFilters(empty.handle).search!('rds');
      expect(ids(search)[0]).toBe('r0');
      expect(ids(search)).toHaveLength(MAX_SEARCH_CANDIDATES);
    });

    test('serviceWords drops the aws- prefix and splits module words', () => {
      expect(serviceWords('aws-rds')).toBe('rds');
      expect(serviceWords('aws-lambda-nodejs')).toBe('lambda nodejs');
      expect(serviceWords('constructs')).toBe('constructs');
    });

    test('the theme and docgen agree on the overview kind value', () => {
      expect(OVERVIEW_KIND).toBe(OVERVIEW_SEARCH_KIND);
    });
  });
});

describe('overview pages carry the overview search filter', () => {
  let outDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'search-overview-'));
    generateDocs({ modules: ['aws-cdk-lib', 'constructs'] }, { outDir, packageRoot: ROOT, languages: ['ts'] });
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a submodule overview carries kind:overview next to its module filter', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_sqs-readme.md'), 'utf-8');
    expect(page).toContain('<span hidden data-pagefind-filter="module:aws-sqs"></span>');
    expect(page).toContain('<span hidden data-pagefind-filter="kind:overview"></span>');
  });

  test('a package overview carries kind:overview and its package module filter', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs-readme.md'), 'utf-8');
    expect(page).toContain('<span hidden data-pagefind-filter="module:constructs"></span>');
    expect(page).toContain('<span hidden data-pagefind-filter="kind:overview"></span>');
  });

  test('type pages keep their own kind', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_sqs.Queue.md'), 'utf-8');
    expect(page).toContain('<span hidden data-pagefind-filter="kind:construct"></span>');
    expect(page).not.toContain('kind:overview');
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
