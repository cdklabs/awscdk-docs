import * as spec from '@jsii/spec';
import { anchoredHeading, enumMemberAnchor, SECTION_ANCHORS } from './anchors.js';
import {
  escapeCell,
  shortName,
  typeMetadataRows,
  ConstructLevel,
  TypeIndex,
} from './constructs.js';
import { exampleSection } from './examples.js';
import { PageHistory } from './history.js';
import { DEFAULT_LANGUAGE, Language, translatePropertyName } from './languages.js';
import {
  classMethods,
  classProperties,
  renderDescription,
  renderExpandableProps,
  renderExtendsBar,
  renderInheritanceChain,
  renderTypeMetadata,
  renderMethodsSection,
} from './layout.js';
import { collectMethods, collectProperties } from './mixins.js';
import { RosettaTablet } from './rosetta.js';
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
 */
export interface UsageIndex {
  readonly propsUsers: Map<string, string[]>;
  readonly enumRefs: Map<string, EnumRef[]>;
}

export function buildUsageIndex(index: TypeIndex): UsageIndex {
  const propsUsers = new Map<string, Set<string>>();
  const enumRefs = new Map<string, EnumRef[]>();

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
    }
    if (spec.isClassType(type) || spec.isInterfaceType(type)) {
      for (const prop of type.properties ?? []) {
        recordEnumRefs(type.fqn, prop);
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
  return { propsUsers: sortedPropsUsers, enumRefs: dedupedEnumRefs };
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
  const { type, assembly, index, linkFor } = options;
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  const badge = options.badge ?? { text: 'Class', type: 'info' };
  const kindClass = badge.kindClass ? ` ${badge.kindClass}` : '';
  const lines = [`# ${type.name} <Badge type="${badge.type}" class="api-badge${kindClass}" text="${badge.text}" />`, ''];
  lines.push(...renderDescription(type));
  // Implemented interfaces render inside the hierarchy bar.
  lines.push(...renderInheritanceChain(type, index, linkFor, options.subclasses?.get(type.fqn) ?? []));
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
  const lines = [`# ${type.name} <Badge type="info" class="api-badge api-badge-struct" text="Struct" />`, ''];
  lines.push(...renderDescription(type));
  lines.push(...renderExtendsBar(type, linkFor));
  lines.push(...renderTypeMetadata(typeMetadataRows(type, assembly, index, linkFor, options.history)));
  if (options.emitExamples !== false) {
    lines.push(...exampleSection(type, assembly, languages, { linkFor }));
  }
  lines.push(...renderStructProps(type, index, linkFor, languages));
  lines.push(...renderFqnList('Used as props by', SECTION_ANCHORS.usedAsPropsBy, usage.propsUsers.get(type.fqn) ?? [], linkFor));
  return lines.join('\n');
}

/** Render a dedicated page for a behavioral interface that is not a mixin. */
export function renderInterfacePage(options: SymbolPageOptions<spec.InterfaceType>): string {
  const { type, assembly, index, linkFor } = options;
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  const lines = [`# ${type.name} <Badge type="info" class="api-badge api-badge-interface" text="Interface" />`, ''];
  lines.push(...renderDescription(type));
  // `implemented by` is a row of the hierarchy bar, not a section of its own: it is the inverse of the class bar's
  // `implements`, so it belongs beside `extends`.
  lines.push(...renderExtendsBar(type, linkFor, options.implementors?.get(type.fqn) ?? []));
  lines.push(...renderTypeMetadata(typeMetadataRows(type, assembly, index, linkFor, options.history)));
  if (options.emitExamples !== false) {
    lines.push(...exampleSection(type, assembly, languages, { linkFor }));
  }
  lines.push(...renderPropertiesSection(collectProperties(type, index), linkFor, languages));
  lines.push(...renderMethodsSection(collectMethods(type, index), linkFor, type.fqn, languages));
  return lines.join('\n');
}

/** Render a dedicated page for an enum. */
export function renderEnumPage(options: SymbolPageOptions<spec.EnumType>): string {
  const { type, assembly, index, usage, linkFor } = options;
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  const lines = [`# ${type.name} <Badge type="info" class="api-badge api-badge-enum" text="Enum" />`, ''];
  lines.push(...renderDescription(type));
  lines.push(...renderTypeMetadata(typeMetadataRows(type, assembly, index, linkFor, options.history)));
  if (options.emitExamples !== false) {
    lines.push(...exampleSection(type, assembly, languages, { linkFor }));
  }

  lines.push(
    anchoredHeading(2, 'Members', SECTION_ANCHORS.members),
    '',
    '| Member | Description |',
    '| --- | --- |',
    ...type.members.map(
      (m) => `| <span id="${enumMemberAnchor(m.name)}"></span>\`${m.name}\` | ${escapeCell(m.docs?.summary ?? '')} |`,
    ),
    '',
  );

  const refs = usage.enumRefs.get(type.fqn) ?? [];
  if (refs.length > 0) {
    lines.push(anchoredHeading(2, 'Referenced by', SECTION_ANCHORS.referencedBy), '');
    // Cross-reference list. The referencing property names are language-variant; the owning type names are
    // language-stable.
    lines.push(...wrapLanguageTabs(languages, [...refs.map((r) => {
      const prop = languageVariantSpans(
        languages,
        (lang) => translatePropertyName(r.propertyName, lang),
      );
      return `- ${fqnLink(r.ownerFqn, linkFor)}.${prop}`;
    }), '']));
  }
  return lines.join('\n');
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
  return [anchoredHeading(2, 'Properties', SECTION_ANCHORS.properties), '', ...renderExpandableProps(props, linkFor, { languages })];
}

function renderStructProps(
  struct: spec.InterfaceType,
  index: TypeIndex,
  linkFor: LinkResolver,
  languages: readonly Language[],
): string[] {
  const props = collectProperties(struct, index);
  return [anchoredHeading(2, 'Properties', SECTION_ANCHORS.properties), '', ...renderExpandableProps(props, linkFor, { languages })];
}

function renderFqnList(title: string, id: string, fqns: string[], linkFor: LinkResolver): string[] {
  if (fqns.length === 0) {
    return [];
  }
  return [anchoredHeading(2, title, id), '', ...fqns.map((fqn) => `- ${fqnLink(fqn, linkFor)}`), ''];
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
