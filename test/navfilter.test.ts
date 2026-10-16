import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { filterSymbols, matchRank, splitTerms, SymbolEntry, termRank } from '../docs/.vitepress/theme/filterSymbols.js';

const THEME_DIR = resolve(import.meta.dirname, '../docs/.vitepress/theme');

function sym(name: string, overrides: Partial<SymbolEntry> = {}): SymbolEntry {
  return {
    name,
    kind: 'Class',
    link: `/api/${name.toLowerCase()}`,
    service: 'S3',
    ...overrides,
  };
}

describe('splitTerms', () => {
  test('splits on whitespace into lowercase terms', () => {
    expect(splitTerms('s3 Bucket')).toEqual(['s3', 'bucket']);
  });

  test('collapses repeated and edge whitespace', () => {
    expect(splitTerms('  s3\t  bucket \n')).toEqual(['s3', 'bucket']);
  });

  test('blank queries yield no terms', () => {
    expect(splitTerms('')).toEqual([]);
    expect(splitTerms('   ')).toEqual([]);
  });
});

describe('termRank', () => {
  test('ranks a single term like matchRank', () => {
    expect(termRank('Bucket', 'buck')).toBe(0);
    expect(termRank('CfnBucket', 'bucket')).toBe(1);
    expect(termRank('Subnet', 'ubn')).toBe(2);
    expect(termRank('Bucket', 'queue')).toBeUndefined();
  });

  test('is case-insensitive on both sides', () => {
    expect(termRank('BUCKET', 'bucket')).toBe(0);
    expect(termRank('bucket', 'BUCKET')).toBe(0);
  });
});

describe('matchRank', () => {
  test('prefix match ranks best', () => {
    expect(matchRank('Bucket', 'buck')).toBe(0);
  });

  test('word-boundary match ranks second (camelCase and separators)', () => {
    expect(matchRank('CfnBucket', 'bucket')).toBe(1);
    expect(matchRank('Deployment.Options', 'options')).toBe(1);
    expect(matchRank('event_sources', 'sources')).toBe(1);
  });

  test('plain substring ranks third', () => {
    expect(matchRank('Subnet', 'ubn')).toBe(2);
  });

  test('non-matches return undefined', () => {
    expect(matchRank('Bucket', 'queue')).toBeUndefined();
  });

  test('matching is case-insensitive', () => {
    expect(matchRank('BUCKET', 'bucket')).toBe(0);
    expect(matchRank('bucket', 'BUCKET')).toBe(0);
  });

  test('multiple terms combine with AND over the same name', () => {
    expect(matchRank('aws_s3.Bucket', 's3 bucket')).toBeDefined();
    expect(matchRank('aws_s3.Bucket', 's3 topic')).toBeUndefined();
  });

  test('term order does not affect matching', () => {
    expect(matchRank('aws_s3.Bucket', 'bucket s3'))
      .toBe(matchRank('aws_s3.Bucket', 's3 bucket'));
  });

  test('extra whitespace between terms is ignored', () => {
    expect(matchRank('aws_s3.Bucket', '  s3   bucket '))
      .toBe(matchRank('aws_s3.Bucket', 's3 bucket'));
  });
});

describe('filterSymbols', () => {
  const symbols = [
    sym('CfnBucket'),
    sym('Bucket'),
    sym('BucketPolicy'),
    sym('Queue', { service: 'SQS' }),
    sym('Distribution', { service: 'CloudFront' }),
  ];

  test('empty and blank queries return no results', () => {
    expect(filterSymbols(symbols, '')).toEqual([]);
    expect(filterSymbols(symbols, '   ')).toEqual([]);
  });

  test('ranks prefix matches before word-boundary matches', () => {
    const names = filterSymbols(symbols, 'bucket').map((s) => s.name);
    expect(names).toEqual(['Bucket', 'BucketPolicy', 'CfnBucket']);
  });

  test('excludes non-matching symbols', () => {
    const names = filterSymbols(symbols, 'queue').map((s) => s.name);
    expect(names).toEqual(['Queue']);
  });

  test('respects the result limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => sym(`Bucket${i}`));
    expect(filterSymbols(many, 'bucket').length).toBe(20);
    expect(filterSymbols(many, 'bucket', 5).length).toBe(5);
  });

  test('breaks rank ties by shorter name first', () => {
    const names = filterSymbols([sym('BucketPolicyLong'), sym('Bucket')], 'buck').map((s) => s.name);
    expect(names).toEqual(['Bucket', 'BucketPolicyLong']);
  });

  test('multi-term queries AND across name and service', () => {
    const names = filterSymbols(symbols, 's3 bucket').map((s) => s.name);
    // Every S3 bucket type matches ("s3" via the service, "bucket" via
    // the name); Queue (SQS) and Distribution (CloudFront) do not.
    // Name-prefix matches (Bucket, BucketPolicy) outrank the
    // word-boundary CfnBucket.
    expect(names).toEqual(['Bucket', 'BucketPolicy', 'CfnBucket']);
  });

  test('term order does not change the result set', () => {
    expect(filterSymbols(symbols, 'bucket s3')).toEqual(filterSymbols(symbols, 's3 bucket'));
  });

  test('multi-term matching is case-insensitive with edge whitespace', () => {
    expect(filterSymbols(symbols, '  S3   BUCKET ')).toEqual(filterSymbols(symbols, 's3 bucket'));
  });

  test('a term matching nothing excludes the symbol despite other matches', () => {
    expect(filterSymbols(symbols, 'bucket zzz')).toEqual([]);
  });

  test('ranks the best AND-match first for Enter-to-jump', () => {
    // "s3 bucket": Bucket (name prefix + service) beats CfnBucket
    // (word-boundary + service) — the Enter target is aws_s3.Bucket.
    expect(filterSymbols(symbols, 's3 bucket', 1)[0].name).toBe('Bucket');
  });

  // A cross-service symbol carries both terms in its own name, so it beat the
  // canonical construct on summed name ranks.
  const crossService = [...symbols, sym('S3BucketOrigin', { service: 'CloudFront' })];

  test('a service term does not push the canonical construct below a name-only match', () => {
    expect(filterSymbols(crossService, 's3 bucket', 1)[0].name).toBe('Bucket');
  });

  test('the service qualifier still only reorders, never filters', () => {
    const names = filterSymbols(crossService, 's3 bucket').map((s) => s.name);
    expect(names).toEqual(['Bucket', 'BucketPolicy', 'CfnBucket', 'S3BucketOrigin']);
  });

  test('a service-only match stays below every name match', () => {
    const names = filterSymbols(crossService, 's3').map((s) => s.name);
    expect(names[0]).toBe('S3BucketOrigin');
    // The rest tie as service-only matches, so the shorter-name tie-break orders them.
    expect(names.slice(1)).toEqual(['Bucket', 'CfnBucket', 'BucketPolicy']);
  });

  // Two `Function` symbols match `function` identically; only the module's stability tells them apart.
  const stableAndAlpha = [
    sym('Function', { service: 'Bedrock', link: '/api/bedrock-alpha/function', experimental: true }),
    sym('Function', { service: 'Lambda', link: '/api/aws-lambda/function' }),
    sym('Bucket'),
  ];

  test('a rank tie between a stable and an experimental symbol resolves to the stable one', () => {
    const [first, second] = filterSymbols(stableAndAlpha, 'function');
    expect(first.service).toBe('Lambda');
    expect(second.service).toBe('Bedrock');
    // The Enter quick-route takes the first result, so it lands on the stable module regardless of input order.
    expect(filterSymbols([...stableAndAlpha].reverse(), 'function', 1)[0].service).toBe('Lambda');
  });

  test('stability breaks ties only: it never outranks a better match or the shorter-name rule', () => {
    // A more precise query still reaches the alpha symbol: `bedrock` matches only its service.
    expect(filterSymbols(stableAndAlpha, 'bedrock function', 1)[0].service).toBe('Bedrock');
    // A better name rank beats stability: a word-boundary match on a stable module loses to a prefix match on an
    // alpha one.
    const ranked = filterSymbols([sym('CfnFunction'), sym('Function', { experimental: true })], 'function');
    expect(ranked.map((s) => s.name)).toEqual(['Function', 'CfnFunction']);
    // Stability sits above the shorter-name rule: a longer stable name still precedes a shorter alpha one.
    const tied = filterSymbols([sym('Fn', { experimental: true }), sym('Function')], 'f');
    expect(tied.map((s) => s.name)).toEqual(['Function', 'Fn']);
  });

  test('a query only an experimental symbol matches still returns it', () => {
    const names = filterSymbols(stableAndAlpha, 'bedrock').map((s) => s.name);
    expect(names).toEqual(['Function']);
    expect(filterSymbols(stableAndAlpha, 'bedrock')[0].experimental).toBe(true);
  });
});

describe('filterSymbols construct-level terms', () => {
  const symbols = [
    sym('CfnBucket', { level: 'L1' }),
    sym('Bucket', { level: 'L2' }),
    sym('CfnQueue', { level: 'L1', service: 'SQS' }),
    sym('ApplicationLoadBalancedFargateService', { level: 'L3', service: 'ECS Patterns' }),
    sym('BucketEncryption', { kind: 'Enum' }),
  ];

  test('a bare level term returns only that level', () => {
    // Equal rank among level-only matches, so the documented tie-break applies: shorter name first.
    expect(filterSymbols(symbols, 'l1').map((s) => s.name)).toEqual(['CfnQueue', 'CfnBucket']);
    expect(filterSymbols(symbols, 'l2').map((s) => s.name)).toEqual(['Bucket']);
    expect(filterSymbols(symbols, 'l3').map((s) => s.name))
      .toEqual(['ApplicationLoadBalancedFargateService']);
  });

  test('is case-insensitive', () => {
    expect(filterSymbols(symbols, 'L2').map((s) => s.name)).toEqual(['Bucket']);
  });

  test('combines with a name term by AND', () => {
    expect(filterSymbols(symbols, 'l1 bucket').map((s) => s.name)).toEqual(['CfnBucket']);
    expect(filterSymbols(symbols, 'l2 bucket').map((s) => s.name)).toEqual(['Bucket']);
    expect(filterSymbols(symbols, 'l3 bucket')).toEqual([]);
  });

  test('combines with a service term by AND', () => {
    expect(filterSymbols(symbols, 'l1 sqs').map((s) => s.name)).toEqual(['CfnQueue']);
  });

  test('a symbol with no level never matches a level term', () => {
    expect(filterSymbols(symbols, 'l2 encryption')).toEqual([]);
    expect(filterSymbols([sym('BucketEncryption', { kind: 'Enum' })], 'l1')).toEqual([]);
  });

  test('a level term filters rather than matching a name substring', () => {
    // `Layer1` contains the two characters of an `l1` term; the term still means the level.
    const named = [sym('Layer1', { level: 'L2' })];
    expect(filterSymbols(named, 'l1')).toEqual([]);
    expect(filterSymbols(named, 'l2').map((s) => s.name)).toEqual(['Layer1']);
  });
});

describe('NavFilter component', () => {
  const componentPath = resolve(THEME_DIR, 'NavFilter.vue');

  test('component exists and consumes the shared filter logic', () => {
    expect(existsSync(componentPath)).toBe(true);
    const component = readFileSync(componentPath, 'utf-8');
    expect(component).toContain('filterSymbols');
    expect(component).toContain('theme.value.symbolsAsset');
    expect(component).toContain('apiSidebarAsset');
  });

  test('is wired into the sidebar via the theme layout slot', () => {
    const theme = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
    expect(theme).toContain('NavFilter.vue');
    // The filter is a navigation aid for the sidebar API tree, so it belongs
    // in the sidebar (sidebar-nav-before) rather than the nav header. The
    // slot's children sit inside `.sidebar-header` so they can be pinned, so
    // the mount is asserted rather than the slot's exact text.
    const mount = /"sidebar-nav-before":\s*\(\)\s*=>\s*([\s\S]*?)\n      "doc-before"/.exec(theme);
    expect(mount).not.toBeNull();
    expect(mount![1]).toMatch(/h\(\s*NavFilter\s*[,)]/);
    expect(theme).not.toContain('"nav-bar-content-after": () => h(NavFilter)');
    expect(theme).not.toContain('"nav-bar-content-before": () => h(NavFilter)');
  });

  test('publishes the query into the shared sidebar filter state, no popup', () => {
    const component = readFileSync(componentPath, 'utf-8');
    // Typing filters the actual sidebar in place: the query is
    // published to the shared state consumed by ApiSidebar.vue …
    expect(component).toContain('sidebarFilterQuery');
    // … and no overlay listbox is rendered.
    expect(component).not.toContain('role="combobox"');
    expect(component).not.toContain('role="listbox"');
    expect(component).not.toContain('nav-filter-listbox');
    expect(component).not.toContain('aria-activedescendant');
  });

  test('keeps the keyboard affordances: Enter jumps to the best match, Escape clears', () => {
    const component = readFileSync(componentPath, 'utf-8');
    expect(component).toContain('Enter');
    expect(component).toContain('Escape');
    expect(component).toContain('aria-label');
    expect(component).toContain('aria-live');
  });

  test('has a clear button that only renders with a value and refocuses the input', () => {
    const component = readFileSync(componentPath, 'utf-8');
    // Rendered conditionally (v-if) so the hidden control is never
    // announced or tab-reachable when the input is empty.
    expect(component).toContain('v-if="query.length > 0"');
    expect(component).toContain('class="nav-filter-clear"');
    expect(component).toContain('aria-label="Clear filter"');
    // type="button" so it never submits an enclosing form.
    expect(component).toContain('type="button"');
    // Clicking clears AND returns focus to the input.
    expect(component).toContain('@click="onClear"');
    expect(component).toMatch(/inputEl\.value\?\.focus\(\)/);
    // Masked glyph from the shared stylesheet, no new icon dependency.
    expect(component).toContain('class="glyph glyph-clear nav-filter-clear-glyph"');
    expect(component).toContain('aria-hidden="true"');
  });

  test('uses theme variables so light and dark mode both apply', () => {
    const component = readFileSync(componentPath, 'utf-8');
    // No hard-coded colors: styling goes through --vp-c-* variables.
    expect(component).toContain('var(--vp-c-bg-alt)');
    expect(component).toContain('var(--vp-c-text-1)');
    expect(component).toContain('var(--vp-c-brand-1)');
    const styleBlock = component.slice(component.indexOf('<style'));
    expect(styleBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test('navigates with the site base path', () => {
    const component = readFileSync(componentPath, 'utf-8');
    expect(component).toContain('withBase');
    expect(component).toContain('useRouter');
  });
});

describe('shared sidebar filter state', () => {
  test('the sidebar-filter composable exists and exports the query ref', () => {
    const composablePath = resolve(THEME_DIR, 'sidebar-filter.ts');
    expect(existsSync(composablePath)).toBe(true);
    const composable = readFileSync(composablePath, 'utf-8');
    expect(composable).toContain('export const sidebarFilterQuery');
  });

  test('ApiSidebar consumes the filter state and prunes with the shared matcher', () => {
    const sidebar = readFileSync(resolve(THEME_DIR, 'ApiSidebar.vue'), 'utf-8');
    expect(sidebar).toContain('sidebarFilterQuery');
    expect(sidebar).toContain('filterSidebarTree');
    // Same matching algorithm as Enter-to-jump: the per-term matcher and
    // query tokenizer from filterSymbols (AND semantics).
    expect(sidebar).toContain('termRank');
    expect(sidebar).toContain('splitTerms');
  });

  test('groups are forced open while filtering without touching user state', () => {
    const item = readFileSync(resolve(THEME_DIR, 'ApiSidebarItem.vue'), 'utf-8');
    expect(item).toContain('ctx.filtering.value || ctx.expanded.value.has(key.value)');
  });
});
