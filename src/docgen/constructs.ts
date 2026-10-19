import * as spec from '@jsii/spec';
import { anchoredHeading, SECTION_ANCHORS } from './anchors.js';
import { escapeAttr, escapeVueText } from './escape.js';
import { exampleSection } from './examples.js';
import { PageHistory } from './history.js';
import { DEFAULT_LANGUAGE, Language } from './languages.js';
import {
  classMethods,
  classProperties,
  renderDescription,
  renderExpandableProps,
  renderInheritanceChain,
  renderMethodsSection,
  renderTypeMetadata,
  TypeMetadataRow,
} from './layout.js';
import { pageHref } from './links.js';
import { RosettaTablet } from './rosetta.js';
import { formatDateOnly } from '../page-history.js';
import { STABILITY_ROUTE } from '../site-routes.js';
import { LinkResolver, shortName } from './signatures.js';
import { initializerSignatureVariants } from './variants.js';

export { escapeCell, escapeProse } from './layout.js';
export { shortName } from './signatures.js';

const CONSTRUCT_BASE_FQN = 'constructs.Construct';
const RESOURCE_BASE_FQN = 'aws-cdk-lib.Resource';
const CFN_ELEMENT_BASE_FQN = 'aws-cdk-lib.CfnElement';

/** A type together with the assembly it was loaded from. */
export interface IndexedType {
  readonly type: spec.Type;
  readonly assembly: spec.Assembly;
}

/** Lookup of every type across all loaded assemblies, keyed by FQN. */
export type TypeIndex = Map<string, IndexedType>;

/**
 * Construct level following CDK conventions:
 * - L1: generated CloudFormation resource (CfnXxx)
 * - L2: curated resource abstraction
 * - L3: pattern composing multiple resources
 */
export type ConstructLevel = 'L1' | 'L2' | 'L3';

export function buildTypeIndex(assemblies: spec.Assembly[]): TypeIndex {
  const index: TypeIndex = new Map();
  for (const assembly of assemblies) {
    for (const type of Object.values(assembly.types ?? {})) {
      index.set(type.fqn, { type, assembly });
    }
  }
  return index;
}

/** A type is a construct if its base-class chain reaches constructs.Construct. */
export function isConstruct(fqn: string, index: TypeIndex): boolean {
  let current: string | undefined = fqn;
  while (current) {
    if (current === CONSTRUCT_BASE_FQN) {
      return true;
    }
    const entry = index.get(current);
    current = entry && spec.isClassType(entry.type) ? entry.type.base : undefined;
  }
  return false;
}

/**
 * Levels no inheritance test can derive, by exact FQN. `Resource` is the L2 base itself and the other four sit
 * beside it. Never inherited, so `aws_servicecatalog.ProductStack` stays unleveled.
 */
const LEVEL_OVERRIDES: ReadonlyMap<string, ConstructLevel> = new Map<string, ConstructLevel>([
  ['aws-cdk-lib.Stage', 'L2'],
  ['aws-cdk-lib.App', 'L2'],
  ['aws-cdk-lib.Stack', 'L2'],
  ['aws-cdk-lib.NestedStack', 'L2'],
  [RESOURCE_BASE_FQN, 'L2'],
]);

/**
 * Classify a construct, in order: an explicit {@link LEVEL_OVERRIDES} entry wins outright; then L1 has jsii
 * `cloudformationResource` metadata, L3 lives in a `*patterns*` submodule, L2 extends aws-cdk-lib.Resource, and
 * finally aws-cdk-lib.CfnElement and its descendants are L1. Constructs matching none of these (e.g.
 * constructs.Construct itself) get no level.
 */
export function constructLevel(type: spec.ClassType, index: TypeIndex): ConstructLevel | undefined {
  // First, so an explicit level always beats every derived one.
  const override = LEVEL_OVERRIDES.get(type.fqn);
  if (override) {
    return override;
  }
  if (type.docs?.custom?.cloudformationResource) {
    return 'L1';
  }
  if (/(?:^|[._])patterns$/.test(type.namespace ?? '')) {
    return 'L3';
  }
  if (extendsFqn(type.fqn, RESOURCE_BASE_FQN, index)) {
    return 'L2';
  }
  // Only the GENERATED subtree members carry `cloudformationResource` metadata, so the rest need the inheritance
  // test. The self-check is required because `extendsFqn` excludes self-matches.
  if (type.fqn === CFN_ELEMENT_BASE_FQN || extendsFqn(type.fqn, CFN_ELEMENT_BASE_FQN, index)) {
    return 'L1';
  }
  return undefined;
}

function extendsFqn(fqn: string, baseFqn: string, index: TypeIndex): boolean {
  let current: string | undefined = fqn;
  while (current) {
    if (current === baseFqn && current !== fqn) {
      return true;
    }
    const entry = index.get(current);
    current = entry && spec.isClassType(entry.type) ? entry.type.base : undefined;
  }
  return false;
}

/**
 * GitHub URL of the type's source, pinned to the assembly's version tag.
 * Returns undefined for build-generated files (e.g. `*.generated.ts`
 * L1 sources), which do not exist in the repository.
 */
export function sourceUrl(type: spec.Type, assembly: spec.Assembly): string | undefined {
  const repo = assembly.repository;
  const loc = type.locationInModule;
  if (!repo?.url || !loc || /\.generated\./.test(loc.filename)) {
    return undefined;
  }
  const base = repo.url.replace(/^git\+/, '').replace(/\.git$/, '');
  const dir = repo.directory ? `${repo.directory}/` : '';
  return `${base}/blob/v${assembly.version}/${dir}${loc.filename}#L${loc.line}`;
}

/**
 * Whether a type's source is build-generated rather than a file in the repository — the L1 `Cfn*` types emitted
 * into `*.generated.*`, plus any type carrying `cloudformationResource`. Distinguishes "no link because the file
 * does not exist" from "no location information at all", so the metadata block can say `Generated code` in the
 * first case and omit the row entirely in the second.
 */
export function isGeneratedSource(type: spec.Type): boolean {
  const loc = type.locationInModule;
  return (loc !== undefined && /\.generated\./.test(loc.filename))
    || type.docs?.custom?.cloudformationResource !== undefined;
}

/**
 * CloudFormation provenance for the type-metadata block, in both directions and as the single caller of
 * {@link cfnDocsUrl}:
 *
 * - an L1 names its own resource (`docs.custom.cloudformationResource`) and has no L1 counterpart to point at — the
 *   page is the L1;
 * - an L2/L3 resolves its backing resource through {@link cfnResourceRef}, whose `undefined`-for-L1 contract is
 *   pinned by the construct-page tests and is not widened here.
 *
 * Returns `undefined` for every type with no CloudFormation data at all: every struct, interface, enum, mixin and
 * plain class.
 */
export function cfnMetadata(type: spec.Type, index: TypeIndex): CfnResourceRef | undefined {
  const own = type.docs?.custom?.cloudformationResource;
  if (own) {
    return { resourceType: own, docsUrl: cfnDocsUrl(own, type) };
  }
  return spec.isClassType(type) ? cfnResourceRef(type, index) : undefined;
}

/**
 * The jsii stability of a type: its own `docs.stability` when set, otherwise the owning assembly's. The same
 * fallback order the version-history fingerprint uses, so the page and the ledger never disagree about a type.
 */
export function typeStability(type: spec.Type, assembly: spec.Assembly): spec.Stability | undefined {
  return type.docs?.stability ?? assembly.docs?.stability;
}

/**
 * The metadata rows for one type page, in order: stability, CloudFormation resource, L1 counterpart, source
 * location, last change. One builder for all six renderers, so the same fact cannot render two ways on two page
 * kinds.
 *
 * Stability renders only for experimental types, matching the module page, which warns on experimental modules and
 * says nothing on stable ones; the value links to the guide that explains what the level means.
 */
export function typeMetadataRows(
  type: spec.Type,
  assembly: spec.Assembly,
  index: TypeIndex,
  linkFor: LinkResolver,
  history: PageHistory = {},
): TypeMetadataRow[] {
  const rows: TypeMetadataRow[] = [];
  if (typeStability(type, assembly) === spec.Stability.Experimental) {
    rows.push({
      label: 'Stability',
      value: `<a class="type-metadata-stability" href="${escapeAttr(pageHref(STABILITY_ROUTE))}">`
        + 'Experimental</a>',
    });
  }
  const cfn = cfnMetadata(type, index);
  if (cfn) {
    rows.push({
      label: 'CloudFormation',
      value: `<a href="${escapeAttr(cfn.docsUrl)}" target="_blank" rel="noopener">`
        + `<code>${escapeVueText(cfn.resourceType)}</code></a>`,
    });
  }
  const l1Link = cfn?.l1Fqn ? linkFor(cfn.l1Fqn) : undefined;
  if (cfn?.l1Fqn && l1Link) {
    rows.push({
      label: 'L1 type',
      value: `<a href="${escapeAttr(pageHref(l1Link))}">`
        + `<code>${escapeVueText(shortName(cfn.l1Fqn))}</code></a>`,
    });
  }
  const loc = type.locationInModule;
  const url = sourceUrl(type, assembly);
  if (url && loc) {
    rows.push({
      label: 'Source',
      value: `<a class="type-metadata-source" href="${escapeAttr(url)}"`
        + ` target="_blank" rel="noopener"><code>${escapeVueText(loc.filename)}</code></a>`,
    });
  } else if (isGeneratedSource(type)) {
    rows.push({
      label: 'Source',
      value: '<span class="type-metadata-generated">Generated code</span>',
    });
  }
  // The release the type's shape last changed in, dated by that release — never raised by the site-wide revision
  // date the footer uses, and absent rather than guessed when the ledger has no history for the type.
  if (history.lastChangedIn && history.lastChangedAt) {
    rows.push({
      label: 'Type last changed',
      value: `<span class="type-metadata-changed">v${escapeVueText(history.lastChangedIn)}`
        + ` · ${formatDateOnly(history.lastChangedAt)}</span>`,
    });
  }
  return rows;
}

/** Human-readable rendering of a jsii type reference. */
export function typeRefToString(ref: spec.TypeReference): string {
  if (spec.isPrimitiveTypeReference(ref)) {
    return ref.primitive;
  }
  if (spec.isNamedTypeReference(ref)) {
    return shortName(ref.fqn);
  }
  if (spec.isCollectionTypeReference(ref)) {
    const element = typeRefToString(ref.collection.elementtype);
    return ref.collection.kind === spec.CollectionKind.Array
      ? `${element}[]`
      : `{ [key: string]: ${element} }`;
  }
  if (spec.isUnionTypeReference(ref)) {
    return ref.union.types.map(typeRefToString).join(' | ');
  }
  return 'any';
}

export interface ConstructPageOptions {
  readonly type: spec.ClassType;
  readonly assembly: spec.Assembly;
  readonly index: TypeIndex;
  readonly linkFor: LinkResolver;
  /** Enabled documentation languages; variant regions embed one per language. */
  readonly languages?: readonly Language[];
  /**
   * Base class FQN -> extending class FQNs, for the `Subclasses` section. Construct pages need this as much as
   * ordinary class pages do, since `Construct` and `Resource` are themselves constructs.
   */
  readonly subclasses?: ReadonlyMap<string, readonly string[]>;
  /** Rosetta tablet supplying the authored example's per-language translations. */
  readonly tablet?: RosettaTablet;
  /** Whether to emit the type-level example section. Defaults to true. */
  readonly emitExamples?: boolean;
  /** Version history of the type from the ledger; renders the `Type last changed` metadata row when known. */
  readonly history?: PageHistory;
}

/**
 * The construct level as a reader-facing label. One function, so the H1 badge and the hover preview cannot drift
 * into two formats for the same determination.
 */
export function constructLevelLabel(level: ConstructLevel): string {
  return `${level} construct`;
}

/** Render a dedicated markdown page for one construct. */
export function renderConstructPage(options: ConstructPageOptions): string {
  const { type, assembly, index, linkFor } = options;
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  const level = constructLevel(type, index);
  // The kind travels as a class, not as `type`: `<Badge>` only accepts info|tip|warning|danger. Vue merges the
  // extra class onto the component's root span.
  const badge = level
    ? ` <Badge type="tip" class="api-badge api-badge-${level.toLowerCase()}" text="${constructLevelLabel(level)}" />`
    : '';
  const lines: string[] = [`# ${type.name}${badge}`, ''];

  // Merged description: tagline + remarks as one continuous block, no `## Overview` row. The CloudFormation backing
  // resource is a row of the metadata block below.
  lines.push(...renderDescription(type));
  lines.push(...renderInheritanceChain(type, index, linkFor, options.subclasses?.get(type.fqn) ?? []));
  lines.push(...renderTypeMetadata(typeMetadataRows(type, assembly, index, linkFor, options.history)));

  if (options.emitExamples !== false) {
    lines.push(...exampleSection(type, assembly, languages, { construct: true, linkFor, tablet: options.tablet }));
  }

  lines.push(...renderInitializer(type, index, linkFor, languages));

  const props = classProperties(type, index);
  if (props.length > 0) {
    lines.push(anchoredHeading(2, 'Properties', SECTION_ANCHORS.properties), '', ...renderExpandableProps(props, linkFor, { languages }));
  }
  lines.push(...renderMethodsSection(classMethods(type, index), linkFor, type.fqn, languages));

  return lines.join('\n');
}

/** The CloudFormation resource type backing an L2/L3 construct. */
export interface CfnResourceRef {
  /** CloudFormation resource type string, e.g. `AWS::S3::Bucket`. */
  readonly resourceType: string;
  /** FQN of the corresponding L1 `Cfn*` type, when one exists in the index. */
  readonly l1Fqn?: string;
  /** AWS CloudFormation resource reference page for the resource type. */
  readonly docsUrl: string;
}

// One reverse map (CloudFormation resource type -> L1 entry) per TypeIndex,
// built lazily on first use instead of once per rendered page.
const l1MapCache = new WeakMap<TypeIndex, Map<string, IndexedType>>();

function l1ByResourceType(index: TypeIndex): Map<string, IndexedType> {
  let map = l1MapCache.get(index);
  if (!map) {
    map = new Map();
    for (const entry of index.values()) {
      const resource = entry.type.docs?.custom?.cloudformationResource;
      if (resource && !map.has(resource)) {
        map.set(resource, entry);
      }
    }
    l1MapCache.set(index, map);
  }
  return map;
}

/**
 * Base URL of the AWS CloudFormation resource-type reference. Resource pages live under `TemplateReference` (HTTPS);
 * the `http://.../UserGuide/...` URLs baked into assembly `@see` tags are stale.
 */
const CFN_DOCS_BASE = 'https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/';

const CFN_SEE_URL = /^https?:\/\/docs\.aws\.amazon\.com\/AWSCloudFormation\/latest\/(?:UserGuide|TemplateReference)\/([^?#]+\.html)$/;

/**
 * Normalize an assembly `@see` CloudFormation docs URL to the canonical HTTPS `TemplateReference` form, keeping the
 * authoritative page slug from the assembly. Non-CFN-docs URLs pass through untouched.
 */
export function normalizeCfnSee(see: string): string {
  const match = CFN_SEE_URL.exec(see);
  return match ? `${CFN_DOCS_BASE}${match[1]}` : see;
}

/**
 * A URL we are willing to bind into a raw `href`. Same shape as
 * `SAFE_REPO_URL` in `provenance.ts`: plainly an https URL and nothing else,
 * so no `javascript:`, `vbscript:` or `data:` scheme can reach the attribute.
 */
const SAFE_CFN_DOCS_URL = /^https:\/\/[\w\-.]+(?::\d+)?(?:\/[\w\-./@]*)?$/;

/**
 * AWS CloudFormation resource reference URL for a resource type. Prefers the L1 type's authoritative `@see` link
 * from the assembly (normalized to the HTTPS `TemplateReference` base); falls back to deriving the documented slug
 * convention from the resource type string (`AWS::S3::Bucket` -> `aws-resource-s3-bucket.html`).
 *
 * The `@see` value is third-party assembly metadata and `normalizeCfnSee` passes unrecognized URLs through
 * untouched, so it is scheme-checked before being bound into a raw-HTML `href`, which has no `validateLink` guard.
 * Failure is closed and still useful — the derived slug is a real page.
 */
function cfnDocsUrl(resourceType: string, l1?: spec.Type): string {
  const slug = resourceType.replace(/^AWS::/, '').split('::').join('-').toLowerCase();
  const derived = `${CFN_DOCS_BASE}aws-resource-${slug}.html`;
  if (l1?.docs?.see) {
    const normalized = normalizeCfnSee(l1.docs.see);
    if (SAFE_CFN_DOCS_URL.test(normalized)) {
      return normalized;
    }
  }
  return derived;
}

/**
 * Resolve the CloudFormation resource type backing an L2/L3 construct, from assembly metadata rather than
 * class-name munging:
 *
 * 1. The CDK's `@resource` doc tag (`docs.custom.resource`) names the
 *    resource type directly; the L1 page is found via the reverse map
 *    (handles L2s whose L1 lives under a different name or submodule,
 *    e.g. `Vpc` -> `CfnVPC`, `apigatewayv2.HttpApi` -> `CfnApi`).
 * 2. Otherwise the conventional same-submodule `Cfn<Name>` counterpart
 *    is looked up in the index and used only when it actually carries
 *    `cloudformationResource` metadata — the resource type string still
 *    comes from the assembly, never from the class name itself.
 *
 * Returns `undefined` for L1 types themselves (the page already *is*
 * the resource) and for constructs with no backing CFN resource
 * (base classes, pure logical constructs, most L3 patterns).
 */
export function cfnResourceRef(type: spec.ClassType, index: TypeIndex): CfnResourceRef | undefined {
  if (type.docs?.custom?.cloudformationResource) {
    return undefined;
  }
  const tagged = type.docs?.custom?.resource;
  if (tagged) {
    const l1 = l1ByResourceType(index).get(tagged);
    return { resourceType: tagged, l1Fqn: l1?.type.fqn, docsUrl: cfnDocsUrl(tagged, l1?.type) };
  }
  const prefix = type.namespace ? `${type.assembly}.${type.namespace}` : type.assembly;
  const counterpart = index.get(`${prefix}.Cfn${type.name}`);
  const resourceType = counterpart?.type.docs?.custom?.cloudformationResource;
  if (counterpart && resourceType) {
    return { resourceType, l1Fqn: counterpart.type.fqn, docsUrl: cfnDocsUrl(resourceType, counterpart.type) };
  }
  return undefined;
}

function renderInitializer(
  type: spec.ClassType,
  index: TypeIndex,
  linkFor: LinkResolver,
  languages: readonly Language[],
): string[] {
  const init = type.initializer;
  if (!init || init.protected) {
    return [];
  }
  const params = init.parameters ?? [];
  const lines = [anchoredHeading(2, 'Initializer', SECTION_ANCHORS.initializer), '', ...initializerSignatureVariants(type, languages, { linkFor }), ''];

  // Inline the props struct(s) referenced by initializer parameters
  for (const param of params) {
    if (!spec.isNamedTypeReference(param.type)) {
      continue;
    }
    const entry = index.get(param.type.fqn);
    if (!entry || !spec.isInterfaceType(entry.type) || !entry.type.datatype) {
      continue;
    }
    // Human-facing label instead of the raw jsii type name. The explicit `{#...}` anchor pins the heading id to the
    // slug VitePress derives from the `Props (\`<Type>Props\`)` title, so deep links like `#props-bucketprops`
    // keep resolving.
    lines.push(
      `## Construct Props {#${propsAnchor(param.type.fqn)}}`,
      '',
      ...renderExpandableProps(collectProps(entry.type, index), linkFor, {
        languages,
        // Namespaced under this section's own slug: the same member name can appear in the type's Properties
        // section below.
        anchorPrefix: propsAnchor(param.type.fqn),
      }),
    );
  }
  return lines;
}

/**
 * Anchor id for a construct's inlined props section. Matches the slug VitePress auto-derives from the
 * `Props (\`<Type>\`)` heading (lowercase, `.` in nested type names collapsed to `-`), e.g.
 * `aws-cdk-lib.aws_s3.BucketProps` -> `props-bucketprops`.
 */
function propsAnchor(fqn: string): string {
  return `props-${shortName(fqn).toLowerCase().replace(/\./g, '-')}`;
}

/** Own properties plus those inherited from parent structs, sorted by name. */
function collectProps(struct: spec.InterfaceType, index: TypeIndex): spec.Property[] {
  const seen = new Map<string, spec.Property>();
  const visit = (fqn: string) => {
    const entry = index.get(fqn);
    if (!entry || !spec.isInterfaceType(entry.type)) {
      return;
    }
    for (const prop of entry.type.properties ?? []) {
      if (!seen.has(prop.name)) {
        seen.set(prop.name, prop);
      }
    }
    for (const parent of entry.type.interfaces ?? []) {
      visit(parent);
    }
  };
  visit(struct.fqn);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
