import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { jest } from '@jest/globals';
import * as spec from '@jsii/spec';
import { buildTypeIndex, TypeIndex } from '../src/docgen/constructs.js';
import { generateDocs, loadAssembly as loadCachedAssembly } from '../src/docgen/index.js';
import {
  buildMixinClassIndex,
  buildMixinIndex,
  collectMethods,
  collectProperties,
  MixinIndex,
  renderMixinPage,
} from '../src/docgen/mixins.js';
import { inlineMethodSignature, signatureText } from '../src/docgen/signatures.js';

const ROOT = resolve(import.meta.dirname, '..');

function loadAssembly(module: string): spec.Assembly {
  // Delegates to src/docgen's memoized loader so the ~1s aws-cdk-lib
  // parse is shared with generateDocs calls in the same worker.
  return loadCachedAssembly(join(ROOT, 'node_modules', module));
}

describe('mixin detection', () => {
  let index: TypeIndex;
  let mixins: MixinIndex;

  beforeAll(() => {
    index = buildTypeIndex([loadAssembly('aws-cdk-lib'), loadAssembly('constructs')]);
    mixins = buildMixinIndex(index);
  });

  test('only types whose closure contains the IMixin marker are mixins', () => {
    expect(mixins.has('constructs.IMixin')).toBe(true);
  });

  test('behavioral interfaces implemented by classes are NOT mixins', () => {
    // A structural heuristic alone mis-classifies these.
    expect(mixins.has('aws-cdk-lib.aws_iam.IGrantable')).toBe(false);
    expect(mixins.has('aws-cdk-lib.aws_s3.IBucket')).toBe(false);
    expect(mixins.has('aws-cdk-lib.aws_iam.IRole')).toBe(false);
    expect(mixins.has('aws-cdk-lib.IResource')).toBe(false);
  });

  test('datatype structs are never mixins', () => {
    expect(mixins.has('aws-cdk-lib.aws_s3.BucketProps')).toBe(false);
  });

  test('marker interfaces without the IMixin closure are not mixins', () => {
    expect(mixins.has('constructs.IDependable')).toBe(false);
  });

  test('implementors are found via base-class chain and interface inheritance', () => {
    // aws-cdk-lib.Mixin implements constructs.IMixin directly; concrete
    // mixins like BucketVersioning extend Mixin, so they must be listed
    // as IMixin implementors through the base-class chain.
    const implementors = mixins.get('constructs.IMixin')!;
    expect(implementors).toContain('aws-cdk-lib.Mixin');
    expect(implementors).toContain('aws-cdk-lib.aws_s3.mixins.BucketVersioning');
  });

  test('concrete mixins are CLASSES and classify from their base chain', () => {
    // The marker rule above only ever classifies interfaces, but every
    // concrete mixin aws-cdk-lib ships is a class extending the abstract
    // `aws-cdk-lib.Mixin` with an empty `interfaces` list of its own — so
    // none of them appeared in the interface-keyed index and they all
    // rendered as ordinary classes. Pinned against the real assembly.
    expect([...buildMixinClassIndex(index)].sort()).toEqual([
      'aws-cdk-lib.aws_ecr.mixins.RepositoryAutoDeleteImages',
      'aws-cdk-lib.aws_ecs.mixins.ClusterSettings',
      'aws-cdk-lib.aws_s3.mixins.BucketAutoDeleteObjects',
      'aws-cdk-lib.aws_s3.mixins.BucketBlockPublicAccess',
      'aws-cdk-lib.aws_s3.mixins.BucketPolicyStatements',
      'aws-cdk-lib.aws_s3.mixins.BucketVersioning',
    ]);
  });

  test('the abstract base is the mechanism, not a mixin', () => {
    // `aws-cdk-lib.Mixin` carries the marker DIRECTLY. It is the machinery
    // concrete mixins extend, not something a user applies, which is why
    // the rule walks from the base class rather than from the type itself.
    expect(buildMixinClassIndex(index).has('aws-cdk-lib.Mixin')).toBe(false);
  });

  test('ordinary classes and constructs are not class-based mixins', () => {
    const mixinClasses = buildMixinClassIndex(index);
    expect(mixinClasses.has('aws-cdk-lib.aws_s3.Bucket')).toBe(false);
    expect(mixinClasses.has('aws-cdk-lib.Stack')).toBe(false);
  });

  test('collects methods and properties inherited from parent interfaces', () => {
    const bucket = index.get('aws-cdk-lib.aws_s3.IBucket')!.type as spec.InterfaceType;
    const methodNames = collectMethods(bucket, index).map((m) => m.name);
    expect(methodNames).toContain('grantRead'); // own
    expect(methodNames).toContain('applyRemovalPolicy'); // from IResource
    const propNames = collectProperties(bucket, index).map((p) => p.name);
    expect(propNames).toContain('bucketArn'); // own
    expect(propNames).toContain('stack'); // from IResource
  });

  test('renders readable method signatures', () => {
    const bucket = index.get('aws-cdk-lib.aws_s3.IBucket')!.type as spec.InterfaceType;
    const grantRead = collectMethods(bucket, index).find((m) => m.name === 'grantRead')!;
    const html = inlineMethodSignature(grantRead, { linkFor: () => undefined });
    expect(signatureText(html)).toBe(
      'grantRead(identity: IGrantable, objectsKeyPattern?: any): Grant',
    );
  });
});

const fixtureAssembly = { name: 'fixture' } as spec.Assembly;

const iface = (
  fqn: string,
  opts: { interfaces?: string[]; methods?: string[]; properties?: spec.Property[] } = {},
): spec.InterfaceType => ({
  kind: spec.TypeKind.Interface,
  fqn,
  name: fqn.split('.').pop()!,
  assembly: 'fixture',
  interfaces: opts.interfaces,
  methods: (opts.methods ?? []).map((name) => ({ name })),
  properties: opts.properties,
} as unknown as spec.InterfaceType);

const klass = (fqn: string, opts: { interfaces?: string[]; base?: string } = {}): spec.ClassType => ({
  kind: spec.TypeKind.Class,
  fqn,
  name: fqn.split('.').pop()!,
  assembly: 'fixture',
  interfaces: opts.interfaces,
  base: opts.base,
} as unknown as spec.ClassType);

const buildIndex = (types: spec.Type[]): TypeIndex =>
  new Map(types.map((type) => [type.fqn, { type, assembly: fixtureAssembly }]));

describe('mixin detection against a fixture assembly', () => {
  test('only the IMixin-extending interface is classified as a mixin', () => {
    const index = buildIndex([
      iface('fixture.IMixin', { methods: ['applyTo'] }),
      // (a) an IMixin-extending interface implemented by a class
      iface('fixture.IWithBadge', { interfaces: ['fixture.IMixin'], methods: ['badge'] }),
      klass('fixture.Badger', { interfaces: ['fixture.IWithBadge'] }),
      // (b) a plain behavioral interface implemented by a class
      iface('fixture.IBucketLike', { methods: ['grantRead'] }),
      klass('fixture.Bucket', { interfaces: ['fixture.IBucketLike'] }),
    ]);
    const mixins = buildMixinIndex(index);
    expect(mixins.has('fixture.IWithBadge')).toBe(true);
    expect(mixins.get('fixture.IWithBadge')).toEqual(['fixture.Badger']);
    expect(mixins.has('fixture.IBucketLike')).toBe(false);
  });

  test('an IMixin type with zero implementors is not listed', () => {
    const index = buildIndex([
      iface('fixture.IMixin', { methods: ['applyTo'] }),
      iface('fixture.IOrphanMixin', { interfaces: ['fixture.IMixin'], methods: ['x'] }),
    ]);
    expect(buildMixinIndex(index).has('fixture.IOrphanMixin')).toBe(false);
  });

  test('a class classifies as a mixin through any depth of base chain', () => {
    const index = buildIndex([
      iface('fixture.IMixin', { methods: ['applyTo'] }),
      // The mechanism: carries the marker DIRECTLY.
      klass('fixture.Mixin', { interfaces: ['fixture.IMixin'] }),
      // Concrete mixins, one and two levels below the mechanism.
      klass('fixture.Versioning', { base: 'fixture.Mixin' }),
      klass('fixture.StrictVersioning', { base: 'fixture.Versioning' }),
      // An ordinary class with an unrelated base.
      klass('fixture.Bucket', { base: 'fixture.Resource' }),
      klass('fixture.Resource'),
    ]);
    const classes = buildMixinClassIndex(index);
    expect([...classes].sort()).toEqual(['fixture.StrictVersioning', 'fixture.Versioning']);
    // The mechanism itself is excluded: the rule starts at the base.
    expect(classes.has('fixture.Mixin')).toBe(false);
    expect(classes.has('fixture.Bucket')).toBe(false);
  });

  test('the marker is resolved from the assemblies, not hard-coded', () => {
    // Nothing here is named aws-cdk-lib or constructs, and the marker is
    // reached transitively through interface inheritance.
    const index = buildIndex([
      iface('other.IMixin', { methods: ['applyTo'] }),
      iface('other.IMarkedThing', { interfaces: ['other.IMixin'] }),
      klass('other.Machinery', { interfaces: ['other.IMarkedThing'] }),
      klass('other.Concrete', { base: 'other.Machinery' }),
    ]);
    expect([...buildMixinClassIndex(index)]).toEqual(['other.Concrete']);
  });

  test('no marker in the assemblies classifies no classes', () => {
    const index = buildIndex([
      iface('fixture.INotTheMarker', { methods: ['x'] }),
      klass('fixture.Base', { interfaces: ['fixture.INotTheMarker'] }),
      klass('fixture.Derived', { base: 'fixture.Base' }),
    ]);
    expect(buildMixinClassIndex(index).size).toBe(0);
  });

  test('degrades visibly to an empty index when the IMixin marker is absent', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const index = buildIndex([
        iface('fixture.IBucketLike', { methods: ['grantRead'] }),
        klass('fixture.Bucket', { interfaces: ['fixture.IBucketLike'] }),
      ]);
      expect(buildMixinIndex(index).size).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('IMixin'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('mixin property table markup', () => {
  function renderFixture(): string {
    const index = buildIndex([
      iface('fixture.IMixin', { methods: ['applyTo'] }),
      iface('fixture.IWithOrigins', {
        interfaces: ['fixture.IMixin'],
        properties: [
          {
            name: 'allowedOrigins',
            type: { collection: { kind: 'array', elementtype: { primitive: 'string' } } },
            docs: { summary: 'Origins allowed.' },
          },
          {
            name: 'tags',
            type: { collection: { kind: 'map', elementtype: { primitive: 'string' } } },
            optional: true,
            docs: { summary: 'Tag map.' },
          },
        ] as unknown as spec.Property[],
      }),
    ]);
    return renderMixinPage({
      type: index.get('fixture.IWithOrigins')!.type as spec.InterfaceType,
      assembly: fixtureAssembly,
      index,
      mixins: buildMixinIndex(index),
      linkFor: () => undefined,
      languages: ['ts', 'java'],
    });
  }

  test('no property type is rendered as a code span containing an HTML entity', () => {
    // CommonMark does not resolve entity references inside a code span, so an
    // escaped cell wrapped in backticks reaches the reader as `List&lt;String&gt;`.
    const codeSpanWithEntity = /`[^`\n]*&(?:lt|gt|amp|quot|#\d+);[^`\n]*`/;
    expect(renderFixture()).not.toMatch(codeSpanWithEntity);
  });

  test('the collection and map types render as HTML text, not a code span', () => {
    const page = renderFixture();
    expect(page).toContain('## Properties');
    // The shared renderer puts the type in HTML text, where the entity is decoded by the browser.
    expect(page).toContain('<span class="member-type" title="List&lt;String&gt;">List&lt;String&gt;</span>');
    expect(page).toContain('<span class="member-type" title="Map&lt;String, String&gt;">Map&lt;String, String&gt;</span>');
  });
});

describe('mixin page generation', () => {
  let outDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'mixin-pages-'));
    generateDocs({ modules: ['aws-cdk-lib', 'constructs'] }, { outDir, packageRoot: ROOT, languages: ['ts'] });
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a mixin page carries a metadata block whose only row is Source', () => {
    // The sixth and last call site of the block. The H1 pin here is
    // `toContain`, which holds whether or not a source chip sits in the title
    // row, so deleting the renderer line has to fail something else.
    const page = readFileSync(join(outDir, 'docs', 'constructs.IMixin.md'), 'utf-8');
    const block = /<dl class="type-metadata"[^>]*>([\s\S]*?)<\/dl>/.exec(page);
    expect(block).not.toBeNull();
    expect([...block![1].matchAll(/class="type-metadata-label">([^<]*)</g)].map((m) => m[1]))
      .toEqual(['Source']);
    expect(page).not.toContain('class="header-tag"');
  });

  test('mixin page has badge, breadcrumb, methods, and implementors', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.IMixin.md'), 'utf-8');
    expect(page).toContain('# IMixin <Badge type="tip" class="api-badge api-badge-mixin" text="Mixin" />');
    // The breadcrumb carries what a metadata table would
    expect(page).toContain('<a href="/v2/docs/constructs-readme.html">constructs</a>.<wbr><strong>IMixin</strong>');
    expect(page).not.toContain('| **Module** |');
    expect(page).not.toContain('| **FQN** |');
    expect(page).toContain('## Methods');
    expect(page).toContain('<div class="member-row" id="applyto">');
    // A row of the hierarchy bar rather than a section of its own: the classes
    // carrying the mixin are the inverse of the interfaces it extends, so both
    // sit in one block.
    expect(page).toContain('<span class="chain-label">implemented by</span>');
  });

  test('implementor list links classes to their dedicated pages', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.IMixin.md'), 'utf-8');
    // Explicit `.html`: raw-HTML anchors are not rewritten by VitePress.
    expect(page).toContain('<a class="chain-item" href="/v2/docs/aws-cdk-lib.Mixin.html">Mixin</a>');
  });

  test('a behavioral interface is badged Interface, not Mixin', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.IBucket.md'), 'utf-8');
    expect(page).not.toContain('text="Mixin"');
    expect(page).toContain('text="Interface"');
  });

  test('marker interfaces get a plain interface page, not a mixin page', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.IDependable.md'), 'utf-8');
    expect(page).not.toContain('text="Mixin"');
    expect(page).toContain('text="Interface"');
  });

  test('a class-based mixin page badges itself Mixin, not Class', () => {
    // The grouping and the page have to agree: a reader who clicks a mixin
    // out of the sidebar's Mixins group must not land on a page badged
    // `Class`. The page is still the CLASS template — a mixin class has
    // constructors, properties and methods to document — so only the badge
    // follows the classification.
    const page = readFileSync(
      join(outDir, 'docs', 'aws-cdk-lib.aws_s3.mixins.BucketAutoDeleteObjects.md'),
      'utf-8',
    );
    expect(page).toContain('<Badge type="tip" class="api-badge api-badge-mixin" text="Mixin" />');
    expect(page).not.toContain('text="Class"');
    // Same badge COLOR as an interface mixin's page, or the sidebar's
    // Mixins group renders one kind as two differently-colored badges.
    const ifacePage = readFileSync(join(outDir, 'docs', 'constructs.IMixin.md'), 'utf-8');
    expect(ifacePage).toContain('<Badge type="tip" class="api-badge api-badge-mixin" text="Mixin" />');
    // Still the class template, not the interface-shaped mixin page.
    expect(page).not.toContain('implemented by');

    // A plain (non-construct) class in the same build keeps the Class badge.
    const duration = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.Duration.md'), 'utf-8');
    expect(duration).toContain('<Badge type="info" class="api-badge" text="Class" />');
    expect(duration).not.toContain('text="Mixin"');
  });

  test('type tables link mixins with Mixin kind and structs with Struct kind', () => {
    const constructsPage = readFileSync(join(outDir, 'docs', 'constructs-readme.md'), 'utf-8');
    expect(constructsPage).toContain('[`IMixin`](/v2/docs/constructs.IMixin) | Mixin |');
    const s3Page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3-readme.md'), 'utf-8');
    expect(s3Page).toContain('[`IBucket`](/v2/docs/aws-cdk-lib.aws_s3.IBucket) | Interface |');
    expect(s3Page).toContain('[`BucketProps`](/v2/docs/aws-cdk-lib.aws_s3.BucketProps) | Struct |');
  });
});
