import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import {
  buildTypeIndex,
  cfnResourceRef,
  constructLevel,
  isConstruct,
  normalizeCfnSee,
  renderConstructPage,
  typeMetadataRows,
  typeStability,
  sourceUrl,
  typeRefToString,
  TypeIndex,
} from '../src/docgen/constructs.js';
import { generateDocs, loadAssembly as loadCachedAssembly } from '../src/docgen/index.js';

const ROOT = resolve(import.meta.dirname, '..');

/** Base of the L1 subtree, for the rule-ordering fixtures below. */
const CFN_ELEMENT_FQN = 'aws-cdk-lib.CfnElement';

function loadAssembly(module: string): spec.Assembly {
  // Delegates to src/docgen's memoized loader so the ~1s aws-cdk-lib
  // parse is shared with generateDocs calls in the same worker.
  return loadCachedAssembly(join(ROOT, 'node_modules', module));
}

describe('construct detection and classification', () => {
  let cdk: spec.Assembly;
  let constructs: spec.Assembly;
  let index: TypeIndex;

  beforeAll(() => {
    cdk = loadAssembly('aws-cdk-lib');
    constructs = loadAssembly('constructs');
    index = buildTypeIndex([cdk, constructs]);
  });

  test('detects constructs via cross-assembly base-class chain', () => {
    expect(isConstruct('aws-cdk-lib.aws_s3.Bucket', index)).toBe(true);
    expect(isConstruct('constructs.Construct', index)).toBe(true);
    expect(isConstruct('aws-cdk-lib.aws_s3.BucketProps', index)).toBe(false);
    expect(isConstruct('aws-cdk-lib.Duration', index)).toBe(false);
  });

  test('classifies L1, L2, and L3 constructs', () => {
    const type = (fqn: string) => index.get(fqn)!.type as spec.ClassType;
    expect(constructLevel(type('aws-cdk-lib.aws_s3.CfnBucket'), index)).toBe('L1');
    expect(constructLevel(type('aws-cdk-lib.aws_s3.Bucket'), index)).toBe('L2');
    expect(constructLevel(
      type('aws-cdk-lib.aws_ecs_patterns.ApplicationLoadBalancedFargateService'), index,
    )).toBe('L3');
    // Framework classes get no level rather than a wrong one
    expect(constructLevel(type('constructs.Construct'), index)).toBeUndefined();
    // 'patterns' as substring must NOT match L3 (segment-aware regex)
    const fakeType: spec.ClassType = {
      kind: spec.TypeKind.Class,
      fqn: 'aws-cdk-lib.aws_design_patterns_utils.Helper',
      name: 'Helper',
      assembly: 'aws-cdk-lib',
      namespace: 'aws_design_patterns_utils',
      base: 'aws-cdk-lib.Resource',
    };
    expect(constructLevel(fakeType, index)).toBeUndefined(); // NOT L3
  });

  test('framework resource-shaped classes are L2 by explicit override', () => {
    const type = (fqn: string) => index.get(fqn)!.type as spec.ClassType;
    for (const name of ['Stage', 'App', 'Stack', 'NestedStack', 'Resource']) {
      expect(constructLevel(type(`aws-cdk-lib.${name}`), index)).toBe('L2');
    }
  });

  test('the override is exact-FQN, so subclasses of those five are not promoted', () => {
    const type = (fqn: string) => index.get(fqn)!.type as spec.ClassType;
    // Extends Stack, is not itself a curated resource abstraction, and
    // qualifies under no other rule — must stay unleveled.
    expect(constructLevel(type('aws-cdk-lib.aws_servicecatalog.ProductStack'), index)).toBeUndefined();
  });

  test('CfnElement and its descendants are L1', () => {
    const type = (fqn: string) => index.get(fqn)!.type as spec.ClassType;
    // The base plus the hand-written members, none of which carry
    // `cloudformationResource` metadata.
    for (const name of [
      'CfnElement', 'CfnRefElement', 'CfnResource', 'CfnOutput', 'CfnParameter',
      'CfnMapping', 'CfnCondition', 'CfnRule', 'CfnHook', 'CfnCodeDeployBlueGreenHook',
    ]) {
      expect(constructLevel(type(`aws-cdk-lib.${name}`), index)).toBe('L1');
    }
  });

  test('a Cfn-prefixed type outside the CfnElement subtree stays unleveled', () => {
    const type = (fqn: string) => index.get(fqn)!.type as spec.ClassType;
    // `CfnJson` extends Construct directly, so the prefix is the only thing
    // it shares with the subtree above.
    expect(constructLevel(type('aws-cdk-lib.CfnJson'), index)).toBeUndefined();

    // `cloudformation_include.CfnInclude` sits at the edge of the boundary,
    // and its real chain is `CfnInclude -> CfnElement -> constructs.Construct`
    // — so it IS in the L1 subtree and the subtree rule necessarily levels it
    // L1. Pinned here deliberately, because leaving it unleveled would mean
    // inventing an exception to that rule for one type.
    expect(constructLevel(
      type('aws-cdk-lib.cloudformation_include.CfnInclude'), index,
    )).toBe('L1');
  });

  test('an L2 wins over the CfnElement rule, whichever way it is established', () => {
    // No real type is both today, so the ordering is pinned with synthetics.
    // They must genuinely reach `CfnElement`, or the subtree rule never fires
    // and the test passes at any rule order. `Resource -> constructs.Construct`
    // in the shipped assembly, so the chain is built by REPLACING the indexed
    // `Resource` and `Stack` entries with versions rooted at `CfnElement`.
    const withSynthetics: TypeIndex = new Map(index);
    const synthetic = (fqn: string, name: string, base: string, namespace?: string) => {
      const type: spec.ClassType = {
        kind: spec.TypeKind.Class,
        fqn,
        name,
        assembly: 'aws-cdk-lib',
        base,
        ...(namespace ? { namespace } : {}),
      };
      withSynthetics.set(fqn, { type, assembly: cdk });
      return type;
    };

    // `Resource` and `Stack` re-rooted into the L1 subtree.
    synthetic('aws-cdk-lib.Resource', 'Resource', CFN_ELEMENT_FQN);
    const stack = synthetic('aws-cdk-lib.Stack', 'Stack', CFN_ELEMENT_FQN);
    // Reaches Resource (rule 3) and, through it, CfnElement (the subtree rule).
    synthetic('aws-cdk-lib.aws_fake.CfnElementResource', 'CfnElementResource', 'aws-cdk-lib.Resource', 'aws_fake');
    const resourceInSubtree = synthetic(
      'aws-cdk-lib.aws_fake.CfnBackedResource', 'CfnBackedResource',
      'aws-cdk-lib.aws_fake.CfnElementResource', 'aws_fake',
    );

    /** Whether `fqn`'s base chain reaches `base`, walking the same index. */
    const reaches = (fqn: string, base: string): boolean => {
      let current: string | undefined = fqn;
      for (let hops = 0; current && hops < 20; hops++) {
        const entry = withSynthetics.get(current);
        const next = entry && spec.isClassType(entry.type) ? entry.type.base : undefined;
        if (next === base) return true;
        current = next;
      }
      return false;
    };
    // Both arms must be able to reach the subtree, or neither assertion below
    // says anything about ordering.
    expect(reaches(resourceInSubtree.fqn, CFN_ELEMENT_FQN)).toBe(true);
    expect(reaches(stack.fqn, CFN_ELEMENT_FQN)).toBe(true);

    // The override is consulted first, so it suppresses the L1 the subtree
    // rule would otherwise give this chain.
    expect(constructLevel(stack, withSynthetics)).toBe('L2');
    // And a genuine `Resource` descendant keeps L2 even though the same chain
    // reaches `CfnElement`.
    expect(constructLevel(resourceInSubtree, withSynthetics)).toBe('L2');
  });

  test('builds version-pinned GitHub source URLs', () => {
    const bucket = index.get('aws-cdk-lib.aws_s3.Bucket')!.type;
    const url = sourceUrl(bucket, cdk)!;
    expect(url).toMatch(/^https:\/\/github\.com\/aws\/aws-cdk\/blob\/v\d+\.\d+\.\d+\/packages\/aws-cdk-lib\/aws-s3\/lib\/bucket\.ts#L\d+$/);
  });

  test('omits source URLs for build-generated files', () => {
    const cfnBucket = index.get('aws-cdk-lib.aws_s3.CfnBucket')!.type;
    expect(cfnBucket.locationInModule!.filename).toMatch(/\.generated\./);
    expect(sourceUrl(cfnBucket, cdk)).toBeUndefined();
  });

  test('typeMetadataRows resolves CloudFormation, L1 and Source for an L2', () => {
    const bucket = index.get('aws-cdk-lib.aws_s3.Bucket')!.type;
    const rows = typeMetadataRows(bucket, cdk, index, (fqn) => `/v2/docs/${fqn}`);
    expect(rows.map((r) => r.label)).toEqual(['CloudFormation', 'L1 type', 'Source']);
    expect(rows[0].value).toContain('<code>AWS::S3::Bucket</code>');
    expect(rows[0].value).toContain('TemplateReference/aws-resource-s3-bucket.html');
    expect(rows[1].value).toContain('<code>CfnBucket</code>');
    expect(rows[1].value).toContain('/v2/docs/aws-cdk-lib.aws_s3.CfnBucket');
    expect(rows[2].value).toContain(sourceUrl(bucket, cdk)!);
    // The resource type and the L1 name are unique to this page and stay
    // searchable. `Source` is boilerplate on ~22k pages, so only that value
    // is excluded.
    expect(rows[0].value).not.toContain('data-pagefind-ignore');
    expect(rows[1].value).not.toContain('data-pagefind-ignore');
    expect(rows[2].value).toContain('data-pagefind-ignore');
  });

  test('typeMetadataRows omits the L1 row on an L1 and marks its source generated', () => {
    const cfnBucket = index.get('aws-cdk-lib.aws_s3.CfnBucket')!.type;
    const rows = typeMetadataRows(cfnBucket, cdk, index, (fqn) => `/v2/docs/${fqn}`);
    // The page IS the L1, so a self-link would be noise — a contract
    // cfnMetadata reads rather than widens.
    expect(rows.map((r) => r.label)).toEqual(['CloudFormation', 'Source']);
    expect(rows[0].value).toContain('<code>AWS::S3::Bucket</code>');
    // A generated source has no repository file: a plain marker, not a dead link.
    expect(rows[1].value).toBe(
      '<span class="type-metadata-generated" data-pagefind-ignore>Generated code</span>',
    );
  });

  test('a dangerous @see URL never reaches the CloudFormation href', () => {
    // `@see` is third-party assembly metadata and `normalizeCfnSee` passes
    // anything it does not recognize through untouched. While the fact was a
    // markdown link, markdown-it's `validateLink` rejected dangerous schemes;
    // moving it into a raw-HTML `href` dropped that check, so the guard has to
    // live in the emitter. Failing closed still yields a real page.
    const hostile: spec.ClassType = {
      kind: spec.TypeKind.Class,
      fqn: 'aws-cdk-lib.aws_s3.CfnHostile',
      name: 'CfnHostile',
      assembly: 'aws-cdk-lib',
      docs: {
        see: 'javascript:alert(1)',
        custom: { cloudformationResource: 'AWS::S3::Bucket' },
      },
    };
    const rows = typeMetadataRows(hostile, cdk, index, () => undefined);
    const cfn = rows.find((r) => r.label === 'CloudFormation')!;
    expect(cfn.value).not.toContain('javascript:');
    expect(cfn.value).toContain(
      'href="https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html"',
    );
  });

  test.each([
    ['vbscript:msgbox(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['http://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html'],
  ])('the CloudFormation href rejects %s and falls back to the derived slug', (see) => {
    // The plain-http case is not an attack but the same class of problem: the
    // guard accepts https only, and a plain-http reference is stale.
    const l1: spec.ClassType = {
      kind: spec.TypeKind.Class,
      fqn: 'aws-cdk-lib.aws_s3.CfnProbe',
      name: 'CfnProbe',
      assembly: 'aws-cdk-lib',
      docs: { see, custom: { cloudformationResource: 'AWS::S3::Bucket' } },
    };
    const cfn = typeMetadataRows(l1, cdk, index, () => undefined)
      .find((r) => r.label === 'CloudFormation')!;
    expect(cfn.value).toContain('TemplateReference/aws-resource-s3-bucket.html');
    expect(cfn.value).toContain('href="https://');
    expect(cfn.value).not.toContain(see);
  });

  test('a legitimate @see URL is still preferred over the derived slug', () => {
    // The guard must not degrade every page to the derived convention: the
    // assembly's own slug is the authoritative one where it is safe.
    const cfnVpc = index.get('aws-cdk-lib.aws_ec2.CfnVPC')!.type;
    const cfn = typeMetadataRows(cfnVpc, cdk, index, () => undefined)
      .find((r) => r.label === 'CloudFormation')!;
    expect(cfn.value).toContain(`href="${normalizeCfnSee(cfnVpc.docs!.see!)}"`);
  });

  test('typeMetadataRows returns no rows when a type has neither location nor CFN data', () => {
    const bare: spec.ClassType = {
      kind: spec.TypeKind.Class,
      fqn: 'aws-cdk-lib.Nowhere',
      name: 'Nowhere',
      assembly: 'aws-cdk-lib',
    };
    // No empty shell: the block is absent entirely rather than rendering a
    // container with nothing in it.
    expect(typeMetadataRows(bare, cdk, index, () => undefined)).toEqual([]);
  });

  test('typeStability reads the type first and falls back to the owning assembly', () => {
    const experimentalAssembly = { ...cdk, docs: { stability: spec.Stability.Experimental } };
    const untagged: spec.ClassType = {
      kind: spec.TypeKind.Class, fqn: 'aws-cdk-lib.Untagged', name: 'Untagged', assembly: 'aws-cdk-lib',
    };
    const tagged: spec.ClassType = { ...untagged, docs: { stability: spec.Stability.Stable } };
    expect(typeStability(untagged, experimentalAssembly)).toBe(spec.Stability.Experimental);
    expect(typeStability(tagged, experimentalAssembly)).toBe(spec.Stability.Stable);
    expect(typeStability(untagged, { ...cdk, docs: {} })).toBeUndefined();
  });

  test('typeMetadataRows leads with a Stability row linking the guide for an experimental type', () => {
    // A per-type mark inside the stable library: the resource reference interfaces are experimental while
    // aws-cdk-lib itself is stable, so an assembly-level read would miss them.
    const ref = index.get('aws-cdk-lib.interfaces.aws_s3.IBucketRef')!.type;
    expect(ref.docs?.stability).toBe(spec.Stability.Experimental);
    const rows = typeMetadataRows(ref, cdk, index, () => undefined);
    expect(rows[0].label).toBe('Stability');
    expect(rows[0].value).toBe(
      '<a class="type-metadata-stability" data-pagefind-ignore href="/stability.html">Experimental</a>',
    );
    // An untagged type under an experimental (alpha) assembly inherits the module's level.
    const alpha = { ...cdk, docs: { stability: spec.Stability.Experimental } };
    const untagged: spec.ClassType = {
      kind: spec.TypeKind.Class, fqn: 'aws-cdk-lib.Untagged', name: 'Untagged', assembly: 'aws-cdk-lib',
    };
    expect(typeMetadataRows(untagged, alpha, index, () => undefined).map((r) => r.label)).toEqual(['Stability']);
  });

  test('typeMetadataRows shows no Stability row for stable, external or deprecated types', () => {
    // Stable is the default and stays silent, matching the module page, which warns only on experimental modules.
    const bucket = index.get('aws-cdk-lib.aws_s3.Bucket')!.type;
    expect(typeMetadataRows(bucket, cdk, index, () => undefined).map((r) => r.label)).not.toContain('Stability');
    const cfnBucket = index.get('aws-cdk-lib.aws_s3.CfnBucket')!.type;
    expect(cfnBucket.docs?.stability).toBe(spec.Stability.External);
    expect(typeMetadataRows(cfnBucket, cdk, index, () => undefined).map((r) => r.label)).not.toContain('Stability');
    const deprecated: spec.ClassType = {
      kind: spec.TypeKind.Class,
      fqn: 'aws-cdk-lib.Old',
      name: 'Old',
      assembly: 'aws-cdk-lib',
      docs: { stability: spec.Stability.Deprecated, deprecated: 'use New' },
    };
    expect(typeMetadataRows(deprecated, cdk, index, () => undefined)).toEqual([]);
  });

  test('renders type references readably', () => {
    expect(typeRefToString({ primitive: spec.PrimitiveType.String })).toBe('string');
    expect(typeRefToString({ fqn: 'aws-cdk-lib.aws_s3.BucketProps' })).toBe('BucketProps');
    expect(typeRefToString({
      collection: {
        kind: spec.CollectionKind.Array,
        elementtype: { fqn: 'aws-cdk-lib.aws_s3.CfnBucket.PolicyProperty' },
      },
    })).toBe('CfnBucket.PolicyProperty[]');
  });

  test('cfnResourceRef resolves an L2 via its validated Cfn* counterpart', () => {
    const bucket = index.get('aws-cdk-lib.aws_s3.Bucket')!.type as spec.ClassType;
    expect(cfnResourceRef(bucket, index)).toEqual({
      resourceType: 'AWS::S3::Bucket',
      l1Fqn: 'aws-cdk-lib.aws_s3.CfnBucket',
      docsUrl: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html',
    });
  });

  test('CFN docs links use HTTPS and the TemplateReference path', () => {
    // The reported case: the assembly @see carries the stale
    // http://.../UserGuide/... URL; the emitted link must be normalized.
    const asg = index.get('aws-cdk-lib.aws_autoscaling.AutoScalingGroup')!.type as spec.ClassType;
    expect(cfnResourceRef(asg, index)!.docsUrl).toBe(
      'https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-autoscaling-autoscalinggroup.html',
    );
    // Non-CFN-docs @see URLs pass through untouched
    expect(normalizeCfnSee('https://example.com/some-page.html')).toBe('https://example.com/some-page.html');
  });

  test('cfnResourceRef resolves via the @resource tag, not class-name matching', () => {
    // Vpc's L1 is CfnVPC -- naive `Cfn${name}` munging would look for
    // CfnVpc and miss; the @resource tag names AWS::EC2::VPC and the
    // reverse map finds the L1 regardless of its casing.
    const vpc = index.get('aws-cdk-lib.aws_ec2.Vpc')!.type as spec.ClassType;
    const ref = cfnResourceRef(vpc, index)!;
    expect(ref.resourceType).toBe('AWS::EC2::VPC');
    expect(ref.l1Fqn).toBe('aws-cdk-lib.aws_ec2.CfnVPC');
    // The L1's own @see URL is preferred as the docs target, normalized
    // to the HTTPS TemplateReference base
    expect(ref.docsUrl).toBe(normalizeCfnSee(index.get('aws-cdk-lib.aws_ec2.CfnVPC')!.type.docs!.see!));
    expect(ref.docsUrl).toMatch(/^https:\/\/docs\.aws\.amazon\.com\/AWSCloudFormation\/latest\/TemplateReference\//);
  });

  test('cfnResourceRef is undefined for L1 types and unbacked constructs', () => {
    // An L1 page already IS the resource -- no self-link
    const cfnBucket = index.get('aws-cdk-lib.aws_s3.CfnBucket')!.type as spec.ClassType;
    expect(cfnResourceRef(cfnBucket, index)).toBeUndefined();
    // Base classes with no backing resource render nothing
    const restApiBase = index.get('aws-cdk-lib.aws_apigateway.RestApiBase')!.type as spec.ClassType;
    expect(cfnResourceRef(restApiBase, index)).toBeUndefined();
    // Fixture construct with no CFN metadata and no Cfn* counterpart
    const bare: spec.ClassType = {
      kind: spec.TypeKind.Class,
      fqn: 'aws-cdk-lib.aws_s3.Unbacked',
      name: 'Unbacked',
      assembly: 'aws-cdk-lib',
      namespace: 'aws_s3',
      base: 'aws-cdk-lib.Resource',
    };
    expect(cfnResourceRef(bare, index)).toBeUndefined();
  });

  test('cfnResourceRef derives the TemplateReference URL when the L1 has no @see', () => {
    const tagged: spec.ClassType = {
      kind: spec.TypeKind.Class,
      fqn: 'aws-cdk-lib.aws_s3.Fixture',
      name: 'Fixture',
      assembly: 'aws-cdk-lib',
      namespace: 'aws_s3',
      docs: { custom: { resource: 'AWS::Fake::Widget' } },
    };
    // No L1 in the index carries AWS::Fake::Widget -- fall back to the
    // documented slug convention, resource type string from the assembly.
    expect(cfnResourceRef(tagged, index)).toEqual({
      resourceType: 'AWS::Fake::Widget',
      l1Fqn: undefined,
      docsUrl: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fake-widget.html',
    });
  });
});

describe('construct page generation', () => {
  let outDir: string;
  let cdkAssembly: spec.Assembly;
  let fixtureIndex: TypeIndex;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'construct-pages-'));
    generateDocs({ modules: ['aws-cdk-lib', 'constructs'] }, { outDir, packageRoot: ROOT, languages: ['ts'] });
    cdkAssembly = loadAssembly('aws-cdk-lib');
    fixtureIndex = buildTypeIndex([cdkAssembly, loadAssembly('constructs')]);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('each construct level badges its own color', () => {
    // A `*_patterns` submodule is what makes `constructLevel` return L3, and
    // no such page is in the e2e fixture, so this is L3's only pin. Rendering
    // one page directly keeps it deterministic and independent of which
    // pattern constructs the shipped assembly happens to carry.
    const level = (namespace: string, cloudformationResource?: string) => {
      const type: spec.ClassType = {
        kind: spec.TypeKind.Class,
        fqn: `aws-cdk-lib.${namespace}.Widget`,
        name: 'Widget',
        assembly: 'aws-cdk-lib',
        namespace,
        base: 'aws-cdk-lib.Resource',
        ...(cloudformationResource ? { docs: { custom: { cloudformationResource } } } : {}),
      };
      const index: TypeIndex = new Map(fixtureIndex);
      index.set(type.fqn, { type, assembly: cdkAssembly });
      return renderConstructPage({ type, assembly: cdkAssembly, index, linkFor: () => undefined });
    };

    expect(level('aws_ecs_patterns')).toContain('class="api-badge api-badge-l3" text="L3 construct"');
    expect(level('aws_s3', 'AWS::S3::Bucket')).toContain('class="api-badge api-badge-l1" text="L1 construct"');
    expect(level('aws_s3')).toContain('class="api-badge api-badge-l2" text="L2 construct"');
  });

  test('L2 construct page has badge, metadata block, example, and inlined props', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    // The H1 carries the name and the kind badge and nothing else: the source
    // chip belongs to the metadata block. Anchored to the end of the line, so
    // a chip creeping in fails this.
    expect(page).toMatch(/^# <span data-pagefind-weight="10">Bucket<\/span> <Badge type="tip" class="api-badge api-badge-l2" text="L2 construct" \/> \{#class-bucket-construct\}$/m);
    expect(page).not.toContain('class="header-tag"');
    // The block sits between the hierarchy bar and the example, which is the
    // specified header order.
    const chain = page.indexOf('<nav class="inheritance-chain"');
    const metadata = page.indexOf('<dl class="type-metadata"');
    const example = page.indexOf('## Example');
    expect(chain).toBeGreaterThan(-1);
    expect(metadata).toBeGreaterThan(chain);
    expect(example).toBeGreaterThan(metadata);
    expect(page).toMatch(/<dd class="type-metadata-value"><a class="type-metadata-source" data-pagefind-ignore href="https:\/\/github\.com\/aws\/aws-cdk\/blob\/v\d+\.\d+\.\d+\/packages\/aws-cdk-lib\/aws-s3\/lib\/bucket\.ts#L\d+" target="_blank" rel="noopener"><code>aws-s3\/lib\/bucket\.ts<\/code><\/a><\/dd>/);
    // Breadcrumb module hierarchy above the H1
    expect(page).toContain('<a href="/v2/docs/aws-cdk-lib-readme.html">aws-cdk-lib</a>.<wbr><a href="/v2/docs/aws-cdk-lib.aws_s3-readme.html">aws_s3</a>.<wbr><strong>Bucket</strong>');
    // The link text carries no full file path, which would be noise
    expect(page).not.toContain('[aws-s3/lib/bucket.ts');
    expect(page).toContain('## Example');
    expect(page).toContain('## Initializer');
    // Initializer is a real fenced code block so it flows through the same
    // markdown-it -> Shiki pipeline as the example above it, wrapped in a
    // Pagefind-ignore container so its repeated type names do not make every
    // page using a type match a search for it. The fence
    // info carries the inline type-link map the highlight hook turns into
    // anchors, so the parameter types stay linked to their pages.
    expect(page).toContain(
      '```ts type-links=Construct:/v2/docs/constructs.Construct.html,BucketProps:/v2/docs/aws-cdk-lib.aws_s3.BucketProps.html\n'
      + 'new Bucket(scope: Construct, id: string, props?: BucketProps)\n```');
    expect(page).not.toContain('signature-inline');
    // A human label instead of the type name, with the slug anchor preserved
    expect(page).toContain('## Construct Props {#props-bucketprops}');
    expect(page).not.toContain('## Props (`BucketProps`)');
    expect(page).toContain('<code class="member-name">versioned</code>');
    // Interactive layout: inheritance chain, methods, properties
    expect(page).toContain('<nav class="inheritance-chain"');
    expect(page).toContain('## Methods');
    expect(page).toContain('## Properties');
  });

  test('construct page has no Extends row -- the inheritance chain conveys it', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    expect(page).not.toContain('**Extends:**');
    expect(page).toContain('<nav class="inheritance-chain"');
  });

  test('metadata table is gone from type pages; no empty shell remains', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    expect(page).not.toContain('| | |');
    expect(page).not.toContain('| **Module** |');
    expect(page).not.toContain('| **FQN** |');
    expect(page).not.toContain('| **Source** |');
  });

  test('L1 construct page states its CloudFormation resource in the metadata block', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.CfnBucket.md'), 'utf-8');
    expect(page).toContain('text="L1 construct"');
    // The fact is a metadata row, not a description sentence, normalized to
    // HTTPS + TemplateReference.
    expect(page).toContain(
      '<dt class="type-metadata-label">CloudFormation</dt><dd class="type-metadata-value">'
      + '<a href="https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html"'
      + ' target="_blank" rel="noopener"><code>AWS::S3::Bucket</code></a></dd>',
    );
    expect(page).not.toContain('Defines the [`AWS::S3::Bucket`]');
    // No in-site self-link and no L1 row on the L1 page
    expect(page).not.toContain('via [`CfnBucket`]');
    expect(page).not.toContain('<dt class="type-metadata-label">L1 type</dt>');
    // Generated L1 sources have no repository file: a marker, not a dead link
    // and not a silently missing fact
    expect(page).toContain('<span class="type-metadata-generated" data-pagefind-ignore>Generated code</span>');
  });

  test('L2 construct page links its backing CloudFormation resource and L1 page', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    // Resource type links to the AWS CFN resource reference; the L1 page is
    // the in-site jump, routed through the canonical link resolver. Both are
    // rows of the metadata block rather than one prose sentence.
    expect(page).toContain(
      '<dt class="type-metadata-label">CloudFormation</dt><dd class="type-metadata-value">'
      + '<a href="https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html"'
      + ' target="_blank" rel="noopener"><code>AWS::S3::Bucket</code></a></dd>',
    );
    expect(page).toContain(
      '<dt class="type-metadata-label">L1 type</dt><dd class="type-metadata-value">'
      + '<a href="/v2/docs/aws-cdk-lib.aws_s3.CfnBucket.html"><code>CfnBucket</code></a></dd>',
    );
    expect(page).not.toContain('Backed by the');
  });

  test('constructs without a backing CFN resource show no CloudFormation sentence', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.Construct.md'), 'utf-8');
    expect(page).not.toContain('CloudFormation resource');
  });

  test('L3 pattern construct gets a page in its patterns submodule', () => {
    const page = readFileSync(
      join(outDir, 'docs', 'aws-cdk-lib.aws_ecs_patterns.ApplicationLoadBalancedFargateService.md'),
      'utf-8',
    );
    expect(page).toContain('text="L3 construct"');
  });

  test('module-root constructs get pages', () => {
    expect(existsSync(join(outDir, 'docs', 'aws-cdk-lib.Stack.md'))).toBe(true);
    expect(existsSync(join(outDir, 'docs', 'constructs.Construct.md'))).toBe(true);
  });

  test('props tables include properties inherited from parent structs', () => {
    // ApplicationLoadBalancedFargateServiceProps extends
    // ApplicationLoadBalancedServiceBaseProps, which declares `cluster`
    const page = readFileSync(
      join(outDir, 'docs', 'aws-cdk-lib.aws_ecs_patterns.ApplicationLoadBalancedFargateService.md'),
      'utf-8',
    );
    expect(page).toContain('<code class="member-name">cluster</code>');
  });

  test('type tables link construct names to their pages with level kinds', () => {
    const s3Page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'), 'utf-8');
    expect(s3Page).toContain('[`Bucket`](/v2/docs/aws-cdk-lib.aws_s3.Bucket) | Construct (L2) |');
    expect(s3Page).toContain('[`CfnBucket`](/v2/docs/aws-cdk-lib.aws_s3.CfnBucket) | Construct (L1) |');
    // Non-constructs are linked to their own symbol pages
    expect(s3Page).toContain('[`BucketProps`](/v2/docs/aws-cdk-lib.aws_s3.BucketProps) | Struct |');
  });
});
