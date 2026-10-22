import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import { buildTypeIndex, TypeIndex } from '../src/docgen/constructs.js';
import { generateDocs, loadAssembly as loadCachedAssembly } from '../src/docgen/index.js';
import { buildUsageIndex, classMethods, classProperties, UsageIndex } from '../src/docgen/symbols.js';

const ROOT = resolve(import.meta.dirname, '..');

function loadAssembly(module: string): spec.Assembly {
  // Delegates to src/docgen's memoized loader so the ~1s aws-cdk-lib
  // parse is shared with generateDocs calls in the same worker.
  return loadCachedAssembly(join(ROOT, 'node_modules', module));
}

describe('usage index', () => {
  let index: TypeIndex;
  let usage: UsageIndex;

  beforeAll(() => {
    index = buildTypeIndex([loadAssembly('aws-cdk-lib'), loadAssembly('constructs')]);
    usage = buildUsageIndex(index);
  });

  test('structs know which classes take them as props', () => {
    expect(usage.propsUsers.get('aws-cdk-lib.aws_s3.BucketProps'))
      .toContain('aws-cdk-lib.aws_s3.Bucket');
  });

  test('enums know which properties reference them', () => {
    const refs = usage.enumRefs.get('aws-cdk-lib.aws_s3.BucketEncryption') ?? [];
    expect(refs).toContainEqual({
      ownerFqn: 'aws-cdk-lib.aws_s3.BucketProps',
      propertyName: 'encryption',
    });
  });

  test('class member collection walks the base-class chain', () => {
    const bucket = index.get('aws-cdk-lib.aws_s3.Bucket')!.type as spec.ClassType;
    const methods = classMethods(bucket, index).map((m) => m.name);
    expect(methods).toContain('grantRead'); // own
    expect(methods).toContain('applyRemovalPolicy'); // inherited from Resource
    const props = classProperties(bucket, index).map((p) => p.name);
    expect(props).toContain('bucketArn');
  });
});

describe('symbol page generation', () => {
  let outDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'symbol-pages-'));
    generateDocs({ modules: ['aws-cdk-lib', 'constructs'] }, { outDir, packageRoot: ROOT, languages: ['ts'] });
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a Facade class badges itself Facade, in its own color', () => {
    // `buildFacadeIndex` classifies Facades and the index table and sidebar
    // label them, so a renderer that emits no Facade badge leaves the page
    // badged a plain `Class` while every other surface disagrees. Same shape
    // as the Mixin pin in mixin-pages.test.ts.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_sqs.QueueGrants.md'), 'utf-8');
    expect(page).toContain('<Badge type="tip" class="api-badge api-badge-facade" text="Facade" />');
    expect(page).not.toContain('text="Class"');
  });

  test('plain classes get a dedicated page with hierarchy, methods, and properties', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.Duration.md'), 'utf-8');
    expect(page).toContain('# <span data-pagefind-weight="10">Duration</span> <Badge type="info" class="api-badge" text="Class" />');
    // Module-root type: breadcrumb links the module page only
    expect(page).toContain('<a href="/v2/docs/aws-cdk-lib-readme.html">aws-cdk-lib</a>.<wbr><strong>Duration</strong>');
    expect(page).toContain('## Methods');
    expect(page).toContain('<div class="member-row" id="toseconds">');
  });

  test('class pages have no Extends fact -- the inheritance chain conveys it', () => {
    // SecretValue extends Intrinsic: chain renders, inline fact does not.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.SecretValue.md'), 'utf-8');
    expect(page).not.toContain('**Extends:**');
    expect(page).toContain('<nav class="inheritance-chain"');
  });

  test('structs get a page with breadcrumb, expandable props, and props-users list', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
    expect(page).toContain('# <span data-pagefind-weight="10">BucketProps</span> <Badge type="info" class="api-badge api-badge-struct" text="Struct" />');
    // No metadata table: the breadcrumb carries Module/FQN and the H1 badge
    // carries the Kind.
    expect(page).toContain('<a href="/v2/docs/aws-cdk-lib-readme.html">aws-cdk-lib</a>.<wbr><a href="/v2/docs/aws-cdk-lib.aws_s3-readme.html">aws_s3</a>.<wbr><strong>BucketProps</strong>');
    expect(page).not.toContain('| **Kind** |');
    expect(page).toContain('<div class="props-table member-list" v-pre>');
    expect(page).not.toContain('<div class="props-table member-list" v-pre data-pagefind-ignore>');
    expect(page).toContain('<code class="member-name">versioned</code>');
    expect(page).toContain('<span class="chain-label">used as props by</span>');
    expect(page).toContain('<a class="chain-item" href="/v2/docs/aws-cdk-lib.aws_s3.Bucket.html">Bucket</a>');
  });

  test('struct property types cross-link to documented types', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
    expect(page).toContain('href="/v2/docs/aws-cdk-lib.aws_s3.BucketEncryption.html">BucketEncryption</a>');
  });

  test('enums get a page with a members table and referencing properties', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketEncryption.md'), 'utf-8');
    expect(page).toContain('# <span data-pagefind-weight="10">BucketEncryption</span> <Badge type="info" class="api-badge api-badge-enum" text="Enum" />');
    expect(page).toContain('| Member | Description |');
    expect(page).toContain('| <span id="kms"></span>`KMS` |');
    expect(page).toContain('## Referenced by');
    expect(page).toContain('- [`BucketProps`](/v2/docs/aws-cdk-lib.aws_s3.BucketProps).encryption');
  });

  test('constructs and mixins keep their dedicated templates', () => {
    const construct = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    expect(construct).toContain('construct" />');
    const mixin = readFileSync(join(outDir, 'docs', 'constructs.IMixin.md'), 'utf-8');
    expect(mixin).toContain('text="Mixin" />');
  });

  test('every type in a submodule table is linked to a dedicated page', () => {
    const table = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'), 'utf-8');
    expect(table).toContain('[`BucketProps`](/v2/docs/aws-cdk-lib.aws_s3.BucketProps) | Struct |');
    expect(table).toContain('[`BucketEncryption`](/v2/docs/aws-cdk-lib.aws_s3.BucketEncryption) | Enum |');
    expect(existsSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'))).toBe(true);
  });

  test('sidebar groups types by resource, then by kind, within each service section', () => {
    const sidebar = JSON.parse(readFileSync(join(outDir, 'sidebar.json'), 'utf-8'));
    // Sections sit inside the Framework/Services groupings.
    const sections = sidebar.flatMap((top: any) => top.items);
    const s3 = sections.find((s: any) => s.text === 'S3');
    expect(s3.collapsed).toBe(true);
    const bucket = s3.items.find((g: any) => g.text === 'Bucket');
    expect(bucket).toBeDefined();
    expect(bucket.collapsed).toBe(true);
    // Constructs sit flat inside the resource; remaining kind groups
    // start collapsed.
    expect(bucket.items).toContainEqual({
      text: 'Bucket',
      link: '/v2/docs/aws-cdk-lib.aws_s3.Bucket',
      // Construct leaves carry their level.
      level: 'L2',
    });
    const others = bucket.items.find((g: any) => g.text === 'Others');
    expect(others.collapsed).toBe(true);
    expect(others.items).toContainEqual({
      text: 'BucketEncryption',
      link: '/v2/docs/aws-cdk-lib.aws_s3.BucketEncryption',
    });
  });

  test('module-root types appear under the Core sidebar section', () => {
    const sidebar = JSON.parse(readFileSync(join(outDir, 'sidebar.json'), 'utf-8'));
    // Core leads the Framework grouping, headed by the bare package name.
    const framework = sidebar.find((s: any) => s.text === 'Framework');
    const core = framework.items.find((s: any) => s.text === 'aws-cdk-lib');
    expect(core).toBeDefined();
    const others = core.items.find((g: any) => g.text === 'Others');
    expect(others.items.map((i: any) => i.text)).toContain('Duration');
  });

  test('behavioral interfaces without implementors still get a page', () => {
    // ILocalBundling declares tryBundle() but no class in the assemblies implements it
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.ILocalBundling.md'), 'utf-8');
    expect(page).toContain('# <span data-pagefind-weight="10">ILocalBundling</span> <Badge type="info" class="api-badge api-badge-interface" text="Interface" />');
    expect(page).not.toContain('| **Kind** |');
    expect(page).toContain('<div class="member-row" id="trybundle">');
  });

  test.each([
    ['a struct', 'aws-cdk-lib.aws_s3.BucketProps.md'],
    ['an interface', 'aws-cdk-lib.aws_s3.IBucket.md'],
    ['an enum', 'aws-cdk-lib.aws_s3.BucketEncryption.md'],
    ['a plain class', 'aws-cdk-lib.Duration.md'],
  ])('%s page carries a metadata block whose only row is Source', (_kind, file) => {
    // These are four of the six call sites the block is emitted from, and the
    // H1 pins in this file are `toContain`, which say nothing about whether a
    // source chip is in the title row. Deleting any one of these renderer
    // lines has to fail something.
    const page = readFileSync(join(outDir, 'docs', file), 'utf-8');
    const block = /<dl class="type-metadata"[^>]*>([\s\S]*?)<\/dl>/.exec(page);
    expect(block).not.toBeNull();
    // Exactly one row, and it is Source: a non-construct has no CloudFormation
    // resource and is not its own L1.
    expect([...block![1].matchAll(/class="type-metadata-label">([^<]*)</g)].map((m) => m[1]))
      .toEqual(['Source']);
    expect(page).not.toContain('class="header-tag"');
  });

  test('the metadata block does not depend on the hierarchy emitters having rendered', () => {
    // The block is a separate emitter placed after the chain, so a page where
    // the chain emitted NOTHING is the case that would break if the two were
    // coupled. ILocalBundling has no parent interfaces and no implementors, so
    // neither the chain nor the extends bar renders on it.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.ILocalBundling.md'), 'utf-8');
    expect(page).not.toContain('<nav class="inheritance-chain"');
    expect(page).toContain('<dl class="type-metadata"');
    expect(page).toContain('<dt class="type-metadata-label">Source</dt>');
  });

  test('interface pages show linked parent interfaces in the hierarchy bar', () => {
    // IBucket extends IResource: the hierarchy bar links the parent page.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.IBucket.md'), 'utf-8');
    expect(page).toContain('<span class="chain-item chain-current">IBucket</span>');
    expect(page).toMatch(/<span class="chain-label">extends<\/span> .*<a class="chain-item" href="\/v2\/docs\/aws-cdk-lib\.IResource\.html">IResource<\/a>/);
    expect(page).not.toContain('**Extends:**');
    expect(page).not.toContain('| **Extends** |');
  });

  test('class pages list implemented interfaces in the hierarchy bar', () => {
    // Bucket implements IBucket, and the page must say so.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    expect(page).toMatch(/<span class="chain-label">implements<\/span> .*<a class="chain-item" href="\/v2\/docs\/aws-cdk-lib\.aws_s3\.IBucket\.html">IBucket<\/a>/);
    expect(page).not.toContain('**Implements:**');
  });
});
