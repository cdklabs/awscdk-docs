import * as spec from '@jsii/spec';
import type { TypeIndex } from '../src/docgen/constructs.js';
import { interfaceClosures } from '../src/docgen/interfaces.js';

const assembly = { name: 'fixture' } as spec.Assembly;

const iface = (fqn: string, extendsFqns?: string[]): spec.InterfaceType => ({
  kind: spec.TypeKind.Interface,
  fqn,
  name: fqn.split('.').pop()!,
  assembly: 'fixture',
  interfaces: extendsFqns,
} as unknown as spec.InterfaceType);

const klass = (fqn: string): spec.ClassType => ({
  kind: spec.TypeKind.Class,
  fqn,
  name: fqn.split('.').pop()!,
  assembly: 'fixture',
} as unknown as spec.ClassType);

const buildIndex = (types: spec.Type[]): TypeIndex =>
  new Map(types.map((type) => [type.fqn, { type, assembly }]));

describe('interfaceClosures', () => {
  test('includes the interface itself and everything it extends, transitively', () => {
    const closureOf = interfaceClosures(buildIndex([
      iface('fixture.IBucketRef'),
      iface('fixture.IResource'),
      iface('fixture.IBucket', ['fixture.IResource', 'fixture.IBucketRef']),
    ]));
    expect([...closureOf('fixture.IBucket')].sort()).toEqual([
      'fixture.IBucket',
      'fixture.IBucketRef',
      'fixture.IResource',
    ]);
  });

  test('follows more than one level of extends', () => {
    const closureOf = interfaceClosures(buildIndex([
      iface('fixture.IRoot'),
      iface('fixture.IMiddle', ['fixture.IRoot']),
      iface('fixture.ILeaf', ['fixture.IMiddle']),
    ]));
    expect([...closureOf('fixture.ILeaf')].sort()).toEqual([
      'fixture.ILeaf',
      'fixture.IMiddle',
      'fixture.IRoot',
    ]);
  });

  test('terminates on a cycle rather than recursing forever', () => {
    // A malformed or self-referential assembly must not hang the build.
    const closureOf = interfaceClosures(buildIndex([
      iface('fixture.IA', ['fixture.IB']),
      iface('fixture.IB', ['fixture.IA']),
    ]));
    expect([...closureOf('fixture.IA')].sort()).toEqual(['fixture.IA', 'fixture.IB']);
  });

  test('an unknown or non-interface fqn closes over just itself', () => {
    const closureOf = interfaceClosures(buildIndex([klass('fixture.Bucket')]));
    expect([...closureOf('fixture.Bucket')]).toEqual(['fixture.Bucket']);
    expect([...closureOf('fixture.NotInTheIndex')]).toEqual(['fixture.NotInTheIndex']);
  });

  test('the resolver is cached per index, so a per-type caller still shares one memo', () => {
    // The inheritance bar resolves closures once per type page. If each
    // call allocated a fresh memo, every class page would re-walk the same
    // shared interfaces from scratch.
    const index = buildIndex([iface('fixture.IParent'), iface('fixture.IChild', ['fixture.IParent'])]);
    expect(interfaceClosures(index)).toBe(interfaceClosures(index));
    // A different index gets its own resolver.
    expect(interfaceClosures(index)).not.toBe(interfaceClosures(buildIndex([iface('fixture.IOther')])));
  });

  test('memoizes: the same resolver returns the identical set for a repeat lookup', () => {
    const closureOf = interfaceClosures(buildIndex([
      iface('fixture.IParent'),
      iface('fixture.IChild', ['fixture.IParent']),
    ]));
    expect(closureOf('fixture.IChild')).toBe(closureOf('fixture.IChild'));
  });
});
