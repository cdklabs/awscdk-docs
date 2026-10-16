import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { hashedAssetPath } from './hashed-assets.js';
import { generateDocs } from '../src/docgen/index.js';
import { SidebarEntry } from '../src/docgen/sidebar.js';
import { buildSymbolIndex } from '../src/docgen/symbols.js';

const ROOT = resolve(import.meta.dirname, '..');

function entry(overrides: Partial<SidebarEntry>): SidebarEntry {
  return {
    name: 'Thing',
    kind: 'Class',
    assemblyName: 'aws-cdk-lib',
    submodule: 'aws_s3',
    indexLink: '/api/modules/aws-cdk-lib/aws-s3',
    ...overrides,
  };
}

describe('buildSymbolIndex', () => {
  test('uses the dedicated page link when present', () => {
    const index = buildSymbolIndex([
      entry({ name: 'Bucket', kind: 'Construct (L2)', link: '/api/modules/aws-cdk-lib/aws-s3/bucket' }),
    ]);
    expect(index).toEqual([
      {
        name: 'Bucket',
        kind: 'Construct (L2)',
        link: '/api/modules/aws-cdk-lib/aws-s3/bucket',
        service: 'S3',
      },
    ]);
  });

  test('falls back to the type table link for types without pages', () => {
    const index = buildSymbolIndex([entry({ name: 'BucketEncryption', kind: 'Enum' })]);
    expect(index[0].link).toBe('/api/modules/aws-cdk-lib/aws-s3');
  });

  test('labels constructs-package types with the constructs section', () => {
    const index = buildSymbolIndex([
      entry({ name: 'Construct', assemblyName: 'constructs', submodule: '', indexLink: '/api/modules/constructs/' }),
    ]);
    expect(index[0].service).toBe('constructs');
  });

  test('labels aws-cdk-lib root types with the Core section', () => {
    const index = buildSymbolIndex([
      entry({ name: 'Stack', assemblyName: 'aws-cdk-lib', submodule: '', indexLink: '/api/modules/aws-cdk-lib/' }),
    ]);
    expect(index[0].service).toBe('Core');
  });

  test('carries the construct level through and omits it for unleveled types', () => {
    const index = buildSymbolIndex([
      entry({ name: 'Bucket', kind: 'Construct (L2)', level: 'L2' }),
      entry({ name: 'BucketEncryption', kind: 'Enum' }),
    ]);
    expect(index[0].level).toBe('L2');
    expect(index[1]).not.toHaveProperty('level');
  });

  test('sorts entries by name', () => {
    const index = buildSymbolIndex([
      entry({ name: 'Zebra' }),
      entry({ name: 'Alpha' }),
    ]);
    expect(index.map((e) => e.name)).toEqual(['Alpha', 'Zebra']);
  });

  test('marks types of an experimental assembly and omits the field for stable ones', () => {
    const index = buildSymbolIndex([
      entry({ name: 'Function', submodule: 'aws_lambda', indexLink: '/api/modules/aws-cdk-lib/aws-lambda' }),
      entry({
        name: 'Function',
        assemblyName: '@aws-cdk/aws-bedrock-alpha',
        submodule: '',
        indexLink: '/api/modules/aws-cdk-aws-bedrock-alpha/',
        experimental: true,
      }),
    ]);
    const alpha = index.find((e) => e.link.includes('bedrock'))!;
    const stable = index.find((e) => e.link.includes('aws-lambda'))!;
    expect(alpha.experimental).toBe(true);
    // Absent, not `false`: the flag is a presence marker so the ~22k-entry index does not grow for stable types.
    expect('experimental' in stable).toBe(false);
  });

  test('labels structural submodule types with the owning service', () => {
    const index = buildSymbolIndex([
      entry({ name: 'IBucketRef', kind: 'Interface', submodule: 'interfaces.aws_s3' }),
      entry({ name: 'BucketVersioning', kind: 'Mixin', submodule: 'aws_s3.mixins' }),
      entry({ name: 'IEnvironmentAware', kind: 'Interface', submodule: 'interfaces' }),
    ]);
    expect(index.map((e) => `${e.name}:${e.service}`)).toEqual([
      'BucketVersioning:S3',
      'IBucketRef:S3',
      'IEnvironmentAware:Core',
    ]);
  });
});

describe('symbol index generation', () => {
  let outDir: string;
  let publicDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'symbols-out-'));
    publicDir = mkdtempSync(join(tmpdir(), 'symbols-public-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(publicDir, { recursive: true, force: true });
  });

  test('writes the symbol index beside the sidebar assets when configured', () => {
    const written = generateDocs(
      { modules: ['constructs'] },
      { outDir, packageRoot: ROOT, publicDir },
    );

    const file = hashedAssetPath(join(publicDir, 'api-sidebar'), 'symbols');
    expect(written).toContain(file);
    const symbols = JSON.parse(readFileSync(file, 'utf-8'));
    expect(Array.isArray(symbols)).toBe(true);
    const construct = symbols.find((s: { name: string }) => s.name === 'Construct');
    expect(construct).toBeDefined();
    expect(construct.link).toMatch(/^\/v2\/docs\/constructs\./);
    expect(construct.service).toBe('constructs');
  });

  test('flags symbols of an experimental assembly from its jsii stability and omits the key for stable ones', () => {
    generateDocs(
      { modules: ['constructs', '@aws-cdk/aws-codestar-alpha'] },
      { outDir, packageRoot: ROOT, publicDir },
    );

    const symbols: Record<string, unknown>[] = JSON.parse(readFileSync(hashedAssetPath(join(publicDir, 'api-sidebar'), 'symbols'), 'utf-8'));
    const alpha = symbols.filter((s) => (s.link as string).includes('aws-codestar-alpha'));
    expect(alpha.length).toBeGreaterThan(0);
    expect(alpha.every((s) => s.experimental === true)).toBe(true);
    const construct = symbols.find((s) => s.name === 'Construct')!;
    expect('experimental' in construct).toBe(false);
  });

  test('skips the symbol index when no public dir is configured', () => {
    const written = generateDocs({ modules: ['constructs'] }, { outDir, packageRoot: ROOT });
    expect(written.some((f) => /symbols\.[0-9a-f]{8}\.js$/.test(f))).toBe(false);
    expect(existsSync(join(publicDir, 'api-sidebar'))).toBe(false);
  });
});
