import * as spec from '@jsii/spec';
import { buildFacadeIndex, buildTraitIndex } from '../src/docgen/classification.js';
import { buildTypeIndex } from '../src/docgen/constructs.js';

/**
 * Fixture assembly for one service, modeled on aws_s3 in the real
 * aws-cdk-lib: a construct (`Bucket`), its behavioral interface
 * (`IBucket`), its reference interface (`IBucketRef`), a props struct,
 * an enum, a facade (`BucketGrants` with the guideline's static
 * factory pattern), and a trait pair (`IResourceWithPolicyV2` +
 * `IResourcePolicyFactory` wrapping `CfnResource`).
 */

const ASM = 'testlib';

function classType(name: string, extra: Partial<spec.ClassType> = {}): spec.ClassType {
  return {
    assembly: ASM,
    fqn: `${ASM}.${name}`,
    kind: spec.TypeKind.Class,
    name,
    ...extra,
  } as spec.ClassType;
}

function interfaceType(name: string, extra: Partial<spec.InterfaceType> = {}): spec.InterfaceType {
  return {
    assembly: ASM,
    fqn: `${ASM}.${name}`,
    kind: spec.TypeKind.Interface,
    name,
    ...extra,
  } as spec.InterfaceType;
}

function enumType(name: string): spec.EnumType {
  return {
    assembly: ASM,
    fqn: `${ASM}.${name}`,
    kind: spec.TypeKind.Enum,
    members: [{ name: 'A' }],
    name,
  } as spec.EnumType;
}

const constructBase: spec.ClassType = {
  assembly: 'constructs',
  fqn: 'constructs.Construct',
  kind: spec.TypeKind.Class,
  name: 'Construct',
} as spec.ClassType;

const cfnResource = classType('CfnResource');

const bucket = classType('Bucket', { base: 'constructs.Construct' });

const bucketRef = interfaceType('IBucketRef');

const iBucket = interfaceType('IBucket', { interfaces: [`${ASM}.IBucketRef`] });

const bucketProps = interfaceType('BucketProps', { datatype: true });

const bucketEncryption = enumType('BucketEncryption');

/** Guideline facade shape: static from{Resource}(I{Resource}Ref) -> self. */
const bucketGrants = classType('BucketGrants', {
  methods: [
    {
      name: 'fromBucket',
      parameters: [{ name: 'bucket', type: { fqn: `${ASM}.IBucketRef` } }],
      returns: { type: { fqn: `${ASM}.BucketGrants` } },
      static: true,
    },
  ],
});

/** Trait interface: capability contract produced by the factory. */
const resourceWithPolicy = interfaceType('IResourceWithPolicyV2');

/** Trait factory: forResource(CfnResource) -> trait interface. */
const policyFactory = interfaceType('IResourcePolicyFactory', {
  methods: [
    {
      name: 'forResource',
      parameters: [{ name: 'resource', type: { fqn: `${ASM}.CfnResource` } }],
      returns: { type: { fqn: `${ASM}.IResourceWithPolicyV2` } },
    },
  ],
});

function assemblyWith(types: spec.Type[]): spec.Assembly[] {
  const byFqn: Record<string, spec.Type> = {};
  for (const t of types) {
    byFqn[t.fqn] = t;
  }
  return [
    { name: ASM, types: byFqn } as unknown as spec.Assembly,
    { name: 'constructs', types: { [constructBase.fqn]: constructBase } } as unknown as spec.Assembly,
  ];
}

const fixture = [
  cfnResource, bucket, bucketRef, iBucket, bucketProps, bucketEncryption,
  bucketGrants, resourceWithPolicy, policyFactory,
];

describe('buildFacadeIndex', () => {
  const index = buildTypeIndex(assemblyWith(fixture));
  const facades = buildFacadeIndex(index);

  test('classifies the guideline factory pattern as a facade', () => {
    expect(facades.has(`${ASM}.BucketGrants`)).toBe(true);
  });

  test('exactly one facade in the fixture', () => {
    expect([...facades]).toEqual([`${ASM}.BucketGrants`]);
  });

  test('the construct itself is not a facade even with a matching factory', () => {
    // A construct-shaped `Bucket` carrying fromBucket(IBucketRef) must
    // stay a construct: facades live outside the construct hierarchy.
    const trap = classType('BucketThing', {
      base: 'constructs.Construct',
      methods: [
        {
          name: 'fromBucket',
          parameters: [{ name: 'bucket', type: { fqn: `${ASM}.IBucketRef` } }],
          returns: { type: { fqn: `${ASM}.BucketThing` } },
          static: true,
        },
      ],
    });
    const got = buildFacadeIndex(buildTypeIndex(assemblyWith([...fixture, trap])));
    expect(got.has(`${ASM}.BucketThing`)).toBe(false);
  });

  test('a static factory whose name does not prefix the class is not a facade', () => {
    // ViewerCertificate.fromAcmCertificate(...) in the real assembly:
    // returns itself but is a config value object, not a facade.
    const viewer = classType('ViewerCertificate', {
      methods: [
        {
          name: 'fromBucket',
          parameters: [{ name: 'bucket', type: { fqn: `${ASM}.IBucketRef` } }],
          returns: { type: { fqn: `${ASM}.ViewerCertificate` } },
          static: true,
        },
      ],
    });
    const got = buildFacadeIndex(buildTypeIndex(assemblyWith([...fixture, viewer])));
    expect(got.has(`${ASM}.ViewerCertificate`)).toBe(false);
  });

  test('the bare resource name is never a facade', () => {
    // `Bucket.fromBucket(IBucketRef)` shape on a non-construct class:
    // {Resource}{Feature} requires a feature suffix.
    const bare = classType('Queue', {
      methods: [
        {
          name: 'fromQueue',
          parameters: [{ name: 'queue', type: { fqn: `${ASM}.IQueueRef` } }],
          returns: { type: { fqn: `${ASM}.Queue` } },
          static: true,
        },
      ],
    });
    const queueRef = interfaceType('IQueueRef');
    const got = buildFacadeIndex(buildTypeIndex(assemblyWith([...fixture, bare, queueRef])));
    expect(got.has(`${ASM}.Queue`)).toBe(false);
  });

  test('a factory accepting a non-Ref interface is not a facade', () => {
    const helper = classType('BucketHelper', {
      methods: [
        {
          name: 'fromBucket',
          parameters: [{ name: 'bucket', type: { fqn: `${ASM}.IBucket` } }],
          returns: { type: { fqn: `${ASM}.BucketHelper` } },
          static: true,
        },
      ],
    });
    const got = buildFacadeIndex(buildTypeIndex(assemblyWith([...fixture, helper])));
    expect(got.has(`${ASM}.BucketHelper`)).toBe(false);
  });
});

describe('buildTraitIndex', () => {
  const index = buildTypeIndex(assemblyWith(fixture));
  const traits = buildTraitIndex(index);

  test('classifies the trait factory and its produced interface', () => {
    expect(traits.has(`${ASM}.IResourcePolicyFactory`)).toBe(true);
    expect(traits.has(`${ASM}.IResourceWithPolicyV2`)).toBe(true);
  });

  test('exactly the trait pair in the fixture', () => {
    expect([...traits].sort()).toEqual([
      `${ASM}.IResourcePolicyFactory`,
      `${ASM}.IResourceWithPolicyV2`,
    ]);
  });

  test('ordinary construct interfaces are not traits', () => {
    expect(traits.has(`${ASM}.IBucket`)).toBe(false);
    expect(traits.has(`${ASM}.IBucketRef`)).toBe(false);
  });

  test('props structs and enums are never traits', () => {
    expect(traits.has(`${ASM}.BucketProps`)).toBe(false);
    expect(traits.has(`${ASM}.BucketEncryption`)).toBe(false);
  });

  test('a factory-shaped method returning a struct is not a trait pair', () => {
    const structFactory = interfaceType('IStructFactory', {
      methods: [
        {
          name: 'forResource',
          parameters: [{ name: 'resource', type: { fqn: `${ASM}.CfnResource` } }],
          returns: { type: { fqn: `${ASM}.BucketProps` } },
        },
      ],
    });
    const got = buildTraitIndex(buildTypeIndex(assemblyWith([...fixture, structFactory])));
    expect(got.has(`${ASM}.IStructFactory`)).toBe(false);
    expect(got.has(`${ASM}.BucketProps`)).toBe(false);
  });

  test('a wrapper taking a non-CfnResource parameter is not a trait factory', () => {
    const other = interfaceType('IOtherFactory', {
      methods: [
        {
          name: 'forResource',
          parameters: [{ name: 'bucket', type: { fqn: `${ASM}.IBucket` } }],
          returns: { type: { fqn: `${ASM}.IResourceWithPolicyV2` } },
        },
      ],
    });
    const got = buildTraitIndex(buildTypeIndex(assemblyWith([...fixture, other])));
    expect(got.has(`${ASM}.IOtherFactory`)).toBe(false);
  });
});
