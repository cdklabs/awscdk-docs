import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import { hashedAssetPath } from './hashed-assets.js';
import { displayLabel, type ApiSidebarNode } from '../docs/.vitepress/theme/api-sidebar.js';
import { generateDocs } from '../src/docgen/index.js';
import { sidebarModuleLabels } from '../src/docgen/languages.js';
import { buildServiceSidebar, SidebarEntry, SidebarItem } from '../src/docgen/sidebar.js';

const ROOT = resolve(import.meta.dirname, '..');

// Language-aware nav/sidebar labels (Model B): the generated
// sidebar tree carries per-language DISPLAY labels while links, anchors
// and node identity stay canonical. Single-language builds emit no
// labels at all, so the live ts-only asset is byte-identical.

function entry(over: Partial<SidebarEntry> & Pick<SidebarEntry, 'name' | 'kind'>): SidebarEntry {
  return {
    link: undefined,
    assemblyName: 'aws-cdk-lib',
    submodule: 'aws_sqs',
    indexLink: '/v2/docs/aws-cdk-lib.aws_sqs-readme',
    ...over,
  };
}

function walk(items: readonly SidebarItem[], visit: (item: SidebarItem) => void): void {
  for (const item of items) {
    visit(item);
    if (item.items) {
      walk(item.items, visit);
    }
  }
}

describe('buildServiceSidebar language labels', () => {
  const queue = entry({
    name: 'Queue',
    kind: 'Construct (L2)',
    link: '/v2/docs/aws-cdk-lib.aws_sqs.Queue',
    moduleLabels: { ts: 'aws-cdk-lib/aws_sqs', python: 'aws_cdk.aws_sqs' },
  });

  test('single-language build emits no labels field anywhere', () => {
    const entries = [
      queue,
      entry({ name: 'SomeStruct', kind: 'Struct' }),
    ];
    const single = buildServiceSidebar(entries, ['ts']);
    expect(JSON.stringify(single)).not.toContain('"labels"');
    // …and is identical to the no-languages call.
    expect(single).toEqual(buildServiceSidebar(entries));
  });

  test('type leaves stay canonical in every language (jsii preserves type names)', () => {
    const sidebar = buildServiceSidebar([queue], ['ts', 'python', 'java', 'dotnet', 'go']);
    const leaves: SidebarItem[] = [];
    walk(sidebar, (item) => {
      if (item.link) {
        leaves.push(item);
      }
    });
    // The section's Overview nav entry plus the one type leaf.
    expect(leaves.map((l) => l.text)).toEqual(['Overview', 'Queue']);
    const typeLeaf = leaves[1];
    expect(typeLeaf.link).toBe('/v2/docs/aws-cdk-lib.aws_sqs.Queue');
    expect(typeLeaf.labels).toBeUndefined();
  });

  test('type-index items carry per-language module labels; links stay canonical', () => {
    // Two unlinked entries whose submodules share the S3 section, so the
    // disambiguated "Type index (<module>)" form is used for both.
    const sidebar = buildServiceSidebar([
      entry({
        name: 'BucketAttrs',
        kind: 'Struct',
        submodule: 'aws_s3',
        indexLink: '/v2/docs/aws-cdk-lib.aws_s3-readme',
        moduleLabels: { ts: 'aws-cdk-lib/aws_s3', python: 'aws_cdk.aws_s3' },
      }),
      entry({
        name: 'DeploymentAttrs',
        kind: 'Struct',
        submodule: 'aws_s3_deployment',
        indexLink: '/v2/docs/aws-cdk-lib.aws_s3_deployment-readme',
        moduleLabels: { ts: 'aws-cdk-lib/aws_s3_deployment', python: 'aws_cdk.aws_s3_deployment' },
      }),
    ], ['ts', 'python']);

    const indexItems: SidebarItem[] = [];
    walk(sidebar, (item) => {
      if (item.text.startsWith('Type index')) {
        indexItems.push(item);
      }
    });
    expect(indexItems.map((i) => i.text).sort()).toEqual([
      'Type index (aws_s3)',
      'Type index (aws_s3_deployment)',
    ]);
    const s3Index = indexItems.find((i) => i.text === 'Type index (aws_s3)')!;
    expect(s3Index.labels).toEqual({
      ts: 'Type index (aws-cdk-lib/aws_s3)',
      python: 'Type index (aws_cdk.aws_s3)',
    });
    // The link target never varies with language.
    expect(s3Index.link).toBe('/v2/docs/aws-cdk-lib.aws_s3-readme');
  });

  test('a lone type index has no module in its label, so no variants', () => {
    const sidebar = buildServiceSidebar([
      entry({ name: 'QueueAttrs', kind: 'Struct', moduleLabels: { python: 'aws_cdk.aws_sqs' } }),
    ], ['ts', 'python']);
    const items: SidebarItem[] = [];
    walk(sidebar, (item) => {
      if (item.text.startsWith('Type index')) {
        items.push(item);
      }
    });
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Type index');
    expect(items[0].labels).toBeUndefined();
  });

  test('a variant equal to the canonical label is omitted', () => {
    const sidebar = buildServiceSidebar([
      entry({
        name: 'BucketAttrs',
        kind: 'Struct',
        submodule: 'aws_s3',
        indexLink: '/v2/docs/aws-cdk-lib.aws_s3-readme',
        // Python's name for the module happens to match the canonical label.
        moduleLabels: { python: 'aws_s3' },
      }),
      entry({
        name: 'DeploymentAttrs',
        kind: 'Struct',
        submodule: 'aws_s3_deployment',
        indexLink: '/v2/docs/aws-cdk-lib.aws_s3_deployment-readme',
        moduleLabels: { python: 'aws_s3_deployment' },
      }),
    ], ['ts', 'python']);
    walk(sidebar, (item) => {
      expect(item.labels).toBeUndefined();
    });
  });
});

describe('sidebarModuleLabels', () => {
  const assembly = {
    name: 'aws-cdk-lib',
    targets: {
      python: { module: 'aws_cdk', distName: 'aws-cdk-lib' },
      java: { package: 'software.amazon.awscdk' },
      dotnet: { namespace: 'Amazon.CDK', packageId: 'Amazon.CDK.Lib' },
      go: { moduleName: 'github.com/aws/aws-cdk-go/awscdk/v2', packageName: 'awscdk' },
    },
    submodules: {
      'aws-cdk-lib.aws_sqs': {},
    },
  } as unknown as spec.Assembly;

  test('resolves the language module names for a submodule', () => {
    expect(sidebarModuleLabels(assembly, 'aws_sqs', ['ts', 'python', 'dotnet'])).toEqual({
      ts: 'aws-cdk-lib/aws_sqs',
      python: 'aws_cdk.aws_sqs',
      dotnet: 'Amazon.CDK.Aws.Sqs',
    });
  });

  test('resolves the module root', () => {
    expect(sidebarModuleLabels(assembly, '', ['ts', 'python'])).toEqual({
      ts: 'aws-cdk-lib',
      python: 'aws_cdk',
    });
  });

  test('a single enabled language yields no labels at all', () => {
    expect(sidebarModuleLabels(assembly, 'aws_sqs', ['ts'])).toBeUndefined();
    expect(sidebarModuleLabels(assembly, 'aws_sqs', [])).toBeUndefined();
  });
});

describe('displayLabel', () => {
  const node: ApiSidebarNode = {
    text: 'Type index (aws_sqs)',
    link: '/v2/docs/aws-cdk-lib.aws_sqs-readme',
    labels: { python: 'Type index (aws_cdk.aws_sqs)' },
  };

  test('returns the active language variant when present', () => {
    expect(displayLabel(node, 'python')).toBe('Type index (aws_cdk.aws_sqs)');
  });

  test('falls back to the canonical text', () => {
    expect(displayLabel(node, 'go')).toBe('Type index (aws_sqs)');
    expect(displayLabel({ text: 'Queue' }, 'python')).toBe('Queue');
  });

  test('prefers the short display label over the canonical text', () => {
    const nested: ApiSidebarNode = {
      text: 'CfnBucket.PolicyProperty',
      label: 'PolicyProperty',
      link: '/v2/docs/aws-cdk-lib.aws_s3.CfnBucket.PolicyProperty',
    };
    expect(displayLabel(nested, 'ts')).toBe('PolicyProperty');
    // A per-language variant still wins over the short label.
    expect(
      displayLabel({ ...nested, labels: { python: 'policy_property' } }, 'python'),
    ).toBe('policy_property');
  });
});

describe('generated api-sidebar asset (integration)', () => {
  let outDir: string;
  let publicDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'nav-labels-'));
    publicDir = join(outDir, 'public');
    generateDocs(
      { modules: ['constructs'] },
      { outDir: join(outDir, 'api'), packageRoot: ROOT, languages: ['ts', 'python'], publicDir },
    );
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the multi-language asset parses and keeps canonical leaf identity', () => {
    const raw = readFileSync(hashedAssetPath(join(publicDir, 'api-sidebar'), 'sidebar'), 'utf-8');
    const tree = JSON.parse(raw) as ApiSidebarNode[];
    expect(tree.length).toBeGreaterThan(0);
    // Type names are language-stable, so leaves carry no label variants
    // and their links are unchanged canonical URLs.
    const check = (nodes: ApiSidebarNode[]) => {
      for (const node of nodes) {
        if (node.link) {
          expect(node.labels).toBeUndefined();
          expect(node.link).toMatch(/^\/v2\/docs\//);
        }
        if (node.items) {
          check(node.items);
        }
      }
    };
    check(tree);
  });
});

describe('generated api-sidebar asset stays byte-free of labels on ts-only builds', () => {
  let outDir: string;
  let publicDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'nav-labels-ts-'));
    publicDir = join(outDir, 'public');
    generateDocs(
      { modules: ['constructs'] },
      { outDir: join(outDir, 'api'), packageRoot: ROOT, languages: ['ts'], publicDir },
    );
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('no labels field anywhere in the single-language asset', () => {
    const raw = readFileSync(hashedAssetPath(join(publicDir, 'api-sidebar'), 'sidebar'), 'utf-8');
    expect(raw).not.toContain('"labels"');
    expect(readFileSync(join(outDir, 'api', 'sidebar.json'), 'utf-8')).not.toContain('"labels"');
  });
});
