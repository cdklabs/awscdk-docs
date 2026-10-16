import * as spec from '@jsii/spec';
import { buildTypeIndex, renderConstructPage } from '../src/docgen/constructs.js';
import { buildSubclassIndex } from '../src/docgen/subclasses.js';
import { renderClassPage } from '../src/docgen/symbols.js';

/**
 * Class pages must list the classes that extend them — the reverse of the
 * hierarchy bar, which only ever walks upward.
 *
 * The cases that matter: a base with thousands of descendants has to
 * truncate honestly, and the worst two (`Construct`, `Resource`) are
 * constructs, so they
 * render through a different renderer than an ordinary class.
 */
describe('class subclasses', () => {
  const linkFor = (fqn: string) => `/v2/docs/${fqn}`;

  const klass = (
    name: string,
    base?: string,
    extra: Partial<spec.ClassType> = {},
    assembly = 'lib',
  ): spec.ClassType => ({
    fqn: `${assembly}.${name}`,
    kind: spec.TypeKind.Class,
    name,
    assembly,
    ...(base ? { base } : {}),
    ...extra,
  } as spec.ClassType);

  const assemblyOf = (name: string, types: Record<string, spec.Type>) =>
    ({ name, types } as unknown as spec.Assembly);

  const indexOf = (...assemblies: spec.Assembly[]) => buildTypeIndex(assemblies);

  const pageFor = (target: spec.ClassType, ...assemblies: spec.Assembly[]) => {
    const index = indexOf(...assemblies);
    return renderClassPage({
      type: target,
      assembly: assemblies[0],
      index,
      usage: { propsUsers: new Map(), enumRefs: new Map() },
      linkFor,
      subclasses: buildSubclassIndex(index),
    });
  };

  test('a direct subclass is indexed and linked on the base class page', () => {
    const base = klass('Base');
    const page = pageFor(base, assemblyOf('lib', {
      'lib.Base': base,
      'lib.Derived': klass('Derived', 'lib.Base'),
    }));
    // `superclass of` is a row of the hierarchy bar, not a section of its
    // own, so a class's two directions of inheritance sit in one block
    // instead of two idioms a page apart.
    expect(page).toContain('<span class="chain-label">superclass of</span>');
    // The `.html` suffix is REQUIRED now: VitePress rewrites extensionless
    // markdown links but leaves raw HTML anchors alone, so these must carry
    // the canonical page href or every subclass link 404s.
    expect(page).toContain('<a class="chain-item" href="/v2/docs/lib.Derived.html">Derived</a>');
    expect(page).toContain('<div class="chain-row">');
  });

  test('descendants are transitive, so a grandchild appears under the root base', () => {
    const types = {
      'lib.Base': klass('Base'),
      'lib.Middle': klass('Middle', 'lib.Base'),
      'lib.Leaf': klass('Leaf', 'lib.Middle'),
    };
    const subclasses = buildSubclassIndex(indexOf(assemblyOf('lib', types)));
    expect(subclasses.get('lib.Base')).toEqual(['lib.Leaf', 'lib.Middle']);
    expect(subclasses.get('lib.Middle')).toEqual(['lib.Leaf']);
  });

  test('a leaf class with no subclasses renders no section at all', () => {
    const leaf = klass('Leaf');
    const page = pageFor(leaf, assemblyOf('lib', { 'lib.Leaf': leaf }));
    expect(page).not.toContain('superclass of');
  });

  test('a subclass from another package resolves to a link', () => {
    const base = klass('Base');
    const page = pageFor(
      base,
      assemblyOf('lib', { 'lib.Base': base }),
      assemblyOf('other', { 'other.Far': klass('Far', 'lib.Base', {}, 'other') }),
    );
    expect(page).toContain('<a class="chain-item" href="/v2/docs/other.Far.html">Far</a>');
  });

  test('the index is FQN-sorted rather than traversal-ordered', () => {
    const types = {
      'lib.Base': klass('Base'),
      'lib.Zebra': klass('Zebra', 'lib.Base'),
      'lib.Apple': klass('Apple', 'lib.Base'),
      'lib.Mango': klass('Mango', 'lib.Base'),
    };
    expect(buildSubclassIndex(indexOf(assemblyOf('lib', types))).get('lib.Base'))
      .toEqual(['lib.Apple', 'lib.Mango', 'lib.Zebra']);
  });

  test('over the cap, only the first few are listed and the rest go behind a disclosure carrying the honest total', () => {
    const base = klass('Base');
    const types: Record<string, spec.Type> = { 'lib.Base': base };
    for (let i = 0; i < 40; i++) {
      const name = `Sub${String(i).padStart(3, '0')}`;
      types[`lib.${name}`] = klass(name, 'lib.Base');
    }
    const page = pageFor(base, assemblyOf('lib', types));

    // How many show is the row's two-line width budget rather than a fixed
    // item count, so this asserts the property that matters —
    // the row IS truncated, it says how much it hid, and nothing is lost —
    // and not an exact split that the budget is free to change.
    // Scoped to the row: `chain-item` is shared with the breadcrumb.
    const row = page.slice(page.indexOf('<span class="chain-label">superclass of'));
    const [beforeDisclosure] = row.split('<details');
    const shown = (beforeDisclosure.match(/<a class="chain-item"/g) ?? []).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(40);
    expect(page).toMatch(new RegExp(`<summary[^>]*>${40 - shown} more</summary>`));
    // ...and every remaining entry is inside the disclosure, so nothing is lost.
    expect((row.match(/<a class="chain-item"/g) ?? []).length).toBe(40);
    expect(page).toContain('</details>');
  });

  test('a construct base class gets the section too, since Construct and Resource are constructs', () => {
    // The two pages the issue names by name do not go through
    // renderClassPage: isConstruct routes them to renderConstructPage, so
    // wiring only the ordinary class renderer would leave exactly the
    // pages this issue is about with no subclass list.
    const iconstruct: spec.InterfaceType = {
      fqn: 'constructs.IConstruct',
      kind: spec.TypeKind.Interface,
      name: 'IConstruct',
      assembly: 'constructs',
    } as spec.InterfaceType;
    const base = klass('Construct', undefined, { interfaces: ['constructs.IConstruct'] }, 'constructs');
    const assembly = assemblyOf('constructs', {
      'constructs.IConstruct': iconstruct,
      'constructs.Construct': base,
      'constructs.Thing': klass('Thing', 'constructs.Construct', {}, 'constructs'),
    });
    const index = indexOf(assembly);
    const page = renderConstructPage({
      type: base,
      assembly,
      index,
      linkFor,
      subclasses: buildSubclassIndex(index),
    });
    expect(page).toContain('<span class="chain-label">superclass of</span>');
    expect(page).toContain('<a class="chain-item" href="/v2/docs/constructs.Thing.html">Thing</a>');
    // Both directions are rows of ONE block, so there is no second container
    // to keep in sync.
    expect(page).toContain('<nav class="inheritance-chain"');
    expect(page).toContain('<div class="chain-row">');
  });

  test('the index is memoized per type index, which is what makes the pass affordable', () => {
    // The ADR rests on this: without the cache each of the 3,244 class
    // pages would rebuild the whole map. Dropping the WeakMap leaves every
    // other test in this file green, so pin identity directly.
    const index = indexOf(assemblyOf('lib', {
      'lib.Base': klass('Base'),
      'lib.Derived': klass('Derived', 'lib.Base'),
    }));
    expect(buildSubclassIndex(index)).toBe(buildSubclassIndex(index));
  });

  describe('a class that is its own ancestor', () => {
    test('does not list itself as its own subclass', () => {
      const self = klass('SelfRef', 'lib.SelfRef');
      // Reaching the guard at all is the point: the walk must terminate,
      // and a class is not its own descendant, so it gets no entry.
      //
      // Deliberately asserts on the index only, never by rendering the
      // page: `renderInheritanceChain` walks `type.base` upward with no
      // cycle guard, so rendering a self-inheriting class spins forever.
      // That is a pre-existing defect in a different function and out of
      // scope here — see the PR discussion.
      expect(buildSubclassIndex(indexOf(assemblyOf('lib', { 'lib.SelfRef': self }))).get('lib.SelfRef')).toBeUndefined();
    });

    test('a two-class cycle yields each other and never itself', () => {
      const subclasses = buildSubclassIndex(indexOf(assemblyOf('lib', {
        'lib.A': klass('A', 'lib.B'),
        'lib.B': klass('B', 'lib.A'),
      })));
      expect(subclasses.get('lib.A')).toEqual(['lib.B']);
      expect(subclasses.get('lib.B')).toEqual(['lib.A']);
    });
  });
});
