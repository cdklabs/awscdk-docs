import * as spec from '@jsii/spec';
import type { TypeIndex } from './constructs.js';

/** Per-index resolver cache; see {@link interfaceClosures}. */
const resolvers = new WeakMap<TypeIndex, (fqn: string) => Set<string>>();

/** A class's ancestor chain and the full set of interfaces it implements. */
export interface ClassLineage {
  /** Ancestors root-first, excluding the class itself. */
  readonly ancestors: string[];
  /** Every interface the class implements, transitively, FQN-sorted. */
  readonly interfaces: string[];
}

/**
 * One upward walk of a class, producing both the breadcrumb ancestors and
 * the interface set — the two things every view of a class's position in
 * the hierarchy needs.
 *
 * The hierarchy bar and the reverse implementers index share this walk so
 * they stay exact inverses: the bar credits `Bucket` with `IBucket` even
 * though `BucketBase` declares it, so `IBucket` must list `Bucket` among
 * its implementers or the two pages contradict each other.
 *
 * Interfaces are sorted so the rendered list does not depend on build
 * order, and closed over transitively: an interface's own `extends` chain
 * counts, so `Bucket` reports `IBucketRef` (reachable through `IBucket`)
 * rather than silently dropping it.
 */
export function classLineage(type: spec.ClassType, index: TypeIndex): ClassLineage {
  const ancestors: string[] = [];
  const declared = new Set<string>(type.interfaces ?? []);
  let current = type.base;
  while (current) {
    ancestors.unshift(current);
    const entry = index.get(current);
    if (entry && spec.isClassType(entry.type)) {
      for (const iface of entry.type.interfaces ?? []) {
        declared.add(iface);
      }
      current = entry.type.base;
    } else {
      current = undefined;
    }
  }
  const closureOf = interfaceClosures(index);
  const interfaceSet = new Set<string>();
  for (const iface of declared) {
    for (const fqn of closureOf(iface)) {
      interfaceSet.add(fqn);
    }
  }
  return { ancestors, interfaces: [...interfaceSet].sort() };
}

/**
 * Memoized, cycle-guarded transitive closure of an interface and the
 * interfaces it extends, including the interface itself.
 *
 * Lives in its own module because both the mixin classification rules and
 * the type-page inheritance bar need it, and `mixins.ts` already imports
 * `layout.ts` — so neither could own it without creating an import cycle.
 *
 * The resolver, and therefore its memo, is cached per `TypeIndex` so
 * repeated calls hand back the same one. The inheritance bar resolves
 * closures once per type page; with a fresh memo each time, all ~3,200
 * class pages would re-walk the same shared interfaces (`IResource`,
 * `IConstruct`, `IDependable`) from scratch.
 */
export function interfaceClosures(index: TypeIndex): (fqn: string) => Set<string> {
  const existing = resolvers.get(index);
  if (existing) {
    return existing;
  }
  const closures = new Map<string, Set<string>>();
  const closureOf = (fqn: string): Set<string> => {
    const cached = closures.get(fqn);
    if (cached) {
      return cached;
    }
    const closure = new Set<string>([fqn]);
    closures.set(fqn, closure); // set before recursing to guard against cycles
    const entry = index.get(fqn);
    if (entry && spec.isInterfaceType(entry.type)) {
      for (const parent of entry.type.interfaces ?? []) {
        for (const p of closureOf(parent)) {
          closure.add(p);
        }
      }
    }
    return closure;
  };
  resolvers.set(index, closureOf);
  return closureOf;
}
