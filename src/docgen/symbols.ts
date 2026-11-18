import * as spec from '@jsii/spec';
import { anchoredHeading, enumMemberAnchor, SECTION_ANCHORS } from './anchors.js';
import {
  escapeCell,
  shortName,
  typeMetadataRows,
  ConstructLevel,
  TypeIndex,
} from './constructs.js';
import { escapeVueText } from './escape.js';
import { exampleSection } from './examples.js';
import { PageHistory } from './history.js';
import { DEFAULT_LANGUAGE, Language, translatePropertyName } from './languages.js';
import {
  classMethods,
  classProperties,
  MemberRef,
  relationsFor,
  renderDescription,
  renderExpandableProps,
  renderExtendsBar,
  renderInheritanceChain,
  renderTypeMetadata,
  renderMethodsSection,
  renderUsageBar,
  usageRowsFor,
} from './layout.js';
import { collectMethods, collectProperties } from './mixins.js';
import { RosettaTablet } from './rosetta.js';
import { ignoreBlock, weightedTitle } from './search.js';
import { CONSTRUCTS_SECTION, CORE_SECTION, isConstructsPackage, isCore, sectionName, serviceSubmodule, SidebarEntry } from './sidebar.js';
import { LinkResolver } from './signatures.js';
import { initializerSignatureVariants, languageVariantSpans, wrapLanguageTabs } from './variants.js';

export { classMethods, classProperties } from './layout.js';
export type { LinkResolver } from './signatures.js';

/**
 * A reference from a property to an enum type.
 * Stores the owner FQN so we can render cross-reference links.
 */
export interface EnumRef {
  readonly ownerFqn: string;
  readonly propertyName: string;
}

/**
 * Reverse-reference index for symbol pages:
 * - `propsUsers`: struct FQN -> class FQNs whose initializer takes it as props
 * - `enumRefs`: enum FQN -> property references (with owner FQN for linking)
 * - `obtainableFrom`: type FQN -> static methods and static properties whose declared type is that type
 * - `argumentIn`: type FQN -> members that take the type as a parameter
 * - `returnedBy`: type FQN -> methods that return the type
 */
export interface UsageIndex {
  readonly propsUsers: Map<string, string[]>;
  readonly enumRefs: Map<string, EnumRef[]>;
  readonly obtainableFrom: Map<string, MemberRef[]>;
  readonly argumentIn: Map<string, MemberRef[]>;
  readonly returnedBy: Map<string, MemberRef[]>;
}

export function buildUsageIndex(index: TypeIndex): UsageIndex {
  const propsUsers = new Map<string, Set<string>>();
  const enumRefs = new Map<string, EnumRef[]>();
  const obtainableFrom = new Map<string, MemberRef[]>();
  const argumentIn = new Map<string, MemberRef[]>();
  const returnedBy = new Map<string, MemberRef[]>();

  const recordEnumRefs = (ownerFqn: string, prop: spec.Property) => {
    for (const fqn of namedFqns(prop.type)) {
      const entry = index.get(fqn);
      if (entry && spec.isEnumType(entry.type)) {
        const list = enumRefs.get(fqn) ?? [];
        list.push({ ownerFqn, propertyName: prop.name });
        enumRefs.set(fqn, list);
      }
    }
  };

  // A member relates to every documented named type its signature mentions, including the types inside a
  // collection or a union: `grantRead(identity: IGrantable[]): Grant` is a usage of IGrantable as much as a bare
  // parameter would be. A type the site does not document gets no entry, since the row could not link it.
  const recordUsage = (
    map: Map<string, MemberRef[]>, ref: spec.TypeReference | undefined, entry: MemberRef,
  ) => {
    if (!ref) {
      return;
    }
    for (const fqn of new Set(namedFqns(ref))) {
      if (!index.has(fqn)) {
        continue;
      }
      const list = map.get(fqn) ?? [];
      list.push(entry);
      map.set(fqn, list);
    }
  };

  // A static member "produces" a type only when its declared type IS that type (or an optional of it): one
  // instance. A collection or a union produces something else, so neither counts. Protected statics are skipped
  // like the member tables skip them (`classMethods`/`classProperties`): a reader cannot call one, and the owner
  // page has no row for its anchor.
  const recordFactory = (
    ownerFqn: string, member: spec.Method | spec.Property, kind: MemberRef['kind'], ref: spec.OptionalValue | undefined,
  ) => {
    if (!member.static || member.protected || !ref || !spec.isNamedTypeReference(ref.type) || !index.has(ref.type.fqn)) {
      return;
    }
    const list = obtainableFrom.get(ref.type.fqn) ?? [];
    list.push({
      ownerFqn,
      memberName: member.name,
      kind,
      ...(kind === 'property' && (member as spec.Property).const ? { constant: true } : {}),
    });
    obtainableFrom.set(ref.type.fqn, list);
  };

  for (const { type } of index.values()) {
    if (spec.isClassType(type)) {
      for (const param of type.initializer?.parameters ?? []) {
        if (!spec.isNamedTypeReference(param.type)) {
          continue;
        }
        const entry = index.get(param.type.fqn);
        if (entry && spec.isInterfaceType(entry.type) && entry.type.datatype) {
          const set = propsUsers.get(param.type.fqn) ?? new Set();
          set.add(type.fqn);
          propsUsers.set(param.type.fqn, set);
        }
      }
      for (const method of type.methods ?? []) {
        recordFactory(type.fqn, method, 'method', method.returns);
      }
      for (const prop of type.properties ?? []) {
        recordFactory(type.fqn, prop, 'property', prop);
      }
      // A protected initializer cannot be called, so it is no more a usage than a protected method is.
      const init = type.initializer;
      if (init && !init.protected) {
        const entry: MemberRef = { ownerFqn: type.fqn, memberName: INITIALIZER_MEMBER, kind: 'initializer' };
        for (const param of init.parameters ?? []) {
          recordUsage(argumentIn, param.type, entry);
        }
      }
    }
    if (spec.isClassType(type) || spec.isInterfaceType(type)) {
      for (const prop of type.properties ?? []) {
        recordEnumRefs(type.fqn, prop);
      }
      // The DECLARING type owns the entry: a jsii type lists only its own methods, so an inherited member is
      // recorded once, where it is declared, rather than on every subclass that also exposes it.
      for (const method of type.methods ?? []) {
        if (method.protected || !method.name) {
          continue;
        }
        const entry: MemberRef = { ownerFqn: type.fqn, memberName: method.name, kind: 'method' };
        for (const param of method.parameters ?? []) {
          recordUsage(argumentIn, param.type, entry);
        }
        recordUsage(returnedBy, method.returns?.type, entry);
      }
    }
  }

  // Deduplicate enum refs (same owner+property from multiple paths) and sort
  const dedupedEnumRefs = new Map<string, EnumRef[]>();
  for (const [fqn, refs] of enumRefs) {
    const seen = new Set<string>();
    const unique: EnumRef[] = [];
    for (const ref of refs) {
      const key = `${ref.ownerFqn}.${ref.propertyName}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(ref);
      }
    }
    unique.sort((a, b) => `${shortName(a.ownerFqn)}.${a.propertyName}`
      .localeCompare(`${shortName(b.ownerFqn)}.${b.propertyName}`));
    dedupedEnumRefs.set(fqn, unique);
  }

  const sortedPropsUsers = new Map([...propsUsers].map(([k, v]) => [k, [...v].sort()]));

  // Each owner+member once, FQN-sorted in code-unit order like `propsUsers` (owner FQN, then member name), so the
  // row reads `Bucket.fromBucketArn, Bucket.fromBucketAttributes, ...` whatever order the assembly listed them in
  // and whatever locale the build host has.
  const sortedFactories = new Map<string, MemberRef[]>();
  for (const [fqn, refs] of obtainableFrom) {
    const unique = new Map(refs.map((ref) => [`${ref.ownerFqn}.${ref.memberName}`, ref]));
    sortedFactories.set(fqn, [...unique.values()].sort((a, b) =>
      byCodeUnit(a.ownerFqn, b.ownerFqn) || byCodeUnit(a.memberName, b.memberName)));
  }
  return {
    propsUsers: sortedPropsUsers,
    enumRefs: dedupedEnumRefs,
    obtainableFrom: sortedFactories,
    argumentIn: sortedUsage(argumentIn),
    returnedBy: sortedUsage(returnedBy),
  };
}

/** The canonical member name of an initializer, which anchors its entry to the owner page's Initializer section. */
const INITIALIZER_MEMBER = SECTION_ANCHORS.initializer;

/** Byte-stable ordering, so the output does not depend on the build host's locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Each owner and member once, in the order the row displays them: by owner name, then by member name, with the
 * owner FQN breaking a tie between two types of the same name in different submodules. An initializer entry
 * renders as the owner name alone, so it leads its owner's entries.
 */
function sortedUsage(usage: Map<string, MemberRef[]>): Map<string, MemberRef[]> {
  const entryName = (ref: MemberRef) => (ref.kind === 'initializer' ? '' : ref.memberName);
  const sorted = new Map<string, MemberRef[]>();
  for (const [fqn, refs] of usage) {
    const unique = new Map(refs.map((ref) => [`${ref.kind}:${ref.ownerFqn}.${ref.memberName}`, ref]));
    sorted.set(fqn, [...unique.values()].sort((a, b) =>
      byCodeUnit(shortName(a.ownerFqn), shortName(b.ownerFqn))
      || byCodeUnit(a.ownerFqn, b.ownerFqn)
      || byCodeUnit(entryName(a), entryName(b))));
  }
  return sorted;
}

/** All named-type FQNs appearing anywhere in a type reference. */
function namedFqns(ref: spec.TypeReference): string[] {
  if (spec.isNamedTypeReference(ref)) {
    return [ref.fqn];
  }
  if (spec.isCollectionTypeReference(ref)) {
    return namedFqns(ref.collection.elementtype);
  }
  if (spec.isUnionTypeReference(ref)) {
    return ref.union.types.flatMap(namedFqns);
  }
  return [];
}

interface SymbolPageOptions<T extends spec.Type> {
  readonly type: T;
  readonly assembly: spec.Assembly;
  readonly index: TypeIndex;
  readonly usage: UsageIndex;
  readonly linkFor: LinkResolver;
  /** Enabled documentation languages; variant regions embed one per language. */
  readonly languages?: readonly Language[];
  /**
   * Heading badge, when the type's classification differs from its jsii kind: a class-based mixin is grouped as
   * `Mixin` in the index table, the sidebar and the search filter, so its own page must badge itself the same way,
   * in the same color the interface mixin page uses. Defaults to the plain kind, `info`/`Class`.
   */
  readonly badge?: {
    readonly text: string;
    readonly type: string;
    /**
     * Kind class appended to the badge, so a classification that differs from the jsii kind also gets its own
     * color. Omitted for a plain class, which keeps the neutral badge so `Struct` stays distinguishable from `Class`.
     */
    readonly kindClass?: string;
  };
  /** Rosetta tablet supplying the authored example's per-language translations. */
  readonly tablet?: RosettaTablet;
  /** Whether to emit the type-level example section. Defaults to true. */
  readonly emitExamples?: boolean;
  /**
   * Interface FQN -> implementing type FQNs, for the `Implemented by` section on interface pages. Optional so
   * callers that render a single page in isolation need not build the corpus index.
   */
  readonly implementors?: ReadonlyMap<string, readonly string[]>;
  /**
   * Base class FQN -> extending class FQNs, for the `Subclasses` section. Optional for the same reason as
   * `implementors`: a caller rendering one page in isolation has no corpus index.
   */
  readonly subclasses?: ReadonlyMap<string, readonly string[]>;
  /** Version history of the type from the ledger; renders the `Type last changed` metadata row when known. */
  readonly history?: PageHistory;
}

/** Render a dedicated page for a non-construct class. */
export function renderClassPage(options: SymbolPageOptions<spec.ClassType>): string {
  const { type, assembly, index, usage, linkFor } = options;
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  const badge = options.badge ?? { text: 'Class', type: 'info' };
  const kindClass = badge.kindClass ? ` ${badge.kindClass}` : '';
  const lines = [`# ${weightedTitle(type.name)} <Badge type="${badge.type}" class="api-badge${kindClass}" text="${badge.text}" />`, ''];
  lines.push(...renderDescription(type));
  // Implemented interfaces render inside the hierarchy bar.
  lines.push(...renderInheritanceChain(
    type, index, linkFor, options.subclasses?.get(type.fqn) ?? [], relationsFor(type.fqn, usage), languages));
  lines.push(...renderTypeMetadata(typeMetadataRows(type, assembly, index, linkFor, options.history)));
  if (options.emitExamples !== false) {
    lines.push(...exampleSection(type, assembly, languages, { linkFor, tablet: options.tablet }));
  }
  lines.push(...renderClassInitializer(type, linkFor, languages));
  lines.push(...renderPropertiesSection(classProperties(type, index), linkFor, languages));
  lines.push(...renderMethodsSection(classMethods(type, index), linkFor, type.fqn, languages));
  return lines.join('\n');
}

/** Render a dedicated page for a struct (datatype interface). */
export function renderStructPage(options: SymbolPageOptions<spec.InterfaceType>): string {
  const { type, assembly, index, usage, linkFor } = options;
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  const lines = [`# ${weightedTitle(type.name)} <Badge type="info" class="api-badge api-badge-struct" text="Struct" />`, ''];
  lines.push(...renderDescription(type));
  lines.push(...renderExtendsBar(
    type, linkFor, [], usage.propsUsers.get(type.fqn) ?? [], relationsFor(type.fqn, usage), languages));
  lines.push(...renderTypeMetadata(typeMetadataRows(type, assembly, index, linkFor, options.history)));
  if (options.emitExamples !== false) {
    lines.push(...exampleSection(type, assembly, languages, { linkFor, tablet: options.tablet }));
  }
  lines.push(...renderStructProps(type, index, linkFor, languages));
  return lines.join('\n');
}

/** Render a dedicated page for a behavioral interface that is not a mixin. */
export function renderInterfacePage(options: SymbolPageOptions<spec.InterfaceType>): string {
  const { type, assembly, index, usage, linkFor } = options;
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  const lines = [`# ${weightedTitle(type.name)} <Badge type="info" class="api-badge api-badge-interface" text="Interface" />`, ''];
  lines.push(...renderDescription(type));
  // `implemented by` is a row of the hierarchy bar, not a section of its own: it is the inverse of the class bar's
  // `implements`, so it belongs beside `extends`.
  lines.push(...renderExtendsBar(
    type, linkFor, options.implementors?.get(type.fqn) ?? [], [], relationsFor(type.fqn, usage), languages));
  lines.push(...renderTypeMetadata(typeMetadataRows(type, assembly, index, linkFor, options.history)));
  if (options.emitExamples !== false) {
    lines.push(...exampleSection(type, assembly, languages, { linkFor, tablet: options.tablet }));
  }
  lines.push(...renderPropertiesSection(collectProperties(type, index), linkFor, languages));
  lines.push(...renderMethodsSection(collectMethods(type, index), linkFor, type.fqn, languages));
  return lines.join('\n');
}

/** Render a dedicated page for an enum. */
export function renderEnumPage(options: SymbolPageOptions<spec.EnumType>): string {
  const { type, assembly, index, usage, linkFor } = options;
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  const lines = [`# ${weightedTitle(type.name)} <Badge type="info" class="api-badge api-badge-enum" text="Enum" />`, ''];
  lines.push(...renderDescription(type));
  // An enum extends nothing and implements nothing, so its block holds the usage rows alone. `obtainable from`
  // stays off this page, as it always has.
  lines.push(...renderUsageBar(type, linkFor, usageRowsFor(type.fqn, usage), languages));
  lines.push(...renderTypeMetadata(typeMetadataRows(type, assembly, index, linkFor, options.history)));
  if (options.emitExamples !== false) {
    lines.push(...exampleSection(type, assembly, languages, { linkFor, tablet: options.tablet }));
  }

  lines.push(
    anchoredHeading(2, 'Members', SECTION_ANCHORS.members),
    '',
    '| Member | Description |',
    '| --- | --- |',
    ...type.members.map(renderEnumMemberRow),
    '',
  );

  const refs = usage.enumRefs.get(type.fqn) ?? [];
  if (refs.length > 0) {
    lines.push(anchoredHeading(2, 'Referenced by', SECTION_ANCHORS.referencedBy), '');
    // Cross-reference list: excluded from the search index. The referencing property names are language-variant;
    // the owning type names are language-stable.
    lines.push(...wrapLanguageTabs(languages, ignoreBlock(refs.map((r) => {
      const prop = languageVariantSpans(
        languages,
        (lang) => translatePropertyName(r.propertyName, lang),
      );
      return `- ${fqnLink(r.ownerFqn, linkFor)}.${prop}`;
    }))));
  }
  return lines.join('\n');
}

/**
 * One row of an enum's Members table. A deprecated member carries the same three signals as a deprecated
 * property row (see `layout.ts`): the struck-through name (`member-name-deprecated`), a text `deprecated`
 * badge (`member-deprecated`), and the deprecation reason in place of the summary. A member that is not
 * deprecated renders its backticked name and summary.
 */
function renderEnumMemberRow(m: spec.EnumMember): string {
  const anchor = `<span id="${enumMemberAnchor(m.name)}"></span>`;
  const deprecated = m.docs?.deprecated?.trim();
  if (!deprecated) {
    return `| ${anchor}\`${m.name}\` | ${escapeCell(m.docs?.summary ?? '')} |`;
  }
  // Raw HTML rather than a backtick span: the strikethrough class has to sit on the `<code>` itself.
  const name = `<code class="member-name-deprecated">${escapeVueText(m.name)}</code> <span class="member-deprecated">deprecated</span>`;
  return `| ${anchor}${name} | ${escapeCell(deprecated)} |`;
}

function fqnLink(fqn: string, linkFor: LinkResolver): string {
  const link = linkFor(fqn);
  const name = shortName(fqn);
  return link ? `[\`${name}\`](${link})` : `\`${name}\``;
}

function renderClassInitializer(
  type: spec.ClassType,
  linkFor: LinkResolver,
  languages: readonly Language[],
): string[] {
  const init = type.initializer;
  if (!init || init.protected) {
    return [];
  }
  return [anchoredHeading(2, 'Initializer', SECTION_ANCHORS.initializer), '', ...initializerSignatureVariants(type, languages, { linkFor }), ''];
}

/** `## Properties` section with compact, expandable rows (empty -> omitted). */
function renderPropertiesSection(
  props: spec.Property[],
  linkFor: LinkResolver,
  languages: readonly Language[],
): string[] {
  if (props.length === 0) {
    return [];
  }
  return [anchoredHeading(2, 'Properties', SECTION_ANCHORS.properties), '', ...renderExpandableProps(props, linkFor, { languages, optionalKind: 'output' })];
}

function renderStructProps(
  struct: spec.InterfaceType,
  index: TypeIndex,
  linkFor: LinkResolver,
  languages: readonly Language[],
): string[] {
  const props = collectProperties(struct, index);
  return [anchoredHeading(2, 'Properties', SECTION_ANCHORS.properties), '', ...renderExpandableProps(props, linkFor, { languages, optionalKind: 'input' })];
}

// ─── Navbar Type-Ahead Filter Index ───────────────────────────────────────────

/** One entry in the client-side symbol index (`api-sidebar/symbols.<hash>.js`). */
export interface SymbolIndexEntry {
  readonly name: string;
  readonly kind: string;
  /** Site-absolute link: dedicated page, or the (sub)module type table. */
  readonly link: string;
  /** Display label for the owning service/section. */
  readonly service: string;
  /**
   * Set when the owning assembly is experimental (the alpha modules), so the type-ahead can prefer a stable
   * module's symbol when two match a query equally well. Omitted, not `false`, for stable assemblies to keep the
   * index small.
   */
  readonly experimental?: true;
  /**
   * Construct level of the entry, carried through from the sidebar entry's own {@link constructLevel}
   * determination. Absent for everything that is not a leveled construct.
   */
  readonly level?: ConstructLevel;
}

/**
 * Flatten sidebar entries into the symbol index. Types without a
 * dedicated page fall back to their (sub)module type table so every
 * result is navigable.
 */
export function buildSymbolIndex(entries: SidebarEntry[]): SymbolIndexEntry[] {
  return entries
    .map((e) => {
      // Structural submodules roll into their owning service, matching the sidebar's grouping; the constructs
      // package labels with its dedicated section.
      const owner = serviceSubmodule(e.submodule);
      const service = isConstructsPackage(e.assemblyName)
        ? CONSTRUCTS_SECTION
        : isCore(e.assemblyName, owner) ? CORE_SECTION : sectionName(owner);
      return {
        name: e.name,
        kind: e.kind,
        link: e.link ?? e.indexLink,
        service,
        ...(e.experimental ? { experimental: true as const } : {}),
        ...(e.level ? { level: e.level } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.service.localeCompare(b.service));
}
