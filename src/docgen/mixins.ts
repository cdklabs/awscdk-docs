import * as spec from '@jsii/spec';
import { anchoredHeading, SECTION_ANCHORS } from './anchors.js';
import {
  typeMetadataRows,
  TypeIndex,
} from './constructs.js';
import { PageHistory } from './history.js';
import { classLineage, interfaceClosures } from './interfaces.js';
import {
  DEFAULT_LANGUAGE,
  Language,
} from './languages.js';
import {
  renderDescription,
  renderExpandableProps,
  renderExtendsBar,
  renderMethodsSection,
  renderTypeMetadata,
} from './layout.js';
import { weightedTitle } from './search.js';

/**
 * Mixin FQN -> FQNs of classes implementing it, sorted.
 *
 * A mixin is a non-datatype interface whose interface closure contains the CDK `IMixin` marker interface — directly
 * or transitively through interface inheritance — and that is implemented by at least one class, directly, through
 * interface inheritance, or via the base-class chain.
 */
export type MixinIndex = Map<string, string[]>;

/**
 * Interface FQN -> FQNs of every type implementing it, sorted.
 *
 * Same shape as {@link MixinIndex} but unfiltered: covers every interface in the corpus rather than only
 * mixin-marked ones, which is what interface pages need.
 */
export type ImplementorsIndex = Map<string, string[]>;

/** Short name of the CDK mixin marker interface (e.g. `constructs.IMixin`). */
const MIXIN_MARKER_NAME = 'IMixin';

/**
 * Resolve the FQN(s) of the `IMixin` marker interface from the loaded
 * assemblies. Resolved at build time rather than hard-coded so the rule
 * follows the marker wherever it lives (currently `constructs.IMixin`).
 */
export function resolveMixinMarkerFqns(index: TypeIndex): Set<string> {
  const markers = new Set<string>();
  for (const { type } of index.values()) {
    if (spec.isInterfaceType(type) && !type.datatype && type.name === MIXIN_MARKER_NAME) {
      markers.add(type.fqn);
    }
  }
  return markers;
}

/**
 * The two inputs both mixin rules need: the resolved marker FQNs and one
 * memoized closure resolver. Built once and shared so computing both
 * classifications walks the interface graph a single time.
 */
interface MixinRuleContext {
  readonly markers: ReadonlySet<string>;
  readonly closureOf: (fqn: string) => Set<string>;
  /**
   * The corpus-wide implementors walk, computed once and shared: the mixin index filters it to marked interfaces and
   * interface pages consume all of it, so building it per consumer would walk the whole corpus twice.
   */
  readonly implementors: Map<string, Set<string>>;
}

function mixinRuleContext(index: TypeIndex): MixinRuleContext {
  const closureOf = interfaceClosures(index);
  return {
    markers: resolveMixinMarkerFqns(index),
    closureOf,
    implementors: buildImplementorsIndex(index),
  };
}

/**
 * Both mixin classifications, sharing one marker resolution and one
 * closure memo. Prefer this over calling the two rules separately, which
 * scans for the marker twice and walks the interface graph twice.
 */
export function buildMixinClassification(
  index: TypeIndex,
): { readonly mixins: MixinIndex; readonly mixinClasses: Set<string>; readonly implementors: ImplementorsIndex } {
  const context = mixinRuleContext(index);
  const implementors = new Map<string, string[]>();
  for (const [fqn, classes] of context.implementors) {
    implementors.set(fqn, [...classes].sort());
  }
  return {
    mixins: buildMixinIndex(index, context),
    mixinClasses: buildMixinClassIndex(index, context),
    implementors,
  };
}

/**
 * FQNs of classes that are mixins by virtue of their base class.
 *
 * The marker-interface rule only classifies interfaces, but a concrete mixin can be a class:
 * `aws_s3.mixins.BucketAutoDeleteObjects` extends the abstract `aws-cdk-lib.Mixin`, which carries
 * `constructs.IMixin`. Such a class's own `interfaces` list is empty, so it is not caught by the interface-keyed
 * {@link MixinIndex}.
 *
 * A class qualifies when its base-class chain reaches a type that implements the marker. Matching on the base chain
 * rather than the class itself excludes the mechanism: the abstract base implements the marker directly, so it is
 * not itself reported as a mixin a user could apply.
 */
export function buildMixinClassIndex(index: TypeIndex, context?: MixinRuleContext): Set<string> {
  const { markers, closureOf } = context ?? mixinRuleContext(index);
  const mixinClasses = new Set<string>();
  if (markers.size === 0) {
    return mixinClasses; // buildMixinIndex already warns about a missing marker
  }
  const carriesMarker = (type: spec.Type): boolean => {
    if (!spec.isClassType(type) && !spec.isInterfaceType(type)) {
      return false;
    }
    for (const iface of type.interfaces ?? []) {
      for (const fqn of closureOf(iface)) {
        if (markers.has(fqn)) {
          return true;
        }
      }
    }
    return false;
  };

  for (const { type } of index.values()) {
    if (!spec.isClassType(type)) {
      continue;
    }
    // Start at the BASE, not at the type itself: a class implementing the
    // marker directly is the mechanism (the abstract base), not a mixin.
    let current = type.base;
    while (current) {
      const entry = index.get(current);
      if (!entry) {
        break;
      }
      if (carriesMarker(entry.type)) {
        mixinClasses.add(type.fqn);
        break;
      }
      current = spec.isClassType(entry.type) ? entry.type.base : undefined;
    }
  }
  return mixinClasses;
}

/**
 * Every interface each class implements, keyed by interface FQN: direct declarations, those of every class
 * ancestor, and the transitive interface `extends` closure of all of them.
 *
 * The mixin classification consumes a filtered view of this (mixins only), but interface pages need the whole thing,
 * so the walk is exposed rather than run twice. Values are FQN sets; callers sort.
 *
 * Takes no closure resolver: the lineage helper it delegates to holds the per-index resolver, so a caller cannot
 * pass a resolver built against a different index.
 */
export function buildImplementorsIndex(index: TypeIndex): Map<string, Set<string>> {
  const implementors = new Map<string, Set<string>>();
  for (const { type } of index.values()) {
    if (!spec.isClassType(type)) {
      continue;
    }
    // Interfaces implemented anywhere along the base-class chain count, closed over interface `extends`. Both come
    // from the shared lineage walk so the hierarchy bar's `implements` and this index cannot disagree about a class.
    for (const iface of classLineage(type, index).interfaces) {
      const set = implementors.get(iface) ?? new Set();
      set.add(type.fqn);
      implementors.set(iface, set);
    }
  }
  return implementors;
}

export function buildMixinIndex(index: TypeIndex, context?: MixinRuleContext): MixinIndex {
  const { markers, closureOf, implementors } = context ?? mixinRuleContext(index);

  const mixins: MixinIndex = new Map();
  if (markers.size === 0) {
    // Degrade visibly rather than silently classifying nothing.
    // eslint-disable-next-line no-console
    console.warn(
      `docgen: no \`${MIXIN_MARKER_NAME}\` marker interface found in the loaded assemblies; `
      + 'no types will be classified as mixins',
    );
    return mixins;
  }
  const isMixin = (fqn: string): boolean => {
    const closure = closureOf(fqn);
    for (const marker of markers) {
      if (closure.has(marker)) {
        return true;
      }
    }
    return false;
  };

  for (const [fqn, classes] of implementors) {
    const entry = index.get(fqn);
    if (!entry || !spec.isInterfaceType(entry.type) || entry.type.datatype) {
      continue;
    }
    if (!isMixin(fqn)) {
      continue; // ordinary behavioral interfaces (IBucket, IRole, ...) are not mixins
    }
    mixins.set(fqn, [...classes].sort());
  }
  return mixins;
}

/** Own methods plus those inherited from parent interfaces, sorted by name. */
export function collectMethods(iface: spec.InterfaceType, index: TypeIndex): spec.Method[] {
  const seen = new Map<string, spec.Method>();
  visitInterfaces(iface.fqn, index, (t) => {
    for (const method of t.methods ?? []) {
      if (!seen.has(method.name)) {
        seen.set(method.name, method);
      }
    }
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Own properties plus those inherited from parent interfaces, sorted by name. */
export function collectProperties(iface: spec.InterfaceType, index: TypeIndex): spec.Property[] {
  const seen = new Map<string, spec.Property>();
  visitInterfaces(iface.fqn, index, (t) => {
    for (const prop of t.properties ?? []) {
      if (!seen.has(prop.name)) {
        seen.set(prop.name, prop);
      }
    }
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function visitInterfaces(
  fqn: string,
  index: TypeIndex,
  fn: (iface: spec.InterfaceType) => void,
  seen: Set<string> = new Set(),
): void {
  if (seen.has(fqn)) {
    return;
  }
  seen.add(fqn);
  const entry = index.get(fqn);
  if (!entry || !spec.isInterfaceType(entry.type)) {
    return;
  }
  fn(entry.type);
  for (const parent of entry.type.interfaces ?? []) {
    visitInterfaces(parent, index, fn, seen);
  }
}

export interface MixinPageOptions {
  readonly type: spec.InterfaceType;
  readonly assembly: spec.Assembly;
  readonly index: TypeIndex;
  readonly mixins: MixinIndex;
  /** Resolves a type FQN to its dedicated-page link, if it has one. */
  readonly linkFor: (fqn: string) => string | undefined;
  /** Enabled documentation languages; variant regions embed one per language. */
  readonly languages?: readonly Language[];
  /** Version history of the type from the ledger; renders the `Type last changed` metadata row when known. */
  readonly history?: PageHistory;
}

/** Render a dedicated markdown page for one mixin. */
export function renderMixinPage(options: MixinPageOptions): string {
  const { type, assembly, index, mixins, linkFor } = options;
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  const lines: string[] = [`# ${weightedTitle(type.name)} <Badge type="tip" class="api-badge api-badge-mixin" text="Mixin" />`, ''];

  // Merged description: tagline + remarks, no `## Overview`.
  lines.push(...renderDescription(type));
  // Parent interfaces render in the hierarchy bar, and the classes carrying the mixin render as its
  // `implemented by` row rather than a section further down.
  lines.push(...renderExtendsBar(type, linkFor, mixins.get(type.fqn) ?? []));
  lines.push(...renderTypeMetadata(typeMetadataRows(type, assembly, index, linkFor, options.history)));

  lines.push(...renderMethods(type, index, linkFor, languages));
  lines.push(...renderProperties(type, index, linkFor, languages));

  return lines.join('\n');
}

function renderMethods(
  type: spec.InterfaceType,
  index: TypeIndex,
  linkFor: (fqn: string) => string | undefined,
  languages: readonly Language[],
): string[] {
  const methods = collectMethods(type, index);
  if (methods.length === 0) {
    return [];
  }
  // One renderer for both surfaces: a mixin's methods are the same member rows as a class's, so this delegates
  // rather than keeping a parallel copy that would drift.
  return renderMethodsSection(methods, linkFor, type.fqn, languages);
}

function renderProperties(
  type: spec.InterfaceType,
  index: TypeIndex,
  linkFor: (fqn: string) => string | undefined,
  languages: readonly Language[],
): string[] {
  const props = collectProperties(type, index);
  if (props.length === 0) {
    return [];
  }
  // Same delegation as renderMethods above: a mixin's properties are the same member rows as a class's.
  return [anchoredHeading(2, 'Properties', SECTION_ANCHORS.properties), '', ...renderExpandableProps(props, linkFor, { languages })];
}

