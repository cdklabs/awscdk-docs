import * as spec from '@jsii/spec';
import type { TypeIndex } from './constructs.js';

/** Base class FQN -> FQNs of every class that extends it, FQN-sorted. */
export type SubclassIndex = Map<string, string[]>;


const indexes = new WeakMap<TypeIndex, SubclassIndex>();

/**
 * Reverse of the hierarchy bar: every class mapped to its transitive
 * descendants.
 *
 * `renderInheritanceChain` only walks *upward* through `type.base`, so
 * this is the one downward pass. Built once per `TypeIndex` and cached on
 * it (like {@link interfaceClosures}), since otherwise every one of the
 * 3,244 class pages would rebuild the whole map.
 *
 * Descendants are transitive and merged rather than split into direct and
 * indirect: the reader of a base-class page wants to know which types they
 * can reach, and each subclass's own page already shows its exact depth in
 * the hierarchy bar.
 */
export function buildSubclassIndex(index: TypeIndex): SubclassIndex {
  const existing = indexes.get(index);
  if (existing) {
    return existing;
  }

  // Direct edges first, so the transitive walk never re-scans the corpus.
  const direct = new Map<string, string[]>();
  for (const [fqn, entry] of index) {
    if (!spec.isClassType(entry.type) || !entry.type.base) {
      continue;
    }
    const siblings = direct.get(entry.type.base);
    if (siblings) {
      siblings.push(fqn);
    } else {
      direct.set(entry.type.base, [fqn]);
    }
  }

  const closures = new Map<string, Set<string>>();
  const descendantsOf = (fqn: string, seen: Set<string>): Set<string> => {
    const cached = closures.get(fqn);
    if (cached) {
      return cached;
    }
    if (seen.has(fqn)) {
      return new Set(); // cycle guard: a malformed assembly must not hang the build
    }
    seen.add(fqn);
    const out = new Set<string>();
    for (const child of direct.get(fqn) ?? []) {
      out.add(child);
      for (const deep of descendantsOf(child, seen)) {
        out.add(deep);
      }
    }
    seen.delete(fqn);
    closures.set(fqn, out);
    return out;
  };

  const subclasses: SubclassIndex = new Map();
  for (const base of direct.keys()) {
    // A class that is its own ancestor comes back inside its own closure,
    // so drop it: `S extends S` has no subclasses, it is not its own.
    const list = [...descendantsOf(base, new Set())].filter((fqn) => fqn !== base);
    if (list.length > 0) {
      // Sorted by FQN, never by traversal order, so the generated pages
      // are byte-stable across runs.
      subclasses.set(base, list.sort());
    }
  }

  indexes.set(index, subclasses);
  return subclasses;
}
