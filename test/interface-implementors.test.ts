import * as spec from '@jsii/spec';
import { buildTypeIndex } from '../src/docgen/constructs.js';
import { buildMixinClassification } from '../src/docgen/mixins.js';
import { renderInterfacePage } from '../src/docgen/symbols.js';

/**
 * Interface pages must say who implements them. The corpus
 * walk that answers this already existed — `buildMixinIndex` built a full
 * `implementors` map and then dropped every interface that is not a mixin
 * — so these tests pin both halves: that the index is exposed, and that
 * the interface page renders it.
 */
describe('interface implementors', () => {
  const linkFor = (fqn: string) => `/v2/docs/${fqn}`;

  const iface = (name: string, parents: string[] = [], extra: Partial<spec.InterfaceType> = {}): spec.InterfaceType => ({
    fqn: `lib.${name}`,
    kind: spec.TypeKind.Interface,
    name,
    assembly: 'lib',
    ...(parents.length > 0 ? { interfaces: parents } : {}),
    ...extra,
  } as spec.InterfaceType);

  const klass = (name: string, extra: Partial<spec.ClassType> = {}): spec.ClassType => ({
    fqn: `lib.${name}`,
    kind: spec.TypeKind.Class,
    name,
    assembly: 'lib',
    ...extra,
  } as spec.ClassType);

  const assemblyOf = (types: Record<string, spec.Type>) =>
    ({ name: 'lib', types } as unknown as spec.Assembly);

  const pageFor = (target: spec.InterfaceType, types: Record<string, spec.Type>) => {
    const assembly = assemblyOf(types);
    const index = buildTypeIndex([assembly]);
    const { implementors } = buildMixinClassification(index);
    return renderInterfacePage({
      type: target,
      assembly,
      index,
      usage: { propsUsers: new Map(), enumRefs: new Map() },
      linkFor,
      implementors,
    });
  };

  test('the classification exposes implementors for ordinary interfaces, not only mixins', () => {
    // No IMixin marker exists in this fixture at all, so the mixin index
    // is empty — the implementors map must still be populated.
    const types = {
      'lib.IThing': iface('IThing'),
      'lib.Thing': klass('Thing', { interfaces: ['lib.IThing'] }),
    };
    const { mixins, implementors } = buildMixinClassification(buildTypeIndex([assemblyOf(types)]));
    expect(mixins.size).toBe(0);
    expect(implementors.get('lib.IThing')).toEqual(['lib.Thing']);
  });

  test('an interface page lists its direct implementors, linked', () => {
    const target = iface('IThing');
    const page = pageFor(target, {
      'lib.IThing': target,
      'lib.Thing': klass('Thing', { interfaces: ['lib.IThing'] }),
    });
    // The relation is a row of the hierarchy bar now, not a section
    // — same fact, one idiom with `extends`.
    expect(page).toContain('<span class="chain-label">implemented by</span>');
    // Explicit `.html`: VitePress rewrites extensionless links only in
    // markdown, so a raw-HTML anchor must carry the extension itself.
    expect(page).toContain('<a class="chain-item" href="/v2/docs/lib.Thing.html">Thing</a>');
  });

  test('transitive implementors count — the reported IBucketRef shape', () => {
    // Bucket -> BucketBase implements IBucket, IBucket extends IBucketRef.
    // Nothing names IBucketRef as implemented, but Bucket does implement it.
    const ref = iface('IBucketRef');
    const page = pageFor(ref, {
      'lib.IBucketRef': ref,
      'lib.IBucket': iface('IBucket', ['lib.IBucketRef']),
      'lib.BucketBase': klass('BucketBase', { interfaces: ['lib.IBucket'] }),
      'lib.Bucket': klass('Bucket', { base: 'lib.BucketBase' }),
    });
    expect(page).toContain('<span class="chain-label">implemented by</span>');
    expect(page).toContain('>Bucket</a>');
    expect(page).toContain('>BucketBase</a>');
  });

  test('an interface nobody implements renders no section at all', () => {
    const lonely = iface('ILonely');
    const page = pageFor(lonely, { 'lib.ILonely': lonely });
    expect(page).not.toContain('implemented by');
  });

  test('implementors are FQN-sorted so output does not depend on walk order', () => {
    const target = iface('IThing');
    const page = pageFor(target, {
      'lib.IThing': target,
      'lib.Zebra': klass('Zebra', { interfaces: ['lib.IThing'] }),
      'lib.Apple': klass('Apple', { interfaces: ['lib.IThing'] }),
      'lib.Mango': klass('Mango', { interfaces: ['lib.IThing'] }),
    });
    const order = ['Apple', 'Mango', 'Zebra'].map((n) => page.indexOf(`>${n}</a>`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i > -1)).toBe(true);
  });

  test('a high-cardinality interface is capped with a count rather than thousands of links', () => {
    // Measured against the real corpus: 7 interfaces have >100
    // implementors (IDependable 2305, IConstruct 2302), while 1720 have
    // exactly one. The cap exists for those 7 pages.
    const target = iface('IPopular');
    const types: Record<string, spec.Type> = { 'lib.IPopular': target };
    for (let i = 0; i < 120; i++) {
      const name = `C${String(i).padStart(3, '0')}`;
      types[`lib.${name}`] = klass(name, { interfaces: ['lib.IPopular'] });
    }
    const page = pageFor(target, types);
    // Truncation is the row's two-line width budget, not a fixed link count.
    // What must not regress is that a huge relation is truncated at all and
    // says so: these pages would otherwise render every one of thousands of
    // links inline.
    const visible = page.slice(0, page.indexOf('<details'));
    const shown = (visible.match(/class="chain-item"/g) ?? []).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(40);
    expect(page).toMatch(/\d+ more<\/summary>/);
    // Nothing is lost: the remainder is behind the disclosure, not dropped.
    const all = (page.match(/class="chain-item"/g) ?? []).length;
    expect(all).toBe(120);
  });

  test('an implementor in another submodule still resolves to a link', () => {
    const target = iface('IThing');
    const other = klass('Other', { interfaces: ['lib.IThing'] });
    const page = pageFor(target, {
      'lib.IThing': target,
      'lib.sub.Other': { ...other, fqn: 'lib.sub.Other', namespace: 'sub' } as spec.ClassType,
    });
    expect(page).toContain('/v2/docs/lib.sub.Other');
  });
});
