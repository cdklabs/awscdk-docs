import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  activeAncestorKeys,
  apiSidebarAsset,
  chunkAsset,
  chunkForPath,
  chunkNames,
  filterSidebarTree,
  groupKey,
  isActiveLink,
  isUnloadedChunk,
  loadedGroupKeys,
  moduleRowText,
  normalizePath,
  preOpenedRootKeys,
  retainedGroupKeys,
  serviceForPath,
  serviceNodes,
  servicesViewTree,
  serviceViewItems,
  unloadedChunkForKey,
  withChunk,
  type ApiSidebarNode,
} from '../docs/.vitepress/theme/api-sidebar.js';
import { splitTerms, termRank } from '../docs/.vitepress/theme/filterSymbols.js';
import { constructCount, serviceRows } from '../src/sidebar-rows.js';

describe('preOpenedRootKeys', () => {
  const leaf = (text: string): ApiSidebarNode => ({ text, link: `/${text}` });

  test('collects root groups the tree marks pre-opened', () => {
    const tree: ApiSidebarNode[] = [
      { text: 'Framework', collapsed: false, items: [leaf('Core')] },
      { text: 'Services', collapsed: false, items: [leaf('S3')] },
    ];
    expect(preOpenedRootKeys(tree)).toEqual(new Set(['Framework', 'Services']));
  });

  test('collapsed and unmarked root groups stay closed', () => {
    const tree: ApiSidebarNode[] = [
      { text: 'Closed', collapsed: true, items: [leaf('A')] },
      { text: 'Unmarked', items: [leaf('B')] },
    ];
    expect(preOpenedRootKeys(tree).size).toBe(0);
  });

  test('is root-only: nested pre-opened groups are not collected', () => {
    const tree: ApiSidebarNode[] = [
      {
        text: 'Framework',
        collapsed: false,
        items: [{ text: 'Constructs', collapsed: false, items: [leaf('App')] }],
      },
    ];
    expect(preOpenedRootKeys(tree)).toEqual(new Set(['Framework']));
  });

  test('ignores leaves regardless of their collapsed flag', () => {
    const tree: ApiSidebarNode[] = [{ text: 'Lone', collapsed: false }];
    expect(preOpenedRootKeys(tree).size).toBe(0);
  });
});

describe('normalizePath', () => {
  test('strips the site base, leading slash, .html, and trailing slash', () => {
    expect(normalizePath('/cdk-docs/api/modules/ts/aws-cdk-lib/aws-s3/Bucket.html', '/cdk-docs/'))
      .toBe('api/modules/ts/aws-cdk-lib/aws-s3/Bucket');
    expect(normalizePath('/cdk-docs/api/', '/cdk-docs/')).toBe('api');
    expect(normalizePath('/cdk-docs/', '/cdk-docs/')).toBe('');
  });

  test('normalizes a clean site-absolute link (base defaults to /)', () => {
    expect(normalizePath('/api/modules/ts/aws-cdk-lib/aws-s3/Bucket'))
      .toBe('api/modules/ts/aws-cdk-lib/aws-s3/Bucket');
  });

  test('drops a trailing /index', () => {
    expect(normalizePath('/api/modules/ts/aws-cdk-lib/index', '/')).toBe('api/modules/ts/aws-cdk-lib');
  });

  test('a base without a trailing slash is still stripped', () => {
    expect(normalizePath('/cdk-docs/api/x.html', '/cdk-docs')).toBe('api/x');
  });
});

describe('apiSidebarAsset', () => {
  test('points at the single canonical skeleton asset', () => {
    // There is ONE skeleton asset, not one per language: the sidebar always
    // fetches it, and the display language only flips node labels in place
    // (displayLabel below).
    expect(apiSidebarAsset('sidebar.0a1b2c3d.js')).toBe('/api-sidebar/sidebar.0a1b2c3d.js');
  });

  test('resolves to nothing when the build supplied no filename', () => {
    expect(apiSidebarAsset('')).toBe('');
  });

  test('chunk files sit beside the skeleton', () => {
    expect(chunkAsset('s3.0a1b2c3d.js')).toBe('/api-sidebar/chunks/s3.0a1b2c3d.js');
  });
});

describe('per-section chunks', () => {
  const leaf = (text: string, link: string): ApiSidebarNode => ({ text, link });
  const s3Items: ApiSidebarNode[] = [
    { text: 'Bucket', items: [leaf('Bucket', '/v2/docs/aws-cdk-lib.aws_s3.Bucket')] },
  ];
  const skeleton: ApiSidebarNode[] = [
    {
      text: 'Framework',
      section: true,
      collapsed: false,
      items: [{ text: 'aws-cdk-lib', collapsed: true, modules: ['aws-cdk-lib'], chunk: 'aws-cdk-lib' }],
    },
    {
      text: 'Services',
      section: true,
      collapsed: false,
      items: [
        { text: 'S3', collapsed: true, modules: ['aws-cdk-lib.aws_s3', 'aws-cdk-lib.aws_s3_deployment'], chunk: 's3' },
        { text: 'SNS', collapsed: true, modules: ['aws-cdk-lib.aws_sns'], chunk: 'sns' },
      ],
    },
  ];
  const DOCS = 'v2/docs/';

  test('chunkForPath resolves a type page and an overview page to their section', () => {
    expect(chunkForPath(skeleton, 'v2/docs/aws-cdk-lib.aws_sns.Topic', DOCS)).toBe('sns');
    expect(chunkForPath(skeleton, 'v2/docs/aws-cdk-lib.aws_sns-readme', DOCS)).toBe('sns');
    expect(chunkForPath(skeleton, 'v2/docs/aws-cdk-lib.aws_s3.CfnBucket.PolicyProperty', DOCS)).toBe('s3');
    expect(chunkForPath(skeleton, 'v2/docs/aws-cdk-lib.App', DOCS)).toBe('aws-cdk-lib');
  });

  test('chunkForPath matches whole stems: aws_s3 does not claim aws_s3_deployment pages by prefix', () => {
    const only: ApiSidebarNode[] = [
      { text: 'Services', section: true, items: [{ text: 'A', modules: ['aws-cdk-lib.aws_s3'], chunk: 'a' }] },
    ];
    // With no section owning aws_s3_deployment, a bare string-prefix match would wrongly answer `a`.
    expect(chunkForPath(only, 'v2/docs/aws-cdk-lib.aws_s3_deployment.BucketDeployment', DOCS)).toBeUndefined();
    expect(chunkForPath(only, 'v2/docs/aws-cdk-lib.aws_s3_deployment-readme', DOCS)).toBeUndefined();
    expect(chunkForPath(only, 'v2/docs/aws-cdk-lib.aws_s3.Bucket', DOCS)).toBe('a');
  });

  test('chunkForPath is undefined outside every section, such as the API root', () => {
    expect(chunkForPath(skeleton, 'v2', DOCS)).toBeUndefined();
    expect(chunkForPath(skeleton, 'v2/docs/unknown.Thing', DOCS)).toBeUndefined();
  });

  test('an unloaded section is a group, not a leaf, for ancestor and key walks', () => {
    // No items yet, but a chunk: it must still be a group so it renders as a
    // toggle and its key is known to the disclosure store.
    expect(loadedGroupKeys(skeleton)).toEqual(
      new Set(['Framework', groupKey('Framework', 'aws-cdk-lib'), 'Services', groupKey('Services', 'S3'), groupKey('Services', 'SNS')]),
    );
    expect(activeAncestorKeys(skeleton, 'v2/docs/aws-cdk-lib.aws_s3.Bucket').size).toBe(0);
  });

  test('withChunk puts a chunk in place without touching the other nodes', () => {
    const loaded = withChunk(skeleton, 's3', s3Items);
    expect(loaded[0]).toBe(skeleton[0]);
    expect(loaded[1]).not.toBe(skeleton[1]);
    expect(loaded[1].items![1]).toBe(skeleton[1].items![1]);
    expect(loaded[1].items![0].items).toBe(s3Items);
    expect(loaded[1].items![0].chunk).toBe('s3');
    // The active branch is now resolvable.
    expect(activeAncestorKeys(loaded, 'v2/docs/aws-cdk-lib.aws_s3.Bucket')).toEqual(
      new Set(['Services', groupKey('Services', 'S3'), groupKey(groupKey('Services', 'S3'), 'Bucket')]),
    );
    expect(unloadedChunkForKey(loaded, groupKey('Services', 'S3'))).toBeUndefined();
    expect(unloadedChunkForKey(loaded, groupKey('Services', 'SNS'))).toBe('sns');
  });

  test('chunkNames lists every chunk in tree order', () => {
    expect(chunkNames(skeleton)).toEqual(['aws-cdk-lib', 's3', 'sns']);
  });

  test('retainedGroupKeys keeps stored keys under unloaded sections and drops dead ones under loaded sections', () => {
    const loaded = withChunk(skeleton, 's3', s3Items);
    const stored = [
      groupKey(groupKey('Services', 'SNS'), 'Topic'), // inside an unloaded section: cannot be judged, keep
      groupKey(groupKey('Services', 'S3'), 'Bucket'), // inside a loaded section and present: keep
      groupKey(groupKey('Services', 'S3'), 'Gone'), // inside a loaded section and absent: drop
      groupKey('Services', 'Removed'), // a section the tree no longer has: drop
    ];
    const keep = retainedGroupKeys(loaded, stored);
    expect(keep.has(stored[0])).toBe(true);
    expect(keep.has(stored[1])).toBe(true);
    expect(keep.has(stored[2])).toBe(false);
    expect(keep.has(stored[3])).toBe(false);
  });
});

describe('isActiveLink', () => {
  const active = normalizePath('/cdk-docs/api/modules/ts/aws-cdk-lib/aws-s3/Bucket.html', '/cdk-docs/');

  test('matches the current page across base/.html differences', () => {
    expect(isActiveLink('/api/modules/ts/aws-cdk-lib/aws-s3/Bucket', active)).toBe(true);
  });

  test('does not match a different page or an undefined link', () => {
    expect(isActiveLink('/api/modules/ts/aws-cdk-lib/aws-s3/BucketPolicy', active)).toBe(false);
    expect(isActiveLink(undefined, active)).toBe(false);
  });
});

describe('activeAncestorKeys', () => {
  const tree: ApiSidebarNode[] = [
    {
      text: 'S3',
      items: [
        {
          text: 'Bucket',
          items: [
            {
              text: 'Constructs',
              items: [{ text: 'Bucket', link: '/api/modules/ts/aws-cdk-lib/aws-s3/Bucket' }],
            },
          ],
        },
      ],
    },
    {
      text: 'SQS',
      items: [
        {
          text: 'Queue',
          items: [{ text: 'Queue', link: '/api/modules/ts/aws-cdk-lib/aws-sqs/Queue' }],
        },
      ],
    },
  ];

  test('returns the keys of every group on the path to the active leaf', () => {
    const active = normalizePath('/cdk-docs/api/modules/ts/aws-cdk-lib/aws-s3/Bucket.html', '/cdk-docs/');
    const keys = activeAncestorKeys(tree, active);
    expect(keys.has(groupKey('', 'S3'))).toBe(true);
    expect(keys.has(groupKey(groupKey('', 'S3'), 'Bucket'))).toBe(true);
    expect(keys.has(groupKey(groupKey(groupKey('', 'S3'), 'Bucket'), 'Constructs'))).toBe(true);
    // The unrelated SQS branch stays closed.
    expect(keys.has(groupKey('', 'SQS'))).toBe(false);
  });

  test('returns an empty set when no leaf matches', () => {
    const keys = activeAncestorKeys(tree, 'api/modules/ts/aws-cdk-lib/aws-lambda/Function');
    expect(keys.size).toBe(0);
  });
});

describe('groupKey', () => {
  test('composes a stable, unambiguous key from ancestor texts', () => {
    const s3 = groupKey('', 'S3');
    const s3Bucket = groupKey(s3, 'Bucket');
    expect(s3).not.toBe(groupKey('', 'SQS'));
    expect(s3Bucket).not.toBe(groupKey(groupKey('', 'SQS'), 'Bucket'));
    expect(s3Bucket.startsWith(s3)).toBe(true);
  });
});

describe('filterSidebarTree', () => {
  const tree: ApiSidebarNode[] = [
    {
      text: 'S3',
      items: [
        {
          text: 'AccessPoint',
          items: [
            {
              text: 'Constructs',
              items: [
                { text: 'CfnAccessPoint', link: '/api/modules/ts/aws-cdk-lib/aws-s3/CfnAccessPoint' },
              ],
            },
          ],
        },
        {
          text: 'Bucket',
          items: [
            {
              text: 'Constructs',
              items: [
                { text: 'Bucket', link: '/api/modules/ts/aws-cdk-lib/aws-s3/Bucket' },
                { text: 'CfnBucket', link: '/api/modules/ts/aws-cdk-lib/aws-s3/CfnBucket' },
              ],
            },
            {
              text: 'Interfaces',
              items: [{ text: 'IBucket', link: '/api/modules/ts/aws-cdk-lib/aws-s3/IBucket' }],
            },
            {
              text: 'Others',
              items: [{ text: 'BucketProps', link: '/api/modules/ts/aws-cdk-lib/aws-s3/BucketProps' }],
            },
          ],
        },
      ],
    },
    {
      text: 'SQS',
      items: [
        {
          text: 'Queue',
          items: [{ text: 'Queue', link: '/api/modules/ts/aws-cdk-lib/aws-sqs/Queue' }],
        },
      ],
    },
    {
      text: 'SNS',
      items: [
        {
          text: 'Topic',
          items: [{ text: 'Topic', link: '/api/modules/ts/aws-cdk-lib/aws-sns/Topic' }],
        },
      ],
    },
  ];
  const matcher = (text: string, term: string) => termRank(text, term) !== undefined;
  const byQuery = (query: string) => filterSidebarTree(tree, splitTerms(query), matcher);

  test('keeps matching leaves and their ancestor groups, drops the rest', () => {
    const result = byQuery('queue');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('SQS');
    expect(result[0].items![0].text).toBe('Queue');
  });

  test('a matching group keeps its entire subtree', () => {
    const result = byQuery('s3');
    expect(result).toHaveLength(1);
    // Full subtree survives, including the non-matching Interfaces group.
    expect(result[0]).toEqual(tree[0]);
  });

  test('prunes non-matching siblings inside a surviving group', () => {
    const result = byQuery('ibucket');
    expect(result).toHaveLength(1);
    const bucket = result[0].items![0];
    expect(bucket.text).toBe('Bucket');
    expect(bucket.items!.map((n) => n.text)).toEqual(['Interfaces']);
    expect(bucket.items![0].items![0].text).toBe('IBucket');
  });

  test('matching is consistent with termRank (case-insensitive, word boundaries)', () => {
    const names = byQuery('BUCKET')
      .flatMap((s) => s.items!)
      .map((n) => n.text);
    expect(names).toEqual(['Bucket']);
  });

  test('returns an empty array when nothing matches', () => {
    expect(byQuery('lambda')).toEqual([]);
  });

  test('never mutates the input tree', () => {
    const snapshot = JSON.stringify(tree);
    byQuery('ibucket');
    byQuery('s3 bucket');
    expect(JSON.stringify(tree)).toBe(snapshot);
  });

  test('multiple terms AND across the ancestor path', () => {
    // "s3 bucket": the S3 heading satisfies "s3", the Bucket resource
    // satisfies "bucket" — its subtree (Bucket, CfnBucket, BucketProps)
    // is kept. CfnAccessPoint (S3, no "bucket" on its path) and the
    // SNS/SQS branches are dropped.
    const result = byQuery('s3 bucket');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('S3');
    expect(result[0].items!.map((n) => n.text)).toEqual(['Bucket']);
    const leaves = result[0].items![0].items!.flatMap((k) => k.items!).map((n) => n.text);
    expect(leaves).toEqual(['Bucket', 'CfnBucket', 'IBucket', 'BucketProps']);
  });

  test('term order does not change the result set', () => {
    expect(byQuery('bucket s3')).toEqual(byQuery('s3 bucket'));
  });

  test('a leaf can satisfy the last remaining term itself', () => {
    // "sqs queue": SQS heading satisfies "sqs", the leaf "Queue"
    // satisfies "queue"; SNS Topic never matches.
    const result = byQuery('sqs queue');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('SQS');
    expect(byQuery('sqs topic')).toEqual([]);
  });

  test('a single node can satisfy several terms at once', () => {
    const result = byQuery('buck et');
    expect(result).toHaveLength(1);
    expect(result[0].items!.map((n) => n.text)).toEqual(['Bucket']);
  });

  test('no terms keeps every node', () => {
    expect(filterSidebarTree(tree, [], matcher)).toEqual(tree);
  });

  test('a friendly section label matches as well as the module name behind it', () => {
    const framework: ApiSidebarNode[] = [
      {
        text: 'aws-cdk-lib.assertions',
        label: 'Testing',
        items: [{ text: 'Template', link: '/api/aws-cdk-lib/assertions/template' }],
      },
      { text: 'aws-cdk-lib.triggers', label: 'Triggers', items: [{ text: 'Trigger', link: '/t' }] },
    ];
    const find = (query: string) => filterSidebarTree(framework, splitTerms(query), matcher).map((n) => n.text);
    expect(find('testing')).toEqual(['aws-cdk-lib.assertions']);
    expect(find('assertions')).toEqual(['aws-cdk-lib.assertions']);
    expect(find('testing template')).toEqual(['aws-cdk-lib.assertions']);
  });
});

describe('sidebar width and name wrapping', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../docs/.vitepress/theme/api-sidebar.css'),
    'utf-8',
  );

  test('widens the sidebar over the VitePress 272px default, desktop only', () => {
    // The override must live inside a >=960px media query: below that the
    // sidebar is a fixed-width mobile drawer and must not be touched.
    const media = css.match(/@media \(min-width: 960px\) \{[^}]*\{[^}]*\}\s*\}/);
    expect(media).not.toBeNull();
    expect(media![0]).toContain('--vp-sidebar-width: 320px');
  });

  test('long entry names wrap instead of being clipped', () => {
    // Ellipsis and nowrap clipping would cut the name off instead.
    expect(css).not.toContain('text-overflow: ellipsis');
    expect(css).not.toContain('white-space: nowrap');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('white-space: normal');
  });
});

describe('sidebar indentation steps at every nesting level', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../docs/.vitepress/theme/api-sidebar.css'),
    'utf-8',
  );

  test('each level below a service adds one density-token indent', () => {
    expect(css).toContain('max(var(--api-sidebar-depth) - 1, 0) * var(--density-sidebar-indent)');
    expect(css).not.toContain('min(max(var(--api-sidebar-depth) - 1, 0), 1)');
  });
});

describe('sidebar visual refinements', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../docs/.vitepress/theme/api-sidebar.css'),
    'utf-8',
  );

  test('the active page is not bolded — accent treatment instead', () => {
    // Bold made the selected entry read as a header; the active state
    // must use color/background, never font-weight.
    //
    // The accent is brand-2 rather than brand-1: the soft background this sits
    // on composites to #dde8f7, where brand-1 measures only 4.02:1. The ratio
    // itself is pinned in test/a11y-gate.test.ts.
    const active = css.match(/\.api-sidebar-link\.active \{[^}]*\}/);
    expect(active).not.toBeNull();
    expect(active![0]).not.toContain('font-weight');
    expect(active![0]).toContain('var(--vp-c-brand-2)');
    expect(active![0]).toContain('var(--vp-c-brand-soft)');
  });

  test('section headers are styled as fixed structural landmarks', () => {
    expect(css).toContain('.api-sidebar-section-title');
    // Consecutive sections are visually set apart by a divider.
    const divider = css.match(/\.api-sidebar-section \+ \.api-sidebar-section \{[^}]*\}/);
    expect(divider).not.toBeNull();
    expect(divider![0]).toContain('var(--vp-c-divider)');
  });
});

/**
 * Construct level tags in the tree: a compact L1/L2/L3 tag
 * before a construct's name. The level is metadata on its own field, so
 * the assertions here are as much about what it must NOT touch —
 * identity, filter matching, jump-to-current — as about the rendering.
 */
describe('construct level tags', () => {
  const item = () =>
    readFileSync(resolve(import.meta.dirname, '../docs/.vitepress/theme/ApiSidebarItem.vue'), 'utf-8');
  const css = () =>
    readFileSync(resolve(import.meta.dirname, '../docs/.vitepress/theme/api-sidebar.css'), 'utf-8');

  const bucket: ApiSidebarNode = {
    text: 'Bucket',
    link: '/api/aws-cdk-lib/aws-s3/Bucket',
    level: 'L2',
  };

  test('the tag renders before the name, only when a level is present', () => {
    const source = item();
    const tag = source.indexOf('api-sidebar-level');
    const name = source.indexOf('api-sidebar-name');
    expect(tag).toBeGreaterThan(-1);
    // The tag's span opens before the name's span, inside the link.
    expect(name).toBeGreaterThan(tag);
    expect(source).toContain('v-if="node.level"');
  });

  test('the tag is hidden from assistive tech and the level is spelled out instead', () => {
    const source = item();
    // Reading "L2" in front of every construct name is noise; the level
    // belongs in the accessible name, expanded to "(L2 construct)".
    expect(source).toMatch(/api-sidebar-level"\s+aria-hidden="true"/);
    expect(source).toContain(':aria-label="accessibleName"');
  });

  test('the accessible name ENDS with the level so label-in-name survives', () => {
    // Voice control matches the visible label against the accessible
    // name; a leading "L2 construct Bucket" would break "click Bucket".
    expect(item()).toContain('${base} (${level} construct)');
  });

  test('the level is carried as a glyph, not by color alone, and not as link text', () => {
    // The stylesheet draws the level string from `data-level`; the span itself
    // holds no text, so the link's visible text is the name the accessible
    // name starts with (label in name).
    expect(item()).toContain(':data-level="node.level"');
    expect(item()).not.toMatch(/data-level="node\.level">\s*\{\{/);
    expect(css()).toMatch(/\.api-sidebar-level::before \{[^}]*content: attr\(data-level\)/);
  });

  test('kind-group de-emphasis keys on the group marker, never on tree depth', () => {
    // Depth is only a PROXY for "is a kind group", valid while every section
    // nests exactly four levels. Sections with at most one resource drop their
    // resource wrapper, so a depth-keyed rule renders the same `Others`
    // heading two different ways depending on how many resources its section
    // happens to have.
    const rules = css();
    expect(rules).toContain('.api-sidebar-item[data-kind-group] > .api-sidebar-group');
    expect(rules).not.toContain('[data-depth="3"]');
    // No depth-keyed selector may style a group again, at any depth.
    expect(rules).not.toMatch(/\[data-depth="\d+"\]\s*>\s*\.api-sidebar-group/);
  });

  test('the tag never shrinks or wraps away from the name it prefixes', () => {
    const rules = css();
    const start = rules.indexOf('.api-sidebar-level {');
    expect(start).toBeGreaterThan(-1);
    const block = rules.slice(start, rules.indexOf('}', start));
    expect(block).toContain('flex-shrink: 0');
  });

  test('every level tag is the same width, from the box and not the font', () => {
    // Equal widths must not depend on the font applying
    // tabular figures to the digits, so the box carries a fixed minimum
    // width and centers its content. `tabular-nums` stays as a second line
    // of defense and is asserted so it is not dropped as redundant.
    const rules = css();
    const start = rules.indexOf('.api-sidebar-level {');
    const block = rules.slice(start, rules.indexOf('}', start));
    expect(block).toMatch(/min-width:\s*22px/);
    expect(block).toContain('justify-content: center');
    expect(block).toContain('font-variant-numeric: tabular-nums');
  });

  test('the tag is subordinate to the name, never larger', () => {
    const rules = css();
    const start = rules.indexOf('.api-sidebar-level {');
    const block = rules.slice(start, rules.indexOf('}', start));
    const size = /font-size:\s*(\d+)px/.exec(block);
    expect(size).not.toBeNull();
    // Entries render at 14px (.api-sidebar-link); the tag must be smaller.
    expect(Number(size![1])).toBeLessThan(14);
  });

  test('a level does not change the node key, the link or filter matching', () => {
    const plain: ApiSidebarNode = { text: 'Bucket', link: '/api/aws-cdk-lib/aws-s3/Bucket' };
    expect(groupKey('svc', bucket.text)).toBe(groupKey('svc', plain.text));
    expect(isActiveLink(bucket.link, normalizePath('/api/aws-cdk-lib/aws-s3/Bucket.html'))).toBe(
      true,
    );
    // The tree filter sees only `text`, so "l2" must not match a level.
    const tree: ApiSidebarNode[] = [{ text: 'S3', items: [bucket] }];
    const matches = (query: string) =>
      filterSidebarTree(tree, splitTerms(query), (text, term) => termRank(text, term) !== undefined);
    expect(matches('bucket')).toHaveLength(1);
    expect(matches('l2')).toHaveLength(0);
  });
});

// The sidebar header block (symbol filter, jump-to-current,
// favorites) is sticky within the sidebar's own scroller, so it stays
// reachable from anywhere in a long expanded tree. The e2e spec measures the
// rendered behavior; this pins the two halves that make it possible, so a
// later edit cannot quietly remove one and leave the other looking intact.
describe('sticky sidebar header', () => {
  const THEME_DIR = resolve(import.meta.dirname, '../docs/.vitepress/theme');
  const entry = readFileSync(resolve(THEME_DIR, 'index.ts'), 'utf-8');
  const css = readFileSync(resolve(THEME_DIR, 'api-sidebar.css'), 'utf-8')
    // Strip comments first: the prose below quotes the declarations verbatim,
    // so matching the raw text would read a sentence about a rule as the rule.
    .replace(/\/\*[\s\S]*?\*\//g, '');

  test('the two header components share one wrapper element', () => {
    // Without the wrapper each component would have to stick on its own and
    // they would overlap, so the wrapper is load-bearing rather than tidiness.
    // Assert against the wrapper's CAPTURED CHILDREN, not the slot body: a
    // substring test on the body passes even with a component moved OUT of
    // the wrapper, which is the one case this pin exists to catch.
    const slot = /"sidebar-nav-before":\s*\(\)\s*=>\s*([\s\S]*?)\n      "doc-before"/.exec(entry);
    expect(slot).not.toBeNull();
    const body = slot![1];

    const wrapper = /h\(\s*"div",\s*\{\s*class:\s*"sidebar-header"\s*\},\s*\[([\s\S]*?)\]\s*\)/.exec(
      body,
    );
    expect(wrapper).not.toBeNull();
    const children = wrapper![1];
    // Split at top level: a component nested in another's slot is inside this
    // text, so a substring test would count it as a child of the wrapper.
    const topLevel: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of children) {
      if ('({['.includes(ch)) depth += 1;
      if (')}]'.includes(ch)) depth -= 1;
      if (ch === ',' && depth === 0) {
        topLevel.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    topLevel.push(current);
    const mounted = topLevel
      .map((child) => /^\s*h\(\s*([A-Z]\w*)/.exec(child)?.[1])
      .filter((name): name is string => Boolean(name));
    expect(mounted).toEqual(['ExplorerViewsButton', 'NavFilter', 'FavoritesList']);
    // Nothing but the fixed-position view rail is mounted alongside the wrapper: with the wrapper's own
    // text and the rail removed, no component mount may remain anywhere in the slot body.
    expect(body.replace(wrapper![0], '').replace(/h\(\s*ExplorerRail\s*\)/, '')).not.toMatch(/h\(\s*[A-Z]/);
  });

  test('the wrapper is pinned with an opaque sidebar background', () => {
    const block = /\.VPSidebar \.sidebar-header \{([^}]*)\}/.exec(css);
    expect(block).not.toBeNull();
    const declarations = block![1]
      .split(';')
      .map((d) => d.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    expect(declarations).toContain('position: sticky');
    // `top: 0` is measured, not derived — see the comment on the rule itself.
    expect(declarations).toContain('top: 0');
    expect(declarations).toContain('background-color: var(--vp-sidebar-bg-color)');
    // Above the pinned group headings (1); the layer plan is pinned in
    // test/sidebar-sticky.test.ts.
    expect(declarations).toContain('z-index: 2');
  });
});

// The Explorer's Services view: one A to Z list of services derived from the generated tree, each open service
// listing Overview, Modules, Constructs and Types (docs/adr/2026-11-28-explorer-services-view.md).
describe('Services view', () => {
  const D = '/v2/docs/';
  const type = (text: string, id: string, kind: string, level?: 'L1' | 'L2' | 'L3', label?: string): ApiSidebarNode => ({
    text,
    ...(label ? { label } : {}),
    link: `${D}${id}`,
    module: id.slice(0, id.lastIndexOf('.')),
    kind: kind as ApiSidebarNode['kind'],
    ...(level ? { level } : {}),
  });
  const readme = (text: string, id: string): ApiSidebarNode => ({ text, link: `${D}${id}-readme` });
  const kindGroup = (text: string, items: ApiSidebarNode[]): ApiSidebarNode => ({ text, collapsed: true, kindGroup: true, items });
  // S3 in the shape of its generated chunk: four overview pages, then resource groups (a leaf per construct, the
  // L2 before its L1, kind groups after), then the `General` group holding only kind groups.
  const s3Items: ApiSidebarNode[] = [
    readme('Overview', 'aws-cdk-lib.aws_s3'),
    readme('aws_s3_assets', 'aws-cdk-lib.aws_s3_assets'),
    readme('aws_s3_deployment', 'aws-cdk-lib.aws_s3_deployment'),
    readme('aws_s3_notifications', 'aws-cdk-lib.aws_s3_notifications'),
    {
      text: 'Asset',
      collapsed: true,
      items: [
        type('Asset', 'aws-cdk-lib.aws_s3_assets.Asset', 'construct'),
        kindGroup('Others', [type('AssetProps', 'aws-cdk-lib.aws_s3_assets.AssetProps', 'struct')]),
      ],
    },
    {
      text: 'Bucket',
      collapsed: true,
      items: [
        type('Bucket', 'aws-cdk-lib.aws_s3.Bucket', 'construct', 'L2'),
        type('CfnBucket', 'aws-cdk-lib.aws_s3.CfnBucket', 'cfn-resource', 'L1'),
        kindGroup('Mixins', [type('BucketMixin', 'aws-cdk-lib.aws_s3.mixins.BucketMixin', 'mixin')]),
        kindGroup('Facades', [type('BucketFacade', 'aws-cdk-lib.aws_s3.BucketFacade', 'class')]),
        kindGroup('Others', [
          type('CfnBucket.PolicyProperty', 'aws-cdk-lib.aws_s3.CfnBucket.PolicyProperty', 'cfn-property', undefined, 'PolicyProperty'),
          type('BucketProps', 'aws-cdk-lib.aws_s3.BucketProps', 'struct'),
        ]),
      ],
    },
    {
      text: 'BucketDeployment',
      collapsed: true,
      items: [type('BucketDeployment', 'aws-cdk-lib.aws_s3_deployment.BucketDeployment', 'construct')],
    },
    {
      text: 'General',
      collapsed: true,
      items: [
        kindGroup('Events', [type('BucketEvents', 'aws-cdk-lib.aws_s3.events.BucketEvents', 'class')]),
        kindGroup('Others', [type('IBucketRef', 'aws-cdk-lib.interfaces.aws_s3.IBucketRef', 'interface')]),
      ],
    },
  ];
  // A service with one resource: its constructs and kind groups sit at the top level.
  const polly: ApiSidebarNode[] = [
    readme('Overview', 'aws-cdk-lib.aws_polly'),
    type('CfnLexicon', 'aws-cdk-lib.aws_polly.CfnLexicon', 'cfn-resource', 'L1'),
    kindGroup('Mixins', [type('CfnLexiconMixin', 'aws-cdk-lib.aws_polly.mixins.CfnLexiconMixin', 'mixin')]),
    kindGroup('Others', [type('CfnLexiconProps', 'aws-cdk-lib.aws_polly.CfnLexiconProps', 'struct')]),
  ];
  // An alpha-only service: its only overview is the scoped package's, labeled Developer Preview in today's tree.
  const amplify: ApiSidebarNode[] = [
    readme('Developer Preview', '@aws-cdk_aws-amplify-alpha'),
    type('App', '@aws-cdk_aws-amplify-alpha.App', 'construct', 'L2'),
  ];
  const service = (text: string, chunk: string, modules: string[], items?: ApiSidebarNode[], count?: number): ApiSidebarNode => ({
    text,
    collapsed: true,
    modules,
    chunk,
    ...(count !== undefined ? { count } : {}),
    ...(items ? { items } : {}),
  });
  const skeleton: ApiSidebarNode[] = [
    {
      text: 'Framework',
      section: true,
      collapsed: false,
      items: [{ text: 'constructs', collapsed: true, modules: ['constructs'], chunk: 'constructs' }],
    },
    {
      text: 'Services',
      section: true,
      collapsed: false,
      items: [
        service('Amplify', 'amplify', ['@aws-cdk_aws-amplify-alpha'], amplify, 1),
        service('EKS (legacy)', 'eks_legacy', ['aws-cdk-lib.aws_eks', 'aws-cdk-lib.interfaces.aws_eks'], undefined, 25),
        service('EKS V2', 'eks_v2', ['aws-cdk-lib.aws_eks_v2'], undefined, 24),
        service('Polly', 'polly', ['aws-cdk-lib.aws_polly'], polly, 1),
        service('S3', 's3', ['aws-cdk-lib.aws_s3', 'aws-cdk-lib.aws_s3_assets', 'aws-cdk-lib.aws_s3_deployment', 'aws-cdk-lib.aws_s3_notifications', 'aws-cdk-lib.interfaces.aws_s3'], s3Items, 4),
        service('eBay-like lowercase', 'ebay', ['aws-cdk-lib.aws_ebay'], undefined, 0),
      ],
    },
  ];

  test('the construct rows follow one rule in docgen and the client: S3 lists four, the skeleton says four', () => {
    const rows = serviceRows(s3Items);
    expect(rows.constructs.map((r) => r.text)).toEqual(['Asset', 'Bucket', 'CfnBucket', 'BucketDeployment']);
    expect(rows.overviews.map((r) => r.text)).toEqual(['Overview', 'aws_s3_assets', 'aws_s3_deployment', 'aws_s3_notifications']);
    expect([...rows.kinds.keys()]).toEqual(['Others', 'Mixins', 'Facades', 'Events']);
    expect(rows.kinds.get('Others')!.map((r) => r.text)).toEqual(['AssetProps', 'CfnBucket.PolicyProperty', 'BucketProps', 'IBucketRef']);
    expect(constructCount(s3Items)).toBe(serviceNodes(skeleton).find((s) => s.text === 'S3')!.count);
    // A single-resource service keeps its constructs at the top level; they still count, its overview does not.
    expect(serviceRows(polly).constructs.map((r) => r.text)).toEqual(['CfnLexicon']);
  });

  test('the list is the Services section A to Z, case-insensitive, with EKS as two plain rows', () => {
    expect(servicesViewTree(skeleton).map((s) => s.text)).toEqual(['Amplify', 'eBay-like lowercase', 'EKS (legacy)', 'EKS V2', 'Polly', 'S3']);
    expect(servicesViewTree([])).toEqual([]);
    expect(servicesViewTree([skeleton[0]])).toEqual([]);
  });

  test('an unloaded service keeps its skeleton node, so the chunk is fetched on open and the count shows closed', () => {
    const eks = servicesViewTree(skeleton).find((s) => s.text === 'EKS (legacy)')!;
    expect(eks).toBe(serviceNodes(skeleton).find((s) => s.text === 'EKS (legacy)'));
    expect(isUnloadedChunk(eks)).toBe(true);
    expect(eks.count).toBe(25);
    expect(unloadedChunkForKey(servicesViewTree(skeleton), 'EKS (legacy)')).toBe('eks_legacy');
    expect(unloadedChunkForKey(servicesViewTree(skeleton), 'S3')).toBeUndefined();
  });

  test('an open service lists Overview, Modules, Constructs and Types in that order', () => {
    const items = serviceViewItems(s3Items);
    expect(items.map((n) => n.text)).toEqual(['Overview', 'Modules', 'Constructs', 'Types']);
    const [overview, modules, constructs, types] = items;
    // The main module is the aws-cdk-lib module with the shortest page id.
    expect(overview).toEqual({ text: 'Overview', link: `${D}aws-cdk-lib.aws_s3-readme` });
    expect(modules.part).toBe(true);
    expect(modules.count).toBeUndefined();
    // Module rows are named by module id, in mono, and count the type rows of their module.
    expect(modules.items!.map((m) => [m.text, m.moduleRow, m.count])).toEqual([
      ['aws_s3_assets', true, 2],
      ['aws_s3_deployment', true, 1],
      ['aws_s3_notifications', true, 0],
    ]);
    expect(modules.items![0].link).toBe(`${D}aws-cdk-lib.aws_s3_assets-readme`);
    // Constructs: flat, resource by resource, the L2 before its L1, with their level tags; the count is the rows.
    expect(constructs.part).toBe(true);
    expect(constructs.count).toBe(4);
    expect(constructs.items!.map((c) => [c.text, c.level])).toEqual([
      ['Asset', undefined],
      ['Bucket', 'L2'],
      ['CfnBucket', 'L1'],
      ['BucketDeployment', undefined],
    ]);
    // Types: kind groups merged across resources, in the fixed order, each closed, rows A to Z by display label.
    expect(types.part).toBe(true);
    expect(types.count).toBe(7);
    expect(types.items!.map((k) => [k.text, k.kindGroup, k.collapsed, k.count])).toEqual([
      ['Mixins', true, true, 1],
      ['Facades', true, true, 1],
      ['Events', true, true, 1],
      ['Others', true, true, 4],
    ]);
    expect(types.items![3].items!.map((r) => r.label ?? r.text)).toEqual(['AssetProps', 'BucketProps', 'IBucketRef', 'PolicyProperty']);
    // The nested type keeps its owner-qualified text as identity and its short label for display.
    expect(types.items![3].items![3]).toMatchObject({ text: 'CfnBucket.PolicyProperty', label: 'PolicyProperty' });
  });

  test('parts a service lacks are left out; a lone scoped overview is the Overview', () => {
    expect(serviceViewItems(polly).map((n) => n.text)).toEqual(['Overview', 'Constructs', 'Types']);
    expect(serviceViewItems(amplify).map((n) => n.text)).toEqual(['Overview', 'Constructs']);
    expect(serviceViewItems(amplify)[0].link).toBe(`${D}@aws-cdk_aws-amplify-alpha-readme`);
    expect(serviceViewItems([type('Lone', 'aws-cdk-lib.aws_x.Lone', 'construct')]).map((n) => n.text)).toEqual(['Constructs']);
    expect(moduleRowText('@aws-cdk_aws-amplify-alpha')).toBe('@aws-cdk/aws-amplify-alpha');
    expect(moduleRowText('aws-cdk-lib.aws_s3_assets')).toBe('aws_s3_assets');
  });

  test('while filtering the rows come back flat, so the filter keeps matching rows and the count is the matches', () => {
    const flat = serviceViewItems(s3Items, true);
    expect(flat.every((n) => !n.part && !n.kindGroup)).toBe(true);
    expect(flat.map((n) => n.text)).toEqual([
      'Overview', 'aws_s3_assets', 'aws_s3_deployment', 'aws_s3_notifications',
      'Asset', 'Bucket', 'CfnBucket', 'BucketDeployment',
      'BucketMixin', 'BucketFacade', 'BucketEvents', 'AssetProps', 'BucketProps', 'IBucketRef', 'CfnBucket.PolicyProperty',
    ]);
    const matches = (text: string, term: string) => termRank(text, term) !== undefined;
    const filtered = filterSidebarTree(servicesViewTree(skeleton, true), ['bucket'], matches);
    // S3 stays with its matching rows only; a service whose name matches keeps every row; the rest leave.
    expect(filtered.map((s) => s.text)).toEqual(['S3']);
    expect(filtered[0].items!.map((n) => n.text)).toEqual([
      'Bucket', 'CfnBucket', 'BucketDeployment', 'BucketMixin', 'BucketFacade', 'BucketEvents', 'BucketProps', 'IBucketRef', 'CfnBucket.PolicyProperty',
    ]);
    const byName = filterSidebarTree(servicesViewTree(skeleton, true), ['polly'], matches);
    expect(byName[0].items!.length).toBe(serviceViewItems(polly, true).length);
  });

  test('serviceForPath names the service owning a page, and none for a framework page', () => {
    const DOCS = 'v2/docs/';
    expect(serviceForPath(skeleton, 'v2/docs/aws-cdk-lib.aws_s3.Bucket', DOCS)?.text).toBe('S3');
    expect(serviceForPath(skeleton, 'v2/docs/aws-cdk-lib.aws_s3_deployment-readme', DOCS)?.text).toBe('S3');
    expect(serviceForPath(skeleton, 'v2/docs/aws-cdk-lib.interfaces.aws_eks.IClusterRef', DOCS)?.text).toBe('EKS (legacy)');
    expect(serviceForPath(skeleton, 'v2/docs/aws-cdk-lib.aws_eks_v2.Cluster', DOCS)?.text).toBe('EKS V2');
    expect(serviceForPath(skeleton, 'v2/docs/constructs.Construct', DOCS)).toBeUndefined();
    expect(serviceForPath(skeleton, 'v2/docs/aws-cdk-lib.Stack', DOCS)).toBeUndefined();
    expect(serviceForPath(skeleton, 'v2/', DOCS)).toBeUndefined();
  });

  test('the active page opens its service and, inside Types, its kind group', () => {
    const tree = servicesViewTree(skeleton);
    expect(activeAncestorKeys(tree, 'v2/docs/aws-cdk-lib.aws_s3.Bucket')).toEqual(new Set(['S3', groupKey('S3', 'Constructs')]));
    expect(activeAncestorKeys(tree, 'v2/docs/aws-cdk-lib.aws_s3.BucketProps')).toEqual(
      new Set(['S3', groupKey('S3', 'Types'), groupKey(groupKey('S3', 'Types'), 'Others')]),
    );
  });
});
