import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import { toAgentMarkdown } from '../src/docgen/agent-markdown.js';
import { buildTypeIndex, TypeIndex } from '../src/docgen/constructs.js';
import { generateDocs, loadAssembly as loadCachedAssembly } from '../src/docgen/index.js';
import { renderExtendsBar } from '../src/docgen/layout.js';
import { buildUsageIndex, classMethods, classProperties, renderClassPage, renderInterfacePage, renderStructPage, UsageIndex } from '../src/docgen/symbols.js';

// Twins carry absolute site links; a fixed site URL keeps these expectations independent of DOCS_SITE_URL.
const SITE_URL = 'https://docs.example.com/cdk/api/';

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

  test('types know which static members produce them', () => {
    // Static methods returning the type, sorted by owner then member, each once.
    expect(usage.obtainableFrom.get('aws-cdk-lib.aws_s3.IBucket')).toEqual([
      { ownerFqn: 'aws-cdk-lib.aws_s3.Bucket', memberName: 'fromBucketArn', kind: 'method', static: true },
      { ownerFqn: 'aws-cdk-lib.aws_s3.Bucket', memberName: 'fromBucketAttributes', kind: 'method', static: true },
      { ownerFqn: 'aws-cdk-lib.aws_s3.Bucket', memberName: 'fromBucketName', kind: 'method', static: true },
      { ownerFqn: 'aws-cdk-lib.aws_s3.Bucket', memberName: 'fromCfnBucket', kind: 'method', static: true },
    ]);
    // A static constant counts; an instance member or a struct does not.
    expect(usage.obtainableFrom.get('aws-cdk-lib.JsonNull')).toEqual([
      { ownerFqn: 'aws-cdk-lib.JsonNull', memberName: 'INSTANCE', kind: 'property', static: true, constant: true },
    ]);
    expect(usage.obtainableFrom.has('aws-cdk-lib.aws_s3.BucketProps')).toBe(false);
    // A protected static is not callable and has no row on its owner page, so it is not a factory:
    // BaseDeploymentConfig.fromDeploymentConfigName is `protected static` and returns IBaseDeploymentConfig.
    const codedeploy = index.get('aws-cdk-lib.aws_codedeploy.BaseDeploymentConfig')!.type as spec.ClassType;
    expect(codedeploy.methods?.find((m) => m.name === 'fromDeploymentConfigName')).toMatchObject({ static: true, protected: true });
    expect(usage.obtainableFrom.get('aws-cdk-lib.aws_codedeploy.IBaseDeploymentConfig') ?? []).not.toContainEqual(
      expect.objectContaining({ ownerFqn: 'aws-cdk-lib.aws_codedeploy.BaseDeploymentConfig', memberName: 'fromDeploymentConfigName' }),
    );
    // Collections and unions produce something other than one instance, so they are not recorded: every
    // recorded member's declared type is exactly the key.
    for (const [fqn, refs] of usage.obtainableFrom) {
      for (const ref of refs) {
        const owner = index.get(ref.ownerFqn)!.type as spec.ClassType;
        const member = owner.methods?.find((m) => m.name === ref.memberName)?.returns
          ?? owner.properties?.find((p) => p.name === ref.memberName);
        expect(member && spec.isNamedTypeReference(member.type) && member.type.fqn).toBe(fqn);
      }
    }
  });

  test('factories sort by owner FQN then member in code-unit order, each once', () => {
    // Two owners listed in reverse FQN order; `VER_1` declared twice so the dedup is exercised; `of` after
    // `VER_1` because `V` (0x56) sorts before `o` (0x6F) in code-unit order, where a locale sort would put `of`
    // first.
    const target: spec.ClassType = { assembly: 'lib', fqn: 'lib.Version', name: 'Version', kind: spec.TypeKind.Class };
    const ref = (fqn: string): spec.NamedTypeReference => ({ fqn });
    const owner = (fqn: string, name: string): spec.ClassType => ({
      assembly: 'lib',
      fqn,
      name,
      kind: spec.TypeKind.Class,
      methods: [{ name: 'of', static: true, returns: { type: ref('lib.Version') } }],
      properties: [
        { name: 'VER_1', static: true, const: true, immutable: true, type: ref('lib.Version') },
        { name: 'VER_1', static: true, const: true, immutable: true, type: ref('lib.Version') },
      ],
    });
    const assembly = {
      name: 'lib',
      types: {
        'lib.Version': target, 'lib.Zeta': owner('lib.Zeta', 'Zeta'), 'lib.Alpha': owner('lib.Alpha', 'Alpha'),
      },
    } as unknown as spec.Assembly;
    const synthetic = buildUsageIndex(buildTypeIndex([assembly]));
    expect(synthetic.obtainableFrom.get('lib.Version')).toEqual([
      { ownerFqn: 'lib.Alpha', memberName: 'VER_1', kind: 'property', static: true, constant: true },
      { ownerFqn: 'lib.Alpha', memberName: 'of', kind: 'method', static: true },
      { ownerFqn: 'lib.Zeta', memberName: 'VER_1', kind: 'property', static: true, constant: true },
      { ownerFqn: 'lib.Zeta', memberName: 'of', kind: 'method', static: true },
    ]);
    // The same order on the real catalog: constants first, `of` last.
    const pev = usage.obtainableFrom.get('aws-cdk-lib.aws_rds.PostgresEngineVersion')!;
    expect(pev[0].memberName.startsWith('VER_')).toBe(true);
    expect(pev[pev.length - 1].memberName).toBe('of');
  });

  test('types know which members take them as an argument and which return them', () => {
    // A method entry carries the type that DECLARES the member. jsii lists a redeclaration of every overridden or
    // implemented method on the subtype too, and those are skipped, so grantRead is recorded once on the
    // interface that declares it rather than again on BucketBase and on every subclass.
    expect(usage.returnedBy.get('aws-cdk-lib.aws_iam.Grant')).toContainEqual(
      { ownerFqn: 'aws-cdk-lib.aws_s3.IBucket', memberName: 'grantRead', kind: 'method' },
    );
    expect((index.get('aws-cdk-lib.aws_s3.BucketBase')!.type as spec.ClassType).methods
      ?.find((m) => m.name === 'grantRead')).toMatchObject({ overrides: 'aws-cdk-lib.aws_s3.IBucket' });
    expect(usage.returnedBy.get('aws-cdk-lib.aws_iam.Grant')).not.toContainEqual(
      expect.objectContaining({ ownerFqn: 'aws-cdk-lib.aws_s3.BucketBase', memberName: 'grantRead' }),
    );
    expect(usage.argumentIn.get('aws-cdk-lib.aws_s3.LifecycleRule')).toEqual([
      { ownerFqn: 'aws-cdk-lib.aws_s3.Bucket', memberName: 'addLifecycleRule', kind: 'method' },
    ]);
    // Every construct initializer opens with `scope`, and so do the `X.fromY(scope, id, …)` and `X.of(scope)`
    // families, so recording that parameter would list most of the corpus on the Construct and IConstruct pages.
    // Those entries are the ones the row drops, from an initializer and from a method alike.
    expect((index.get('aws-cdk-lib.aws_s3.Bucket')!.type as spec.ClassType).initializer?.parameters?.[0])
      .toMatchObject({ name: 'scope', type: { fqn: 'constructs.Construct' } });
    expect((index.get('aws-cdk-lib.aws_s3.Bucket')!.type as spec.ClassType).methods
      ?.find((m) => m.name === 'fromBucketArn')?.parameters?.[0]).toMatchObject({ name: 'scope' });
    expect(usage.argumentIn.get('constructs.Construct') ?? []).not.toContainEqual(
      expect.objectContaining({ ownerFqn: 'aws-cdk-lib.aws_s3.Bucket', kind: 'initializer' }),
    );
    expect(usage.argumentIn.get('constructs.Construct') ?? []).not.toContainEqual(
      expect.objectContaining({ ownerFqn: 'aws-cdk-lib.aws_s3.Bucket', memberName: 'fromBucketArn' }),
    );
    // A later parameter of the same kind of member is a usage like any other: `Stack.of(construct)` names its
    // parameter `construct`, so nothing about it is skipped.
    expect(usage.argumentIn.get('constructs.IConstruct')).toContainEqual(
      { ownerFqn: 'aws-cdk-lib.Stack', memberName: 'of', kind: 'method', static: true },
    );
    // An instance method carries no static flag, so Go keeps the dot for it; the static entries below are
    // flagged, because jsii exposes a static in Go as the package-level `Owner_Member`.
    expect(usage.returnedBy.get('aws-cdk-lib.Duration')).toContainEqual(
      { ownerFqn: 'aws-cdk-lib.Duration', memberName: 'minus', kind: 'method' },
    );
    // An initializer has no member name of its own, so its entry names the owner and the kind.
    expect(usage.argumentIn.get('aws-cdk-lib.aws_s3.Bucket')).toEqual([
      { ownerFqn: 'aws-cdk-lib.aws_lambda_event_sources.S3EventSource', memberName: 'initializer', kind: 'initializer' },
    ]);
    // An enum reaches the index through a parameter; a property does not, because an enum page already lists the
    // properties that reference it.
    expect(usage.argumentIn.get('aws-cdk-lib.RemovalPolicy')).toContainEqual(
      { ownerFqn: 'aws-cdk-lib.IResource', memberName: 'applyRemovalPolicy', kind: 'method' },
    );
    expect(usage.argumentIn.has('aws-cdk-lib.aws_s3.BucketEncryption')).toBe(false);
    expect(usage.returnedBy.has('aws-cdk-lib.aws_s3.BucketEncryption')).toBe(false);
    // The index records every usage, including the ones a page may not repeat because a more specific row of the
    // same block already states them: Bucket's initializer taking BucketProps, and the statics returning IBucket.
    expect(usage.argumentIn.get('aws-cdk-lib.aws_s3.BucketProps')).toEqual([
      { ownerFqn: 'aws-cdk-lib.aws_s3.Bucket', memberName: 'initializer', kind: 'initializer' },
    ]);
    expect(usage.returnedBy.get('aws-cdk-lib.aws_s3.IBucket')).toContainEqual(
      { ownerFqn: 'aws-cdk-lib.aws_s3.Bucket', memberName: 'fromBucketArn', kind: 'method', static: true },
    );
    // A protected method is not callable and has no row on its owner page, so it is not a usage:
    // Resource.getResourceArnAttribute is `protected` and takes ArnComponents.
    const resource = index.get('aws-cdk-lib.Resource')!.type as spec.ClassType;
    expect(resource.methods?.find((m) => m.name === 'getResourceArnAttribute')).toMatchObject({ protected: true });
    expect(usage.argumentIn.get('aws-cdk-lib.ArnComponents') ?? []).not.toContainEqual(
      expect.objectContaining({ ownerFqn: 'aws-cdk-lib.Resource', memberName: 'getResourceArnAttribute' }),
    );
  });

  test('usage entries unwrap generic types, list each member once, and sort by owner then member', () => {
    const ref = (fqn: string): spec.NamedTypeReference => ({ fqn });
    const target: spec.InterfaceType = { assembly: 'lib', fqn: 'lib.IThing', name: 'IThing', kind: spec.TypeKind.Interface };
    const owner = (fqn: string, name: string): spec.ClassType => ({
      assembly: 'lib',
      fqn,
      name,
      kind: spec.TypeKind.Class,
      initializer: {
        parameters: [{ name: 'things', type: { collection: { kind: spec.CollectionKind.Array, elementtype: ref('lib.IThing') } } }],
      },
      methods: [
        // Two parameters of the same type: one entry.
        { name: 'add', parameters: [{ name: 'a', type: ref('lib.IThing') }, { name: 'b', type: ref('lib.IThing') }] },
        { name: 'Pick', returns: { type: { union: { types: [ref('lib.IThing'), { primitive: spec.PrimitiveType.String }] } } } },
      ],
    });
    // A protected initializer cannot be called, so it is no more a usage than a protected method is.
    const hidden: spec.ClassType = {
      assembly: 'lib',
      fqn: 'lib.Base',
      name: 'Base',
      kind: spec.TypeKind.Class,
      initializer: { protected: true, parameters: [{ name: 'thing', type: ref('lib.IThing') }] },
    };
    // A leading `scope` of a construct type is the construct tree, so it is not a usage; the second parameter of
    // the same initializer, and a method parameter after it, still are.
    const construct: spec.ClassType = {
      assembly: 'lib',
      fqn: 'lib.Widget',
      name: 'Widget',
      kind: spec.TypeKind.Class,
      initializer: {
        parameters: [
          { name: 'scope', type: ref('constructs.IConstruct') },
          { name: 'config', type: ref('lib.IThing') },
        ],
      },
      methods: [{
        name: 'from',
        static: true,
        parameters: [{ name: 'scope', type: ref('constructs.IConstruct') }, { name: 'thing', type: ref('lib.IThing') }],
      }],
    };
    // A parameter that merely shares the name is an ordinary parameter: the type is part of the test.
    const named: spec.ClassType = {
      assembly: 'lib',
      fqn: 'lib.Named',
      name: 'Named',
      kind: spec.TypeKind.Class,
      methods: [{ name: 'pick', parameters: [{ name: 'scope', type: ref('lib.IThing') }] }],
    };
    // A redeclaration of a member declared OUTSIDE the documented assemblies is kept: nothing else records it.
    const impl: spec.ClassType = {
      assembly: 'lib',
      fqn: 'lib.Impl',
      name: 'Impl',
      kind: spec.TypeKind.Class,
      methods: [{ name: 'visit', overrides: 'ext.IExternal', parameters: [{ name: 't', type: ref('lib.IThing') }] }],
    };
    // Owners whose FQN order differs from their short-name order, which is what pins the sort key. `sub.Beta`
    // sorts before `Impl` by short name and after `lib.Zeta` by FQN; the two `Same` owners sort by FQN only
    // because their short names are equal.
    const other = (fqn: string, name: string, member: string): spec.ClassType => ({
      assembly: 'lib',
      fqn,
      name,
      kind: spec.TypeKind.Class,
      methods: [{ name: member, parameters: [{ name: 'thing', type: ref('lib.IThing') }] }],
    });
    const assembly = {
      name: 'lib',
      types: {
        'lib.IThing': target,
        'lib.Zeta': owner('lib.Zeta', 'Zeta'),
        'lib.Alpha': owner('lib.Alpha', 'Alpha'),
        'lib.Base': hidden,
        'lib.Widget': construct,
        'lib.Named': named,
        'lib.Impl': impl,
        'lib.sub.Beta': other('lib.sub.Beta', 'Beta', 'take'),
        'lib.b.Same': other('lib.b.Same', 'Same', 'take'),
        'lib.a.Same': other('lib.a.Same', 'Same', 'take'),
      },
    } as unknown as spec.Assembly;
    const constructs = {
      name: 'constructs',
      types: {
        'constructs.IConstruct': {
          assembly: 'constructs', fqn: 'constructs.IConstruct', name: 'IConstruct', kind: spec.TypeKind.Interface,
        },
      },
    } as unknown as spec.Assembly;
    const synthetic = buildUsageIndex(buildTypeIndex([assembly, constructs]));
    // Arrays and unions count for the named type inside them. The order is by SHORT owner name, then owner FQN,
    // then member: `Beta` leads although `lib.sub.Beta` is the last FQN, and the two `Same` owners are separated
    // only by their FQN. The initializer entry leads its owner, because it renders as the owner name. `Base` is
    // absent: its initializer is protected.
    expect(synthetic.argumentIn.get('lib.IThing')).toEqual([
      { ownerFqn: 'lib.Alpha', memberName: 'initializer', kind: 'initializer' },
      { ownerFqn: 'lib.Alpha', memberName: 'add', kind: 'method' },
      { ownerFqn: 'lib.sub.Beta', memberName: 'take', kind: 'method' },
      { ownerFqn: 'lib.Impl', memberName: 'visit', kind: 'method' },
      { ownerFqn: 'lib.Named', memberName: 'pick', kind: 'method' },
      { ownerFqn: 'lib.a.Same', memberName: 'take', kind: 'method' },
      { ownerFqn: 'lib.b.Same', memberName: 'take', kind: 'method' },
      { ownerFqn: 'lib.Widget', memberName: 'initializer', kind: 'initializer' },
      { ownerFqn: 'lib.Widget', memberName: 'from', kind: 'method', static: true },
      { ownerFqn: 'lib.Zeta', memberName: 'initializer', kind: 'initializer' },
      { ownerFqn: 'lib.Zeta', memberName: 'add', kind: 'method' },
    ]);
    // The scope parameters themselves are recorded nowhere.
    expect(synthetic.argumentIn.has('constructs.IConstruct')).toBe(false);
    expect(synthetic.returnedBy.get('lib.IThing')).toEqual([
      { ownerFqn: 'lib.Alpha', memberName: 'Pick', kind: 'method' },
      { ownerFqn: 'lib.Zeta', memberName: 'Pick', kind: 'method' },
    ]);
    expect(synthetic.argumentIn.get('lib.IThing')).not.toContainEqual(
      expect.objectContaining({ ownerFqn: 'lib.Base' }),
    );
  });

  test('a covariant override is recorded where the narrowed return type is declared', () => {
    // jsii allows an override to narrow its return type, and that narrowed type is documented only on the
    // override. Skipping the redeclaration outright would lose the entry, since the declaration it overrides
    // returns the wider type.
    const ref = (fqn: string): spec.NamedTypeReference => ({ fqn });
    const base: spec.ClassType = {
      assembly: 'lib',
      fqn: 'lib.Base',
      name: 'Base',
      kind: spec.TypeKind.Class,
      methods: [
        { name: 'build', returns: { type: ref('lib.Wide') } },
        { name: 'name', parameters: [{ name: 'wide', type: ref('lib.Wide') }] },
      ],
    };
    const derived: spec.ClassType = {
      assembly: 'lib',
      fqn: 'lib.Derived',
      name: 'Derived',
      kind: spec.TypeKind.Class,
      base: 'lib.Base',
      methods: [
        { name: 'build', overrides: 'lib.Base', returns: { type: ref('lib.Narrow') } },
        { name: 'name', overrides: 'lib.Base', parameters: [{ name: 'wide', type: ref('lib.Wide') }] },
      ],
    };
    const plain = (fqn: string, name: string): spec.ClassType => ({ assembly: 'lib', fqn, name, kind: spec.TypeKind.Class });
    const assembly = {
      name: 'lib',
      types: {
        'lib.Base': base, 'lib.Derived': derived, 'lib.Wide': plain('lib.Wide', 'Wide'), 'lib.Narrow': plain('lib.Narrow', 'Narrow'),
      },
    } as unknown as spec.Assembly;
    const synthetic = buildUsageIndex(buildTypeIndex([assembly]));
    expect(synthetic.returnedBy.get('lib.Narrow')).toEqual([
      { ownerFqn: 'lib.Derived', memberName: 'build', kind: 'method' },
    ]);
    // The wider type keeps the one entry it had, on the declaring type.
    expect(synthetic.returnedBy.get('lib.Wide')).toEqual([
      { ownerFqn: 'lib.Base', memberName: 'build', kind: 'method' },
    ]);
    // A redeclaration that returns the same type adds nothing, and parameters are never doubled: an override
    // cannot change them.
    expect(synthetic.argumentIn.get('lib.Wide')).toEqual([
      { ownerFqn: 'lib.Base', memberName: 'name', kind: 'method' },
    ]);
  });

  test('a redeclaration whose overridden method cannot be found is not read as a narrowing', () => {
    // `overrides` names a documented type, so the member is a redeclaration, but that type declares no method of
    // the name. Nothing is known to compare the return against, so the entry belongs to whatever declared it
    // rather than here: treating the missing lookup as a narrowing would record every such member twice.
    const ref = (fqn: string): spec.NamedTypeReference => ({ fqn });
    const assembly = {
      name: 'lib',
      types: {
        'lib.Thing': { assembly: 'lib', fqn: 'lib.Thing', name: 'Thing', kind: spec.TypeKind.Class },
        'lib.Marker': { assembly: 'lib', fqn: 'lib.Marker', name: 'Marker', kind: spec.TypeKind.Interface },
        'lib.Impl': {
          assembly: 'lib',
          fqn: 'lib.Impl',
          name: 'Impl',
          kind: spec.TypeKind.Class,
          methods: [{ name: 'build', overrides: 'lib.Marker', returns: { type: ref('lib.Thing') } }],
        },
      },
    } as unknown as spec.Assembly;
    const synthetic = buildUsageIndex(buildTypeIndex([assembly]));
    expect(synthetic.returnedBy.has('lib.Thing')).toBe(false);
  });

  test('a static that shadows a base static is its own entry, not a redeclaration', () => {
    // jsii marks a subclass static that shadows a base static with `overrides`, but it is a separate callable
    // with its own anchor, so both are listed. `App.of` shadows `Stage.of`, and both return their own type.
    const app = index.get('aws-cdk-lib.App')!.type as spec.ClassType;
    expect(app.methods?.find((m) => m.name === 'of'))
      .toMatchObject({ static: true, overrides: 'aws-cdk-lib.Stage' });
    expect(usage.argumentIn.get('constructs.IConstruct')).toEqual(expect.arrayContaining([
      { ownerFqn: 'aws-cdk-lib.App', memberName: 'of', kind: 'method', static: true },
      { ownerFqn: 'aws-cdk-lib.Stage', memberName: 'of', kind: 'method', static: true },
    ]));
    // The same holds for a static whose parameters or return reach the new rows: an instance method is the only
    // kind a redeclaration hides.
    const synthetic = buildUsageIndex(buildTypeIndex([{
      name: 'lib',
      types: {
        'lib.IThing': { assembly: 'lib', fqn: 'lib.IThing', name: 'IThing', kind: spec.TypeKind.Interface },
        'lib.Base': {
          assembly: 'lib',
          fqn: 'lib.Base',
          name: 'Base',
          kind: spec.TypeKind.Class,
          methods: [
            { name: 'make', static: true, parameters: [{ name: 't', type: { fqn: 'lib.IThing' } }] },
            { name: 'take', parameters: [{ name: 't', type: { fqn: 'lib.IThing' } }] },
          ],
        },
        'lib.Sub': {
          assembly: 'lib',
          fqn: 'lib.Sub',
          name: 'Sub',
          kind: spec.TypeKind.Class,
          base: 'lib.Base',
          methods: [
            { name: 'make', static: true, overrides: 'lib.Base', parameters: [{ name: 't', type: { fqn: 'lib.IThing' } }] },
            { name: 'take', overrides: 'lib.Base', parameters: [{ name: 't', type: { fqn: 'lib.IThing' } }] },
          ],
        },
      },
    } as unknown as spec.Assembly]));
    expect(synthetic.argumentIn.get('lib.IThing')).toEqual([
      { ownerFqn: 'lib.Base', memberName: 'make', kind: 'method', static: true },
      { ownerFqn: 'lib.Base', memberName: 'take', kind: 'method' },
      { ownerFqn: 'lib.Sub', memberName: 'make', kind: 'method', static: true },
    ]);
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
    expect(page).toContain('<div class="member-row" id="toseconds" data-params="opts?">');
  });

  test('class pages have no Extends fact -- the inheritance chain conveys it', () => {
    // SecretValue extends Intrinsic: chain renders, inline fact does not.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.SecretValue.md'), 'utf-8');
    expect(page).not.toContain('**Extends:**');
    expect(page).toContain('<nav class="inheritance-chain"');
  });

  test('structs get a page with breadcrumb, expandable props, and props-users list', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
    expect(page).toContain('# <span data-pagefind-weight="10">Bucket<wbr>Props</span> <Badge type="info" class="api-badge api-badge-struct" text="Struct" />');
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
    expect(page).toContain('# <span data-pagefind-weight="10">Bucket<wbr>Encryption</span> <Badge type="info" class="api-badge api-badge-enum" text="Enum" />');
    expect(page).toContain('| Member | Description |');
    expect(page).toContain('| <span id="kms"></span>`KMS` |');
    expect(page).toContain('## Referenced by');
    expect(page).toContain('- [`BucketProps`](/v2/docs/aws-cdk-lib.aws_s3.BucketProps).encryption');
  });

  test('deprecated enum members carry the deprecated name style, badge and reason', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.CustomResourceProviderRuntime.md'), 'utf-8');
    const row = (name: string) => page.split('\n').find((l) => l.startsWith(`| <span id="${name.toLowerCase()}"></span>`)) ?? '';
    // NODEJS_12_X is deprecated in jsii: struck-through name, text badge, reason as the description.
    expect(row('NODEJS_12_X')).toBe(
      '| <span id="nodejs_12_x"></span><code class="member-name-deprecated">NODEJS_12_X</code> <span class="member-deprecated">deprecated</span> | Use latest version |',
    );
    // A member that is not deprecated renders as a plain backticked name with its summary.
    expect(row('NODEJS_24_X')).toBe('| <span id="nodejs_24_x"></span>`NODEJS_24_X` | Node.js 24.x. |');
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
      module: 'aws-cdk-lib.aws_s3',
      kind: 'construct',
    });
    const others = bucket.items.find((g: any) => g.text === 'Others');
    expect(others.collapsed).toBe(true);
    expect(others.items).toContainEqual({
      text: 'BucketEncryption',
      link: '/v2/docs/aws-cdk-lib.aws_s3.BucketEncryption',
      module: 'aws-cdk-lib.aws_s3',
      kind: 'enum',
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
    expect(page).toContain('# <span data-pagefind-weight="10">ILocal<wbr>Bundling</span> <Badge type="info" class="api-badge api-badge-interface" text="Interface" />');
    expect(page).not.toContain('| **Kind** |');
    expect(page).toContain('<div class="member-row" id="trybundle" data-params="outputDir,options">');
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
    const block = /<table class="type-metadata"[^>]*>([\s\S]*?)<\/table>/.exec(page);
    expect(block).not.toBeNull();
    // Exactly one row, and it is Source: a non-construct has no CloudFormation
    // resource and is not its own L1.
    expect([...block![1].matchAll(/class="type-metadata-label" scope="row">([^<]*)</g)].map((m) => m[1]))
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
    expect(page).toContain('<table class="type-metadata"');
    expect(page).toContain('<th class="type-metadata-label" scope="row">Source</th>');
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

  test('interface pages list the static factories that return the type, linked to the member', () => {
    // IBucket is produced by four Bucket statics; the row lists them sorted by owner, then member name, each
    // linking the owner page at the member's row anchor.
    // Four entries overflow the two-line budget, so the last two fold.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.IBucket.md'), 'utf-8');
    const row = page.match(/<div class="chain-row" id="obtainable-from"><span class="chain-label">obtainable from<\/span> (.*?)<\/div>/);
    expect(row).not.toBeNull();
    // A `<wbr>` after the dot lets a long entry wrap at narrow widths; it adds nothing to the text.
    const entries = [...row![1].matchAll(/<a class="chain-item" href="([^"]+)">([^<]+)<wbr>([^<]+)<\/a>/g)].map((m) => [m[2] + m[3], m[1]]);
    expect(entries).toEqual([
      ['Bucket.fromBucketArn', '/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#frombucketarn'],
      ['Bucket.fromBucketAttributes', '/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#frombucketattributes'],
      ['Bucket.fromBucketName', '/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#frombucketname'],
      ['Bucket.fromCfnBucket', '/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#fromcfnbucket'],
    ]);
    expect(row![1]).toContain('<summary aria-label="2 more obtainable from">2 more</summary>');
    // The row follows every type-to-type relation, after `extends`.
    expect(page.indexOf('<span class="chain-label">extends</span>')).toBeLessThan(page.indexOf('id="obtainable-from"'));
  });

  test('class pages list a static constant of their own type, linked by fragment alone', () => {
    // An entry the page's own type owns links `#anchor` only: a version catalog with hundreds of constants would
    // otherwise repeat its own page path in every entry.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.JsonNull.md'), 'utf-8');
    expect(page).toContain(
      '<div class="chain-row" id="obtainable-from"><span class="chain-label">obtainable from</span> '
      + '<ul class="chain-list" role="list"><li role="listitem"><a class="chain-item" href="#instance">JsonNull.<wbr>INSTANCE</a></li></ul></div>',
    );
  });

  test('entries in the row are language variants; the block is wrapped in language tabs only then', () => {
    const linkFor = (fqn: string) => `/v2/docs/${fqn}`;
    const languages = ['ts', 'python', 'dotnet', 'go'] as const;
    const assembly = loadAssembly('aws-cdk-lib');
    const index = buildTypeIndex([assembly, loadAssembly('constructs')]);
    const usage = buildUsageIndex(index);
    const ibucket = index.get('aws-cdk-lib.aws_s3.IBucket')!.type as spec.InterfaceType;
    const page = renderInterfacePage({ type: ibucket, assembly, index, usage, linkFor, languages: [...languages], emitExamples: false });
    const row = page.match(/<div class="chain-row" id="obtainable-from">(.*?)<\/div>/)![1];
    // The whole entry is the variant: the member name through the member-name translators, and Go's `_`
    // separator, since jsii exposes a static there as the package-level `Owner_Member`.
    expect(row).toContain('<span class="lang-variant" data-lang="ts">Bucket.<wbr>fromBucketArn</span>');
    expect(row).toMatch(/data-lang="python"[^>]*>Bucket\.<wbr>from_bucket_arn<\/span>/);
    expect(row).toMatch(/data-lang="dotnet"[^>]*>Bucket\.<wbr>FromBucketArn<\/span>/);
    expect(row).toMatch(/data-lang="go"[^>]*>Bucket_<wbr>FromBucketArn<\/span>/);
    // The enclosing <nav> is already ignored by Pagefind, so the spans do not repeat the attribute.
    expect(row).not.toContain('data-pagefind-ignore');
    // The anchor stays on the canonical slug, so the link resolves in every language.
    expect(row).toContain('href="/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#frombucketarn"');
    // The block sits inside a <LanguageTabs> group so the variants follow the page's language switch...
    expect(page).toMatch(/<LanguageTabs[^>]*>\n\n<nav class="inheritance-chain"/);
    // ...and a block without the row stays the bare <nav> it always was.
    const props = index.get('aws-cdk-lib.aws_s3.BucketProps')!.type as spec.InterfaceType;
    const propsPage = renderStructPage({ type: props, assembly, index, usage, linkFor, languages: [...languages], emitExamples: false });
    expect(propsPage).not.toMatch(/<LanguageTabs[^>]*>\n\n<nav class="inheritance-chain"/);
    expect(propsPage).toContain('<nav class="inheritance-chain"');
  });

  test('a static property translates as a property, and an owner without a page renders as text', () => {
    const iface: spec.InterfaceType = {
      assembly: 'x', fqn: 'x.IThing', name: 'IThing', kind: spec.TypeKind.Interface,
    };
    const refs = [
      { ownerFqn: 'x.Thing', memberName: 'DEFAULT_THING', kind: 'property' as const, static: true, constant: true },
      { ownerFqn: 'x.Thing', memberName: 'defaultThing', kind: 'property' as const, static: true },
      { ownerFqn: 'y.Other', memberName: 'ofThing', kind: 'method' as const, static: true },
    ];
    // Only `x.Thing` has a page: `y.Other` comes from an assembly the site does not document.
    const linkFor = (fqn: string) => (fqn === 'x.Thing' ? '/v2/docs/x.Thing' : undefined);
    const [nav] = renderExtendsBar(iface, linkFor, [], [], { obtainableFrom: refs }, ['ts', 'python', 'go']).filter((l) => l.includes('<nav'));
    const row = nav.match(/<div class="chain-row" id="obtainable-from">(.*?)<\/div>/)![1];
    const [first, second, third] = [...row.matchAll(/<li role="listitem">(.*?)<\/li>/g)].map((m) => m[1]);
    // A `const` static keeps its UPPER_SNAKE name in Python, as jsii's bindings do.
    expect(first).toBe(
      '<a class="chain-item" href="/v2/docs/x.Thing.html#default-thing">'
      + '<span class="lang-variant" data-lang="ts">Thing.<wbr>DEFAULT_THING</span>'
      + '<span class="lang-variant" data-lang="python" v-pre>Thing.<wbr>DEFAULT_THING</span>'
      + '<span class="lang-variant" data-lang="go" v-pre>Thing_<wbr>DEFAULT_THING</span></a>, ',
    );
    // A non-const static property goes through translatePropertyName, the same translator the member rows use.
    expect(second).toBe(
      '<a class="chain-item" href="/v2/docs/x.Thing.html#defaultthing">'
      + '<span class="lang-variant" data-lang="ts">Thing.<wbr>defaultThing</span>'
      + '<span class="lang-variant" data-lang="python" v-pre>Thing.<wbr>default_thing</span>'
      + '<span class="lang-variant" data-lang="go" v-pre>Thing_<wbr>DefaultThing</span></a>, ',
    );
    // No page to link: the entry is a span with the same content and no anchor.
    expect(third).toBe(
      '<span class="chain-item">'
      + '<span class="lang-variant" data-lang="ts">Other.<wbr>ofThing</span>'
      + '<span class="lang-variant" data-lang="python" v-pre>Other.<wbr>of_thing</span>'
      + '<span class="lang-variant" data-lang="go" v-pre>Other_<wbr>OfThing</span></span>',
    );
    expect(third).not.toContain('<a ');
  });

  test('the same-name note applies to the obtainable-from row too, since the renderer is shared', () => {
    // `ownerNote` runs inside the shared member-row renderer, so the rule is not a usage-row rule. Two `Thing`
    // factories from two submodules get the note; a third owner with its own name does not.
    const iface: spec.InterfaceType = {
      assembly: 'x', fqn: 'x.IThing', name: 'IThing', kind: spec.TypeKind.Interface,
    };
    const refs = [
      { ownerFqn: 'x.left.Thing', memberName: 'of', kind: 'method' as const, static: true },
      { ownerFqn: 'x.right.Thing', memberName: 'of', kind: 'method' as const, static: true },
      { ownerFqn: 'x.Other', memberName: 'of', kind: 'method' as const, static: true },
    ];
    const [nav] = renderExtendsBar(iface, (fqn) => `/v2/docs/${fqn}`, [], [], { obtainableFrom: refs })
      .filter((l) => l.includes('<nav'));
    const row = nav.match(/<div class="chain-row" id="obtainable-from">(.*?)<\/div>/)![1];
    expect(row).toContain('<a class="chain-item" href="/v2/docs/x.left.Thing.html#of">Thing.<wbr>of (left)</a>');
    expect(row).toContain('<a class="chain-item" href="/v2/docs/x.right.Thing.html#of">Thing.<wbr>of (right)</a>');
    expect(row).toContain('<a class="chain-item" href="/v2/docs/x.Other.html#of">Other.<wbr>of</a>');
  });

  test('the note falls back to the whole namespace path when one segment still collides', () => {
    // Two owners can share the segment nearest the type, so the one-segment note would be identical on both and
    // the row would be back to two links a reader cannot tell apart.
    const iface: spec.InterfaceType = {
      assembly: 'x', fqn: 'x.IThing', name: 'IThing', kind: spec.TypeKind.Interface,
    };
    const refs = [
      { ownerFqn: 'x.a.mixins.Thing', memberName: 'of', kind: 'method' as const, static: true },
      { ownerFqn: 'x.b.mixins.Thing', memberName: 'of', kind: 'method' as const, static: true },
    ];
    const [nav] = renderExtendsBar(iface, (fqn) => `/v2/docs/${fqn}`, [], [], { obtainableFrom: refs })
      .filter((l) => l.includes('<nav'));
    const texts = [...nav.matchAll(/<a class="chain-item" href="[^"]*">(.*?)<\/a>/g)].map((m) => m[1]);
    expect(texts).toEqual(['Thing.<wbr>of (x.a.mixins)', 'Thing.<wbr>of (x.b.mixins)']);
    expect(new Set(texts).size).toBe(texts.length);
  });

  test('a const static keeps its name in the Python member row, matching the obtainable-from entry', () => {
    const linkFor = (fqn: string) => `/v2/docs/${fqn}`;
    const assembly = loadAssembly('aws-cdk-lib');
    const index = buildTypeIndex([assembly]);
    const usage = buildUsageIndex(index);
    const jsonNull = index.get('aws-cdk-lib.JsonNull')!.type as spec.ClassType;
    const page = renderClassPage({ type: jsonNull, assembly, index, usage, linkFor, languages: ['ts', 'python'], emitExamples: false });
    // The property row and the hierarchy entry agree: both read INSTANCE in Python, as jsii's bindings spell it.
    expect(page).toMatch(/<div class="member-row" id="instance"[\s\S]*?data-lang="python"[^>]*><code class="member-name">INSTANCE<\/code>/);
    // Only the member name varies between the two languages, so the owner and the separator are emitted once.
    expect(page).toMatch(/id="obtainable-from"[\s\S]*?>JsonNull\.<wbr><span class="lang-variant" data-lang="ts">INSTANCE<\/span><span class="lang-variant" data-lang="python" v-pre>INSTANCE<\/span>/);
    // A non-const property still snake-cases: creationStack -> creation_stack.
    expect(page).toMatch(/data-lang="python"[^>]*><code class="member-name">creation_stack<\/code>/);
  });

  test('a struct page lists the static factory that returns it', () => {
    // Arn.split returns ArnComponents, so the struct's bar carries the row below its other relations.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.ArnComponents.md'), 'utf-8');
    expect(page).toMatch(/<div class="chain-row" id="obtainable-from">.*href="\/v2\/docs\/aws-cdk-lib\.Arn\.html#split">Arn\.<wbr>split<\/a>/);
  });

  test('the agent Markdown twin keeps cross-page links in the row, drops the <wbr> and non-TypeScript variants', () => {
    // A same-page `#instance` link renders as text, like every other same-page link in the twin.
    const jsonNull = toAgentMarkdown(readFileSync(join(outDir, 'docs', 'aws-cdk-lib.JsonNull.md'), 'utf-8'), SITE_URL).markdown;
    expect(jsonNull).toContain('Obtainable from: JsonNull.INSTANCE');
    expect(jsonNull).not.toContain('<wbr>');
    // A cross-page entry keeps its deep link to the factory, and only the TypeScript variant appears.
    const linkFor = (fqn: string) => `/v2/docs/${fqn}`;
    const assembly = loadAssembly('aws-cdk-lib');
    const index = buildTypeIndex([assembly, loadAssembly('constructs')]);
    const usage = buildUsageIndex(index);
    const ibucket = index.get('aws-cdk-lib.aws_s3.IBucket')!.type as spec.InterfaceType;
    const page = renderInterfacePage({ type: ibucket, assembly, index, usage, linkFor, languages: ['ts', 'python'], emitExamples: false });
    const twin = toAgentMarkdown(page, SITE_URL).markdown;
    expect(twin).toContain('Obtainable from: [Bucket.fromBucketArn](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#frombucketarn), ');
    // Factories folded behind the disclosure keep their deep link too: the URL is the point of this row.
    expect(twin).toContain('[Bucket.fromCfnBucket](https://docs.example.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html#fromcfnbucket)');
    expect(twin).not.toContain('from_bucket_arn');
    expect(twin).not.toContain('<wbr>');
  });

  test('the agent Markdown twin links the shown entries of every hierarchy row and folds the rest as text', () => {
    // The same renderer serves the breadcrumb and the existing rows, so their visible entries link too.
    const bucket = toAgentMarkdown(readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8'), SITE_URL).markdown;
    expect(bucket).toMatch(/^Extends: \[Construct\]\(https:\/\/docs\.example\.com\/cdk\/api\/v2\/docs\/constructs\.Construct\.html\) › .*Bucket$/m);
    expect(bucket).toMatch(/^Implements: .*\[IBucket\]\(https:\/\/docs\.example\.com\/cdk\/api\/v2\/docs\/aws-cdk-lib\.aws_s3\.IBucket\.html\)/m);
    // Entries folded behind the row's disclosure stay plain text: Construct has 2,332 descendants, and linking
    // them all would quadruple its twin for entries the page itself hides.
    const construct = toAgentMarkdown(readFileSync(join(outDir, 'docs', 'constructs.Construct.md'), 'utf-8'), SITE_URL).markdown;
    const superclassOf = construct.split('\n').find((l) => l.startsWith('Superclass of: '))!;
    const links = (superclassOf.match(/\]\(https:\/\/docs\.example\.com\/cdk\/api\/v2\/docs\//g) ?? []).length;
    const entries = superclassOf.split(', ').length;
    expect(links).toBeGreaterThan(0);
    expect(links).toBeLessThan(10);
    expect(entries).toBeGreaterThan(1000);
    // A type whose block exists only for its factories has no ancestor, so no `Extends:` line claims it extends itself.
    const duration = toAgentMarkdown(readFileSync(join(outDir, 'docs', 'aws-cdk-lib.Duration.md'), 'utf-8'), SITE_URL).markdown;
    expect(duration).not.toMatch(/^Extends: Duration$/m);
    expect(duration).toMatch(/^Obtainable from: /m);
  });

  test('a README twin links every site page absolutely', () => {
    // README prose links types through code-span labels; every one must resolve to an absolute .html page.
    const readme = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_apigatewayv2_integrations-readme.md'), 'utf-8');
    const twin = toAgentMarkdown(readme, SITE_URL).markdown;
    expect(twin).toContain(`](${SITE_URL}v2/docs/aws-cdk-lib.aws_apigatewayv2_integrations.HttpLambdaIntegration.html`);
    expect(twin).not.toMatch(/\]\(\/(?!\/)/);
  });

  test('a type nothing produces has no obtainable-from row', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
    expect(page).toContain('<span class="chain-label">used as props by</span>');
    expect(page).not.toContain('obtainable from');
  });

  test('class pages list the members that take the type and the members that return it', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.Duration.md'), 'utf-8');
    const row = (id: string, label: string) =>
      page.match(new RegExp(`<div class="chain-row" id="${id}"><span class="chain-label">${label}</span> (.*?)</div>`));
    // Duration.minus takes a Duration and returns one, so it is an entry of both rows: an entry the page's own
    // type owns links by fragment alone, like the obtainable-from row.
    expect(row('used-as-argument-in', 'used as argument in')![1])
      .toContain('<a class="chain-item" href="#minus">Duration.<wbr>minus</a>');
    expect(row('returned-by', 'returned by')![1])
      .toContain('<a class="chain-item" href="#minus">Duration.<wbr>minus</a>');
    // The static factories stay in the obtainable-from row rather than being repeated as returners.
    expect(row('returned-by', 'returned by')![1]).not.toContain('Duration.<wbr>days');
    expect(page).toMatch(/id="obtainable-from"[\s\S]*?<a class="chain-item" href="#days">Duration\.<wbr>days<\/a>/);
    // A member another type owns links that type's page at the member's row anchor.
    expect(row('used-as-argument-in', 'used as argument in')![1])
      .toContain('<a class="chain-item" href="/v2/docs/aws-cdk-lib.Expiration.html#after">Expiration.<wbr>after</a>');
    // The three member rows come last, in one order: obtainable from, then the two usage rows.
    expect(page.indexOf('id="obtainable-from"')).toBeLessThan(page.indexOf('id="used-as-argument-in"'));
    expect(page.indexOf('id="used-as-argument-in"')).toBeLessThan(page.indexOf('id="returned-by"'));
  });

  test('two owners of the same name in one row are told apart by their namespace', () => {
    // Three submodules declare a `Schedule` whose `rate` takes a Duration, so without the qualifier the row would
    // read `Schedule.rate, Schedule.rate, Schedule.rate`, three identical link texts pointing at three pages.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.Duration.md'), 'utf-8');
    const row = page.match(/<div class="chain-row" id="used-as-argument-in">(.*?)<\/div>/)![1];
    expect(row).toContain('<a class="chain-item" href="/v2/docs/aws-cdk-lib.aws_events.Schedule.html#rate">Schedule.<wbr>rate (aws_events)</a>');
    expect(row).toContain('Schedule.<wbr>rate (aws_synthetics)');
    // The note is a trailing parenthetical rather than a prefix: a prefix would read as a namespace, and the
    // jsii submodule is not the namespace Go, Java or C# would use.
    expect(row).not.toContain('>aws_events.Schedule');
    // An owner whose name is unique in the row keeps the short name.
    expect(row).toContain('<a class="chain-item" href="#minus">Duration.<wbr>minus</a>');
  });

  test('a struct taken by an initializer keeps the props row alone, with no second row saying the same', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketProps.md'), 'utf-8');
    // The props row keeps its own label, id and content.
    expect(page).toContain('<div class="chain-row" id="used-as-props-by"><span class="chain-label">used as props by</span>');
    // Bucket's initializer is the only member taking the struct, and the row above already names it.
    expect(page).not.toContain('id="used-as-argument-in"');
    // Nothing returns the struct, so no row claims otherwise.
    expect(page).not.toContain('id="returned-by"');
  });

  test('a page carrying the obtainable-from row does not repeat its statics as returners', () => {
    // Both statics that return an IBucket are factories, so the row above lists them and no `returned by` row
    // follows. The index still records them, because what is dropped depends on which rows the page carries: an
    // enum or mixin page has no obtainable-from row, so there the same entries do render.
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.IBucket.md'), 'utf-8');
    expect(page).toContain('id="obtainable-from"');
    expect(page).not.toContain('id="returned-by"');
  });

  test('an enum used as an argument gets the relation block it otherwise has no reason to carry', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.RemovalPolicy.md'), 'utf-8');
    expect(page).toContain('<nav class="inheritance-chain"');
    expect(page).toContain('<span class="chain-item chain-current">RemovalPolicy</span>');
    expect(page).toMatch(
      /id="used-as-argument-in"[\s\S]*?<a class="chain-item" href="\/v2\/docs\/aws-cdk-lib\.IResource\.html#applyremovalpolicy">IResource\.<wbr>applyRemovalPolicy<\/a>/,
    );
    // The landmark is named for what the block holds, so a block of usage rows promises no hierarchy. That is
    // every enum, and any other type whose only relations are usages: nothing extends LifecycleRule or takes it
    // as props, and Duration is a class with no ancestor, interface or subclass.
    expect(page).toContain('<nav class="inheritance-chain" aria-label="Type relations"');
    const struct = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.LifecycleRule.md'), 'utf-8');
    expect(struct).toContain('<nav class="inheritance-chain" aria-label="Type relations"');
    expect(struct).toContain('id="used-as-argument-in"');
    const plainClass = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.Duration.md'), 'utf-8');
    expect(plainClass).toContain('<nav class="inheritance-chain" aria-label="Type relations"');
    expect(plainClass).toContain('id="obtainable-from"');
    expect(plainClass).not.toContain('<span class="chain-label">implements</span>');
    // A block with a type-to-type relation keeps the hierarchy name, on a class as well as an interface.
    const iface = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.IBucket.md'), 'utf-8');
    expect(iface).toContain('<nav class="inheritance-chain" aria-label="Type hierarchy"');
    const subclassed = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    expect(subclassed).toContain('<nav class="inheritance-chain" aria-label="Type hierarchy"');
    // An enum no member takes or returns has no relation block at all.
    const unused = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.BucketEncryption.md'), 'utf-8');
    expect(unused).not.toContain('<nav class="inheritance-chain"');
  });

  test('usage entries are language variants, and an initializer entry is language-stable', () => {
    const linkFor = (fqn: string) => `/v2/docs/${fqn}`;
    const assembly = loadAssembly('aws-cdk-lib');
    const index = buildTypeIndex([assembly, loadAssembly('constructs')]);
    const usage = buildUsageIndex(index);
    const duration = index.get('aws-cdk-lib.Duration')!.type as spec.ClassType;
    const page = renderClassPage({ type: duration, assembly, index, usage, linkFor, languages: ['ts', 'python', 'go'], emitExamples: false });
    const row = page.match(/<div class="chain-row" id="returned-by">(.*?)<\/div>/)![1];
    // An instance method keeps the dot in every language, so the owner and the separator are emitted once and
    // only the member name varies.
    expect(row).toContain('Duration.<wbr><span class="lang-variant" data-lang="ts">minus</span>');
    expect(row).toMatch(/data-lang="python"[^>]*>minus<\/span>/);
    expect(row).toMatch(/data-lang="go"[^>]*>Minus<\/span>/);
    // A static in Go is the package-level `Owner_Member`, so its separator differs by language and the whole
    // entry stays per-language.
    const factories = page.match(/<div class="chain-row" id="obtainable-from">(.*?)<\/div>/)![1];
    expect(factories).toContain('<span class="lang-variant" data-lang="ts">Duration.<wbr>days</span>');
    expect(factories).toMatch(/data-lang="go"[^>]*>Duration_<wbr>Days<\/span>/);
    expect(page).toMatch(/<LanguageTabs[^>]*>\n\n<nav class="inheritance-chain"/);
    // An initializer entry has one spelling in every language, so it carries no variants at all, and a block
    // whose member rows hold only such entries is the bare <nav> with no language tabs. It names the section it
    // links to, so a row of members does not read as a row of types.
    const iface: spec.InterfaceType = { assembly: 'x', fqn: 'x.IThing', name: 'IThing', kind: spec.TypeKind.Interface };
    const argumentIn = [{ ownerFqn: 'x.Thing', memberName: 'initializer', kind: 'initializer' as const }];
    const lines = renderExtendsBar(iface, (fqn) => `/v2/docs/${fqn}`, [], [], { argumentIn }, ['ts', 'python', 'go']);
    const [nav] = lines.filter((l) => l.includes('<nav'));
    expect(nav).toContain(
      '<div class="chain-row" id="used-as-argument-in"><span class="chain-label">used as argument in</span> '
      + '<ul class="chain-list" role="list"><li role="listitem">'
      + '<a class="chain-item" href="/v2/docs/x.Thing.html#initializer">Thing (initializer)</a></li></ul></div>',
    );
    expect(nav).not.toContain('lang-variant');
    expect(lines.join('\n')).not.toContain('<LanguageTabs');
  });

  test('the agent Markdown twin renders the usage rows as labeled lines', () => {
    const duration = toAgentMarkdown(readFileSync(join(outDir, 'docs', 'aws-cdk-lib.Duration.md'), 'utf-8'), SITE_URL).markdown;
    expect(duration).toMatch(/^Used as argument in: /m);
    expect(duration).toMatch(/^Returned by: /m);
    // The shown entries link, as they do in every row. Entries behind the disclosure render as text, because a
    // type used in thousands of places would otherwise put hundreds of kilobytes of links between the
    // description and the API surface the twin carries.
    const argumentIn = duration.split('\n').find((l) => l.startsWith('Used as argument in: '))!;
    const links = (argumentIn.match(/\]\(https:\/\/docs\.example\.com\/cdk\/api\/v2\/docs\//g) ?? []).length;
    const entries = argumentIn.split(', ').length;
    expect(links).toBeGreaterThan(0);
    expect(links).toBeLessThan(10);
    expect(entries).toBeGreaterThan(links);
    expect(argumentIn).toContain('Duration.minus');
  });
});
