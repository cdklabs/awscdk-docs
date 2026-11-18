import * as spec from '@jsii/spec';
import { anchoredHeading, SECTION_ANCHORS } from './anchors.js';
import type { TypeIndex } from './constructs.js';
import { escapeAttr, escapeSummaryHtml, escapeVueText } from './escape.js';
import { codeFence, mapProse } from './fences.js';
import { classLineage } from './interfaces.js';
import {
  DEFAULT_LANGUAGE,
  Language,
  translateMethodName,
  translateMethodSignature,
  translateParameterName,
  translatePropertyName,
  translateTypeRef,
} from './languages.js';
import { pageHref } from './links.js';
import { encodeOutlineParams } from './outline-members.js';
import { PAGEFIND_IGNORE } from './search.js';
import {
  LinkResolver,
  inlineMethodSignature,
  shortName,
  translatedTypeRefHtml,
  typeRefHtml,
  typeRefText,
} from './signatures.js';
import {
  languageVariantSpans,
  memberAnchor,
  wrapLanguageTabs,
} from './variants.js';

/**
 * Shared interactive layout components for generated API pages: inheritance chain breadcrumbs, expandable props
 * rows, and collapsible method details. All interactivity uses native HTML (`<details>`/`<summary>`) so pages stay
 * static.
 */

interface InlineUrlEscapers {
  readonly plain: (text: string) => string;
  readonly label: (text: string) => string;
  readonly target: (text: string) => string;
}

const PROSE_LINK_ESCAPERS: InlineUrlEscapers = {
  plain: (text) => text,
  label: (text) => text.replace(/[\\[\]]/g, '\\$&'),
  target: (text) => text.replace(/[\\()]/g, '\\$&'),
};

const CELL_LINK_ESCAPERS: InlineUrlEscapers = {
  // Markdown table cells need pipes escaped too. Escape each original
  // delimiter once, without doubling link-syntax escapes added below.
  plain: (text) => text.replace(/[\\|]/g, '\\$&'),
  label: (text) => text.replace(/[\\[\]|]/g, '\\$&'),
  target: (text) => text.replace(/[\\()|]/g, '\\$&'),
};

function convertInlineUrlLinks(
  prose: string,
  escapers: InlineUrlEscapers = PROSE_LINK_ESCAPERS,
): string {
  const pattern = /\{@link\s+(https?:\/\/[^\s}]+)(?:\s+([^}]*?))?\}/g;
  let converted = '';
  let end = 0;
  for (const match of prose.matchAll(pattern)) {
    const index = match.index;
    const url = match[1];
    const label = match[2]?.trim() || url;
    converted += escapers.plain(prose.slice(end, index));
    converted += `[${escapers.label(label)}](${escapers.target(url)})`;
    end = index + match[0].length;
  }
  return converted + escapers.plain(prose.slice(end));
}

export function escapeCell(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ');
  return escapeVueText(convertInlineUrlLinks(collapsed, CELL_LINK_ESCAPERS)).trim();
}

/**
 * Convert external JSDoc links, then escape prose so raw `<` and `{` don't
 * break Vue compilation. Fenced code blocks and inline code spans stay
 * untouched (VitePress renders those with v-pre, so they are already safe).
 * Non-URL symbol link tags retain their existing escaped output.
 */
export function escapeProse(text: string): string {
  return mapProse(text, (prose) => convertInlineUrlLinks(prose)
    .replace(/</g, '&lt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;'));
}

/** Escape text for embedding in raw HTML emitted into markdown. */
const escHtml = escapeVueText;

/**
 * Merged description block for the top of a type page: the doc summary (tagline) followed by the remarks — one
 * continuous description instead of a separate tagline row plus an `## Overview` section. Prose only; returns
 * nothing when the type carries no prose.
 */
export function renderDescription(type: spec.Type): string[] {
  const lead = type.docs?.summary ? escapeProse(type.docs.summary) : '';
  const lines: string[] = [];
  if (lead) {
    lines.push(lead, '');
  }
  if (type.docs?.remarks) {
    lines.push(escapeProse(type.docs.remarks), '');
  }
  return lines;
}

/**
 * One fact of the type-metadata block.
 *
 * The docgen layer resolves which facts a type has and renders each value; this layer only decides how a row looks.
 * That split makes a new metadata point one more entry in the list rather than an edit here and a new CSS rule.
 */
export interface TypeMetadataRow {
  /** Reader-facing field name, e.g. `CloudFormation`. */
  readonly label: string;
  /**
   * Pre-escaped inline HTML (a link, code or span, never table markup): the Markdown twin ends the block at the
   * first `</table>`.
   */
  readonly value: string;
}

/** Opening tag of the metadata table. The Markdown twin transform finds the table by this exact string. */
export const TYPE_METADATA_OPEN = '<table class="type-metadata" aria-label="Type metadata">';

/**
 * Metadata table under the type-hierarchy bar. Each label is a row header, and rows render only when the type has
 * the corresponding fact.
 */
export function renderTypeMetadata(rows: readonly TypeMetadataRow[]): string[] {
  if (rows.length === 0) {
    return [];
  }
  const body = rows
    .map((row) => '<tr>'
      + `<th class="type-metadata-label" scope="row">${escHtml(row.label)}</th>`
      + `<td class="type-metadata-value">${row.value}</td>`
      + '</tr>')
    .join('');
  return [`${TYPE_METADATA_OPEN}<tbody>${body}</tbody></table>`, ''];
}

/** One linked type name of the hierarchy block. */
function chainLink(fqn: string, linkFor: LinkResolver): string {
  const link = linkFor(fqn);
  const name = escHtml(shortName(fqn));
  return link
    ? `<a class="chain-item" href="${escapeAttr(pageHref(link))}">${name}</a>`
    : `<span class="chain-item">${name}</span>`;
}

/**
 * Width budget for a relation row's visible names, in characters of visible name text. MEASURED against the
 * rendered row, not derived from font metrics — the derivation was wrong by more than double. A CSS line clamp
 * cannot replace it: unclamping needs the names inside `<summary>`, a `nested-interactive` accessibility violation.
 * The e2e two-line geometry assertion is the guard, because no markup assertion can see a line count.
 */
const RELATION_ROW_BUDGET = 70;

/** One entry of a relation row: its visible text (for the width budget) and the rendered link. */
interface RelationItem {
  readonly text: string;
  readonly html: string;
}

/**
 * What an initializer entry carries after the owner name, so a row of members does not read as a row of types.
 * It names the section the entry links to, and is the same word in every language.
 */
const INITIALIZER_SUFFIX = '(initializer)';

/**
 * The owner as the entry shows it, and the note that tells two of them apart. Two owners of the same short name
 * in one row would render identical link text pointing at different pages, which a links list or a tab sequence
 * cannot tell apart (WCAG 2.4.4), and the usage rows make that collision common: three `Schedule.rate` from three
 * submodules on one row. A colliding entry carries its namespace as a trailing note,
 * `Schedule.rate (aws_events)`, rather than as a prefix: a prefix reads as a namespace, and the jsii submodule is
 * not the namespace any of Go, Java or C# would use. The note is the one enclosing segment where that is enough to
 * tell the owners apart, and the whole namespace path where it is not (`x.a.mixins.Thing` against
 * `x.b.mixins.Thing`, which share a `mixins` segment). The note is part of the visible text, so it counts against
 * the row's width budget and stays in the accessible name.
 */
function ownerNote(fqn: string, refs: readonly MemberRef[]): string {
  const name = shortName(fqn);
  const owners = [...new Set(refs.filter((ref) => shortName(ref.ownerFqn) === name).map((ref) => ref.ownerFqn))];
  if (owners.length < 2) {
    return '';
  }
  const segment = ownerNamespace(fqn);
  const distinct = owners.every((other) => other === fqn || ownerNamespace(other) !== segment);
  return distinct ? segment : ownerNamespacePath(fqn);
}

/** The segment enclosing the type in its FQN: `aws_events` for `aws-cdk-lib.aws_events.Schedule`. */
function ownerNamespace(fqn: string): string {
  const segments = namespaceSegments(fqn);
  return segments[segments.length - 1] ?? '';
}

/** Everything before the type in its FQN: `x.a.mixins` for `x.a.mixins.Thing`. */
function ownerNamespacePath(fqn: string): string {
  return namespaceSegments(fqn).join('.');
}

function namespaceSegments(fqn: string): string[] {
  const segments = fqn.split('.');
  const type = segments.findIndex((segment) => /^[A-Z]/.test(segment));
  return type > 0 ? segments.slice(0, type) : [];
}

/**
 * A member that relates a type to the page's type: a static factory that produces it
 * (`Bucket.fromBucketName`), a member that takes it as an argument, or a member that returns it. The owner FQN
 * links the entry to the owner's page and the member name to its row anchor there; `kind` picks the per-language
 * name translator, since a method and a property translate through different helpers.
 *
 * An `initializer` has no member name of its own in jsii, and its per-language spelling changes form rather than
 * casing (`new Bucket(...)`, `Bucket(...)`, `NewBucket(...)`), so no `Owner<sep>member` string exists for it: the
 * entry renders as `Owner (initializer)` and `memberName` carries the canonical `initializer` that anchors it to
 * the owner page's Initializer section.
 */
export interface MemberRef {
  readonly ownerFqn: string;
  readonly memberName: string;
  readonly kind: 'method' | 'property' | 'initializer';
  /** A static member: jsii exposes one in Go as the package-level `Owner_Member`, where an instance member is not. */
  readonly static?: boolean;
  /** A `const` static property: `translatePropertyName` keeps its UPPER_SNAKE name in Python, as jsii does. */
  readonly constant?: boolean;
}

/** The member relation rows of one page's hierarchy block, in the order they render. */
export interface UsageRelations {
  readonly obtainableFrom?: readonly MemberRef[];
  readonly argumentIn?: readonly MemberRef[];
  readonly returnedBy?: readonly MemberRef[];
}

/** The same three relations as corpus-wide indexes, keyed by the type each entry relates to. */
export interface UsageRelationIndex {
  readonly obtainableFrom?: ReadonlyMap<string, readonly MemberRef[]>;
  readonly argumentIn?: ReadonlyMap<string, readonly MemberRef[]>;
  readonly returnedBy?: ReadonlyMap<string, readonly MemberRef[]>;
}

/** One page's member relations, read out of the corpus indexes. */
export function relationsFor(fqn: string, index: UsageRelationIndex = {}): UsageRelations {
  return {
    obtainableFrom: index.obtainableFrom?.get(fqn) ?? [],
    argumentIn: index.argumentIn?.get(fqn) ?? [],
    returnedBy: index.returnedBy?.get(fqn) ?? [],
  };
}

/** The two usage rows alone, for the page kinds that carry no `obtainable from` row. */
export function usageRowsFor(fqn: string, index: UsageRelationIndex = {}): UsageRelations {
  const { argumentIn, returnedBy } = relationsFor(fqn, index);
  return { argumentIn, returnedBy };
}

/** Items that fit the row's two-line budget, and the remainder. */
function splitToBudget(items: readonly RelationItem[]): { shown: RelationItem[]; hidden: RelationItem[] } {
  const shown: RelationItem[] = [];
  let used = 0;
  for (const item of items) {
    const width = item.text.length + 2; // + comma and space
    // Always show at least one name: a single name wider than the whole
    // budget must still render, or the row would be nothing but a
    // disclosure.
    if (shown.length > 0 && used + width > RELATION_ROW_BUDGET) {
      break;
    }
    used += width;
    shown.push(item);
  }
  return { shown, hidden: items.slice(shown.length) };
}

/**
 * One type relation row of the hierarchy block: `implements I1, I2`. Type rows build their entries with
 * {@link chainLink} and member rows with {@link memberRelationRow}; both share the list and disclosure markup of
 * {@link relationRowOf}.
 */
function relationRow(label: string, fqns: readonly string[], linkFor: LinkResolver, id?: string): string {
  return relationRowOf(label, fqns.map((fqn) => ({ text: shortName(fqn), html: chainLink(fqn, linkFor) })), id);
}

/**
 * A relation row whose entries are members rather than types: `obtainable from Bucket.fromBucketName`. Each
 * entry links to the owner's page at the member's row anchor (the same `memberAnchor` the row itself carries), so
 * the reader lands on the member; an entry owned by the page's own type links by fragment alone, so a version
 * catalog with hundreds of constants does not repeat its own path hundreds of times.
 *
 * The MEMBER NAME is the language variant, translated per enabled language through the same translators the
 * member rows use. The owner, the separator and the `<wbr>` are written once outside the variants, except for a
 * static in Go, where the separator is `_` (jsii exposes it as the package-level `Owner_Member`) and the whole
 * entry varies; an instance member keeps the dot in every language, because in Go it is called on a value. The
 * anchor stays on the canonical jsii name; the width budget uses the widest translation, so the two-line clamp
 * holds in every language. A `<wbr>` after the separator lets a long token wrap at narrow widths without changing
 * the accessible name; the agent Markdown twin drops the tag. An initializer entry reads `Owner (initializer)` in
 * every language, naming the section it links to rather than leaving a bare type name in a row of members, and an
 * entry whose short owner name is not unique in its row carries its namespace the same way,
 * `Owner.member (aws_events)`.
 */
function memberRelationRow(
  label: string,
  refs: readonly MemberRef[],
  linkFor: LinkResolver,
  pageFqn: string,
  languages: readonly Language[],
  id?: string,
): string {
  return relationRowOf(label, refs.map((ref) => {
    const owner = shortName(ref.ownerFqn);
    const note = ownerNote(ref.ownerFqn, refs);
    const suffix = (word: string) => (word ? ` (${word})` : '');
    const translate = ref.kind === 'method'
      ? translateMethodName
      : (name: string, lang: Language) => translatePropertyName(name, lang, ref.constant);
    const entry = (lang: Language) => ({ sep: lang === 'go' && ref.static ? '_' : '.', member: translate(ref.memberName, lang) });
    const langs = languages.length > 0 ? languages : [DEFAULT_LANGUAGE];
    const text = ref.kind === 'initializer'
      ? `${owner} ${INITIALIZER_SUFFIX}${suffix(note)}`
      : langs
        .map((lang) => `${owner}${entry(lang).sep}${entry(lang).member}${suffix(note)}`)
        .reduce((widest, candidate) => (candidate.length > widest.length ? candidate : widest));
    // Only the member name varies between languages, except for a Go static, where the separator does too. So the
    // owner, the separator and the `<wbr>` are emitted once wherever the separator is the same in every enabled
    // language: on the heaviest pages that is three of the five nodes an entry would otherwise cost per language.
    // The enclosing <nav> already carries `data-pagefind-ignore`, so the spans do not repeat it.
    const separators = new Set(langs.map((lang) => entry(lang).sep));
    const member = (lang: Language) => escHtml(entry(lang).member);
    const content = ref.kind === 'initializer'
      ? `${escHtml(owner)} ${INITIALIZER_SUFFIX}${escHtml(suffix(note))}`
      : (separators.size === 1
        ? `${escHtml(owner)}${[...separators][0]}<wbr>${languageVariantSpans(languages, member, { indexed: false })}`
        : languageVariantSpans(languages, (lang) => {
          const { sep } = entry(lang);
          return `${escHtml(owner)}${sep}<wbr>${member(lang)}`;
        }, { indexed: false })) + escHtml(suffix(note));
    const fragment = `#${memberAnchor(ref.memberName)}`;
    const link = ref.ownerFqn === pageFqn ? fragment : (() => {
      const page = linkFor(ref.ownerFqn);
      return page ? `${pageHref(page)}${fragment}` : undefined;
    })();
    const html = link
      ? `<a class="chain-item" href="${escapeAttr(link)}">${content}</a>`
      : `<span class="chain-item">${content}</span>`;
    return { text, html };
  }), id);
}

/**
 * The row markup both entry kinds share. The overflow disclosure is a SIBLING of the visible entries, never their
 * wrapper — entries inside `<summary>` would be a `nested-interactive` violation. The leading gutter is a CSS
 * border, not a `|` a screen reader would announce on every row.
 *
 * The entries are ONE `<ul>` per relation, so assistive tech announces the item count and boundaries; the
 * disclosure is the list's final item, with the hidden entries as a nested list inside it. `role` is re-asserted
 * explicitly because the items render `display: inline` with `list-style: none`, which makes WebKit strip native
 * list semantics, so the markup alone would announce nothing in Safari.
 */
function relationRowOf(label: string, items: readonly RelationItem[], id?: string): string {
  const { shown, hidden } = splitToBudget(items);
  // One formatted value for the visible text AND the accessible name:
  // WCAG 2.5.3 Label in Name requires the visible label to appear in the
  // accessible name, so `2,507 more` beside `aria-label="Show 2507 more"`
  // is a speech-input failure — and not one the axe gate can catch, since
  // 2.5.3 is not machine-testable.
  const count = hidden.length.toLocaleString('en-US');
  // The separator lives INSIDE the item, hugging the name it follows: raw text between `<li>` siblings is invalid in
  // a `<ul>`, and the sequence must still read as continuing past the disclosure control. Three states: `', '`
  // between names, a BARE `','` before the disclosure (its gap is `.chain-more`'s margin, so an emitted space would
  // widen it by a mono advance), and nothing at the end.
  const item = (entry: RelationItem, sep: ', ' | ',' | ''): string =>
    `<li role="listitem">${entry.html}${sep}</li>`;
  const visible = shown
    .map((entry, i) => item(entry, i < shown.length - 1 ? ', ' : hidden.length > 0 ? ',' : ''))
    .join('');
  const more = hidden.length > 0
    ? `<li role="listitem"><details class="chain-more"><summary aria-label="Show ${count} more">`
      + `${count} more</summary>`
      + `<ul class="chain-list" role="list">${hidden.map((entry, i) => item(entry, i < hidden.length - 1 ? ', ' : '')).join('')}</ul>`
      + '</details></li>'
    : '';
  const idAttr = id ? ` id="${escapeAttr(id)}"` : '';
  return `<div class="chain-row"${idAttr}><span class="chain-label">${label}</span> `
    + `<ul class="chain-list" role="list">${visible}${more}</ul></div>`;
}

/**
 * Type-hierarchy bar: breadcrumb trail from the root ancestor down to the type itself, with every documented
 * ancestor linked to its page (`Construct › Resource › Bucket`), followed by the interfaces the type implements:
 * `Construct › Resource › Bucket · implements IBucket`. Interfaces declared by ancestor classes are included
 * (deduplicated, own declarations first) — `Bucket` implements `IBucket` via `BucketBase`. Emitted whenever the
 * type has a base class, implemented interfaces, subclasses, or a member relation; the member rows come last.
 */
export function renderInheritanceChain(
  type: spec.ClassType,
  index: TypeIndex,
  linkFor: LinkResolver,
  subclasses: readonly string[] = [],
  usage: UsageRelations = {},
  languages: readonly Language[] = [DEFAULT_LANGUAGE],
): string[] {
  // One shared walk with the reverse implementers index, so `implements` here and `implemented by` there can never
  // disagree.
  const { ancestors, interfaces } = classLineage(type, index);
  const relations = visibleRelations(usage, []);
  if (ancestors.length === 0 && interfaces.length === 0 && subclasses.length === 0 && !hasMemberRows(relations)) {
    return [];
  }
  const items = ancestors.map((fqn) => {
    const link = linkFor(fqn);
    const name = escHtml(shortName(fqn));
    return link
      ? `<a class="chain-item" href="${escapeAttr(pageHref(link))}">${name}</a>`
      : `<span class="chain-item">${name}</span>`;
  });
  items.push(`<span class="chain-item chain-current">${escHtml(type.name)}</span>`);
  const sep = '<span class="chain-sep" aria-hidden="true">›</span>';
  const rows = [
    interfaces.length > 0 ? relationRow('implements', interfaces, linkFor) : '',
    // A class's downward relation.
    subclasses.length > 0 ? relationRow('superclass of', subclasses, linkFor) : '',
    memberRows(type.fqn, relations, linkFor, languages),
  ].join('');
  return hierarchyBlock(
    // Breadcrumbs repeat ancestor type names on every page; keep them out of the search index.
    `<nav class="inheritance-chain" aria-label="${escapeAttr(landmarkLabel(ancestors.length + interfaces.length + subclasses.length > 0))}" ${PAGEFIND_IGNORE}>`
    + `<div class="chain-line">${items.join(sep)}</div>${rows}</nav>`,
    hasVariantEntries(relations) ? languages : [],
  );
}

/**
 * What the block's landmark is called, chosen by what the block holds rather than by page kind: a block of usage
 * rows alone promises no hierarchy, so a screen-reader user jumping between landmarks is not sent to call sites
 * expecting ancestors.
 */
function landmarkLabel(hasTypeRelation: boolean): string {
  return hasTypeRelation ? 'Type hierarchy' : 'Type relations';
}

/**
 * The member rows a page actually shows. A usage the same block already states more specifically is dropped,
 * because reading one `Owner.member` twice in one block tells the reader nothing the first row did not: the
 * `used as props by` row already names the classes whose initializer takes a struct as props, and the
 * `obtainable from` row already names the statics that hand out an instance. Both are filtered here rather than in
 * the index, because whether the more specific row is on the page at all depends on the page kind — an enum or a
 * mixin page carries no `obtainable from` row, so its returners must stay listed.
 */
function visibleRelations(usage: UsageRelations, propsUsers: readonly string[]): Required<UsageRelations> {
  const obtainableFrom = usage.obtainableFrom ?? [];
  return {
    obtainableFrom,
    argumentIn: (usage.argumentIn ?? []).filter((ref) =>
      ref.kind !== 'initializer' || !propsUsers.includes(ref.ownerFqn)),
    returnedBy: (usage.returnedBy ?? []).filter((ref) => !obtainableFrom
      .some((factory) => factory.ownerFqn === ref.ownerFqn && factory.memberName === ref.memberName)),
  };
}

/**
 * The member relation rows, in one order on every page kind: the static members that hand out an instance, then
 * the members that take the type, then the members that return it. Each is the inverse of a member signature, so
 * they follow every type-to-type relation.
 */
function memberRows(
  pageFqn: string,
  usage: Required<UsageRelations>,
  linkFor: LinkResolver,
  languages: readonly Language[],
): string {
  const row = (label: string, refs: readonly MemberRef[], id: string): string =>
    (refs.length > 0 ? memberRelationRow(label, refs, linkFor, pageFqn, languages, id) : '');
  return [
    row('obtainable from', usage.obtainableFrom, SECTION_ANCHORS.obtainableFrom),
    row('used as argument in', usage.argumentIn, SECTION_ANCHORS.usedAsArgumentIn),
    row('returned by', usage.returnedBy, SECTION_ANCHORS.returnedBy),
  ].join('');
}

function memberEntries(usage: UsageRelations): readonly MemberRef[] {
  return [...usage.obtainableFrom ?? [], ...usage.argumentIn ?? [], ...usage.returnedBy ?? []];
}

function hasMemberRows(usage: UsageRelations): boolean {
  return memberEntries(usage).length > 0;
}

/** Whether any member entry is translated per language, which is what the `<LanguageTabs>` wrapper is for. */
function hasVariantEntries(usage: UsageRelations): boolean {
  return memberEntries(usage).some((ref) => ref.kind !== 'initializer');
}

/**
 * The block as page lines. Only member rows carry language variants (member names), so the block is wrapped in
 * `<LanguageTabs>` exactly when one of those entries is present; otherwise it is the bare `<nav>`.
 */
function hierarchyBlock(nav: string, languages: readonly Language[]): string[] {
  const lines = wrapLanguageTabs(languages, [nav]);
  return lines.length === 1 ? [nav, ''] : lines;
}

/**
 * Hierarchy bar for interface-like types (interfaces, structs, mixins): `IBucket · extends IResource`, each parent
 * linked to its page — the same presentation as the class inheritance chain. A struct's `used as props by` row lists
 * the classes whose initializer takes it as props; the member rows come last. Nothing is emitted for a type with no
 * relation to show.
 */
export function renderExtendsBar(
  type: spec.InterfaceType,
  linkFor: LinkResolver,
  implementers: readonly string[] = [],
  propsUsers: readonly string[] = [],
  usage: UsageRelations = {},
  languages: readonly Language[] = [DEFAULT_LANGUAGE],
): string[] {
  const parents = type.interfaces ?? [];
  const relations = visibleRelations(usage, propsUsers);
  if (parents.length === 0 && implementers.length === 0 && propsUsers.length === 0 && !hasMemberRows(relations)) {
    return [];
  }
  const rows = [
    parents.length > 0 ? relationRow('extends', parents, linkFor) : '',
    // The inverse of the class bar's `implements`, from the same lineage walk.
    implementers.length > 0 ? relationRow('implemented by', implementers, linkFor) : '',
    propsUsers.length > 0
      ? relationRow('used as props by', propsUsers, linkFor, SECTION_ANCHORS.usedAsPropsBy)
      : '',
    memberRows(type.fqn, relations, linkFor, languages),
  ].join('');
  return relationBar(
    type.name,
    rows,
    hasVariantEntries(relations) ? languages : [],
    parents.length + implementers.length + propsUsers.length > 0,
  );
}

/**
 * Relation bar for a type with no type-to-type relation of its own, which is the enum case: an enum extends
 * nothing and implements nothing, so its block exists only when a member takes it or returns it.
 */
export function renderUsageBar(
  type: spec.EnumType,
  linkFor: LinkResolver,
  usage: UsageRelations = {},
  languages: readonly Language[] = [DEFAULT_LANGUAGE],
): string[] {
  const relations = visibleRelations(usage, []);
  if (!hasMemberRows(relations)) {
    return [];
  }
  return relationBar(
    type.name,
    memberRows(type.fqn, relations, linkFor, languages),
    hasVariantEntries(relations) ? languages : [],
    false,
  );
}

/** The bar every type without a breadcrumb trail shares: the type's own name, then its relation rows. */
function relationBar(
  name: string,
  rows: string,
  languages: readonly Language[],
  hasTypeRelation: boolean,
): string[] {
  return hierarchyBlock(
    `<nav class="inheritance-chain" aria-label="${escapeAttr(landmarkLabel(hasTypeRelation))}" ${PAGEFIND_IGNORE}>`
    + `<div class="chain-line"><span class="chain-item chain-current">${escHtml(name)}</span></div>`
    + rows
    + '</nav>',
    languages,
  );
}

export interface PropsRenderOptions {
  /**
   * Enabled documentation languages. With 2+ languages each row's name/type cell embeds a variant per language; the
   * summary and expanded details stay single-copy.
   */
  readonly languages?: readonly Language[];
  /**
   * Namespace for this table's row anchors. A construct page inlines its props struct AND lists the type's own
   * properties, so a member documented in both would emit one id twice — invalid HTML, and a deep link that could
   * resolve to either row. The inlined table passes the section's own slug; the type's own members pass nothing and
   * keep the bare canonical slug, so every `#member` link stays byte-identical.
   */
  readonly anchorPrefix?: string;
  /**
   * Whether this table lists inputs or outputs. A struct prop is an INPUT the caller supplies: a required one gets
   * the `required` badge, an optional one a `?` spoken as `optional`. A class or interface property is an OUTPUT
   * the caller reads: it never gets the `required` badge, and an optional one gets a `?` spoken as
   * `may be undefined`. Defaults to `input`.
   */
  readonly optionalKind?: OptionalKind;
}

/**
 * Whether an optional property is an input the caller may omit (a struct prop) or an output that may be undefined
 * (a class or interface property). See `docs/adr/2026-10-23-optional-prop-marker.md`.
 */
export type OptionalKind = 'input' | 'output';

/** The words a screen reader hears in place of the visible `?`, per kind. */
export const OPTIONAL_LABELS: Readonly<Record<OptionalKind, string>> = {
  input: 'optional',
  output: 'may be undefined',
};

/**
 * The `?` after an optional property's name. Display only: the mark itself is hidden from assistive technology,
 * which hears the kind's label instead; neither is indexed by Pagefind, and the theme makes both unselectable, so a
 * copied name needs no cleanup. Anchors, permalinks and the Markdown output never read this span.
 */
function optionalMarkHtml(kind: OptionalKind): string {
  return `<span class="member-optional" ${PAGEFIND_IGNORE}>`
    + '<span aria-hidden="true">?</span>'
    + `<span class="member-optional-label">${OPTIONAL_LABELS[kind]}</span>`
    + '</span>';
}

/**
 * Prose short enough to render inline rather than behind a disclosure. "Three lines" is the design intent, but line
 * count depends on viewport width and font metrics and docgen emits static markdown, so the rule is a character
 * budget approximating three lines at the content column's width. A CSS `-webkit-line-clamp: 3` would give true
 * lines, but then every row needs a disclosure in case it clamps, which defeats the point.
 */
const INLINE_PROSE_BUDGET = 240;

/** A default value longer than this is truncated in the header line. */
const INLINE_DEFAULT_BUDGET = 32;

/**
 * Is a `@default` a short code-like VALUE, or descriptive PROSE?
 *
 * A value is one token with no internal whitespace that still fits the inline
 * budget — `undefined`, `true`, `s3.BucketEncryption.KMS`, `-1`. It stays
 * inline in the header as `= value`. Anything else is prose — a phrase such as
 * `Assigned by CloudFormation (recommended)` — and is shown in full on its own
 * always-visible line labelled `Default:`, because a default is one of the
 * first things a reader looks for and truncating it behind the disclosure hides
 * exactly that. The whitespace test is what separates the two: a sentence has
 * spaces, a code literal does not. `defaultText` has already collapsed internal
 * whitespace to single spaces, so a space here is a word boundary.
 */
function isValueDefault(text: string): boolean {
  return !text.includes(' ') && text.length <= INLINE_DEFAULT_BUDGET;
}

/**
 * The `#` permalink, last in the row's markup so assistive technology reads the name first, shown in the row's left
 * gutter. The row carries the id, so navigating to it lands on the whole member rather
 * than one span inside it, and the slug comes from {@link memberAnchor} — pinned to the canonical TypeScript name,
 * so a deep link survives a language switch. The identifier beside it is deliberately NOT a link: two anchors on one
 * destination would be two tab stops, and a mono-bold name that looks clickable next to a type link reads as a
 * mistake.
 */
function memberPermalink(anchorId: string, label: string): string {
  // Kept out of the search index: a `#` in every excerpt is noise.
  // The attribute goes last: outline-members.ts reads the href and aria-label as one adjacent pair.
  return `<a class="member-permalink" href="#${anchorId}"`
    + ` aria-label="${escapeAttr(`Permalink to ${label}`)}" ${PAGEFIND_IGNORE}>#</a>`;
}

/**
 * The disclosure's accessible name, built from what is inside it. jsii's own field names are not reader-facing
 * vocabulary — "Remarks" tells a reader nothing about what expanding will show.
 */
function disclosureLabel(parts: readonly string[]): string {
  return parts.length === 0 ? 'more detail' : parts.join(' · ');
}

/**
 * A member's header line, summary line, and either inline prose or a disclosure. `optional` and `params` are the
 * row's display data for the in-page outline: `data-optional` carries the optional state as data and `data-params`
 * a method's encoded parameter list, so the outline reads both from the same jsii declaration that drew the row
 * (see outline-members.ts), never from the rendered name or signature.
 */
function memberRow(
  anchorId: string,
  label: string,
  headerParts: readonly string[],
  summary: string | undefined,
  prose: string[],
  detail: { readonly lines: string[]; readonly labels: readonly string[] },
  indexBody = true,
  optional?: OptionalKind,
  params?: string,
): string[] {
  const optionalAttr = optional ? ` data-optional="${optional}"` : '';
  const paramsAttr = params === undefined ? '' : ` data-params="${params}"`;
  const lines = [`<div class="member-row" id="${anchorId}"${optionalAttr}${paramsAttr}>`];
  lines.push(
    // A space between the parts, so the search excerpt reads `name static deprecated` rather than one run-together
    // word. The line is a flex row, so the spaces between its items take no room on screen.
    '<div class="member-line">'
    + [...headerParts, memberPermalink(anchorId, label)].join(' ')
    + '</div>',
  );
  const bodyIndexing = indexBody ? '' : ` ${PAGEFIND_IGNORE}`;
  if (summary) {
    lines.push(`<div class="member-summary"${bodyIndexing}>${escapeSummaryHtml(summary.replace(/\s+/g, ' ').trim())}</div>`);
  }
  if (prose.length > 0) {
    lines.push(`<div class="member-extra"${bodyIndexing}>`, '', ...prose, '</div>');
  }
  if (detail.lines.length > 0) {
    // The header line stays a SIBLING of the <details>, never inside its <summary>: nesting type links inside a
    // control is a `nested-interactive` accessibility violation.
    lines.push(
      `<details class="member-disclosure"${bodyIndexing}>`,
      `<summary>${escHtml(disclosureLabel(detail.labels))}</summary>`,
      '<div class="member-details">',
      '',
      ...detail.lines,
      '</div>',
      '</details>',
    );
  }
  lines.push('</div>');
  return lines;
}

/**
 * Chrome-less member rows. Every member — property or method — is one uniform row: a header line, a summary line,
 * then short prose inline or long prose behind a labeled disclosure. The container is `v-pre` so type text like
 * `{ [key: string]: string }` cannot trip Vue interpolation.
 */
export function renderExpandableProps(
  props: spec.Property[],
  linkFor: LinkResolver,
  options: PropsRenderOptions = {},
): string[] {
  if (props.length === 0) {
    return ['_No properties._', ''];
  }
  const languages = options.languages ?? [DEFAULT_LANGUAGE];
  // Property names belong to the owning type-page search entry, matching
  // methods without creating per-member results. Property descriptions and
  // repeated types stay out of the index via their local ignore attributes.
  const lines: string[] = ['<div class="props-table member-list" v-pre>'];
  for (const prop of props) {
    lines.push(...renderPropRow(prop, linkFor, languages, options.anchorPrefix, options.optionalKind ?? 'input'));
  }
  lines.push('</div>', '');
  // The `v-pre` rows are static HTML, so per-language name/type spans flip via the surrounding <LanguageTabs> CSS.
  return wrapLanguageTabs(languages, lines);
}

/**
 * Blank the `title` over type links. The type span carries the full spelling in a `title`, and a native
 * tooltip is inherited by descendants — so a linked type would show the browser bubble on top of the richer hover
 * card `type-tooltips.ts` renders for it. An empty `title` on the anchor suppresses the bubble there and leaves it
 * on the bare text around it.
 */
function withoutAnchorTooltips(html: string): string {
  return html.replace(/<a class="sig-type" /g, '<a class="sig-type" title="" ');
}

/**
 * Longest qualified name the narrowest content column holds whole: about 36 monospace characters at 375px and the
 * largest density. A shorter name never has to break, and a dot in it is a worse break than the space or bracket
 * beside it.
 */
const TYPE_NAME_BREAK_BUDGET = 32;

/**
 * Follow every dot in an over-budget qualified name with a `<wbr>`, so a name wider than its row
 * (`CfnRegistry.CustomMetadataSchemaConfigurationProperty`) wraps after a dot rather than overflowing, while
 * `typing.List[…]` stays together. Only text is touched, never a tag's `href`; `<wbr>` is empty, so text content is
 * unchanged.
 */
function withDotBreaks(html: string): string {
  return html.split(/(<[^>]*>)/).map((part) => part.startsWith('<')
    ? part
    : part.replace(/[\w.]+/g, (name) => (name.length > TYPE_NAME_BREAK_BUDGET ? name.replace(/\./g, '.<wbr>') : name)),
  ).join('');
}

/**
 * jsii writes most `@default` values as PROSE rather than a value: a leading `- ` is its conventional
 * "no value — here is what happens instead" form (`- No display name`). Emitted verbatim after `= ` it reads as
 * broken markup (`= - No display name`), so the marker is stripped and the prose kept.
 *
 * The marker is recognized at end-of-string as well as before whitespace, so a `@default -` with nothing after it
 * does not render a bare `= -`. Requiring whitespace OR the end leaves a literal negative default (`-1`) untouched.
 */
function defaultText(raw: string | undefined): string | undefined {
  // Collapse first: a `@default` is a doc block and can span lines. A newline
  // survives `escapeAttr` (it escapes quotes, not whitespace), and inside
  // `title="…"` it carries the attribute onto the next source line — the Vue
  // compiler then reads the following text as attribute names and fails the
  // page. A blank line would also terminate the surrounding raw-HTML block.
  // Collapsing here covers the title, the visible cell and the length test
  // against INLINE_DEFAULT_BUDGET in one place.
  const trimmed = raw?.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^-(?:\s+|$)/, '').trim() || undefined;
}

function propRowHtml(
  prop: spec.Property,
  linkFor: LinkResolver,
  languages: readonly Language[],
  optionalKind: OptionalKind,
): string[] {
  const deprecated = prop.docs?.deprecated;
  // Name and type are language-variant: one span per enabled language; the trailing markers and summary are
  // neutral, single-copy.
  const nameAndType = languageVariantSpans(languages, (lang) => {
    const name = escHtml(translatePropertyName(prop.name, lang, prop.const));
    // Every language links its types, not just TypeScript. The link resolves from the jsii reference while the text
    // stays the language's own spelling of the type.
    const type = lang === 'ts'
      ? typeRefHtml(prop.type, linkFor)
      : translatedTypeRefHtml(prop.type, lang, linkFor);
    // The full spelling stays in `title` as plain text; the visible copy carries the `<wbr>` break points.
    const full = lang === 'ts' ? typeRefText(prop.type) : translateTypeRef(prop.type, lang);
    // Strikethrough marks the IDENTIFIER only — running it over the type or the anchor reads as a scribble.
    const nameClass = deprecated ? 'member-name member-name-deprecated' : 'member-name';
    // The `?` sits right after the name, in every language: optionality is a fact about the member, not about how
    // one language spells it.
    const mark = prop.optional ? optionalMarkHtml(optionalKind) : '';
    return `<code class="${nameClass}">${name}</code>${mark}`
      + `<span class="member-type" data-pagefind-ignore title="${escapeAttr(full)}">`
      + `${withDotBreaks(withoutAnchorTooltips(type))}</span>`;
  });
  const parts = [nameAndType];
  const fullDefault = defaultText(prop.docs?.default);
  if (fullDefault && isValueDefault(fullDefault)) {
    // A value default is one token within the budget, so it renders inline in
    // full with no ellipsis. A prose default is NOT shown here — it goes on its
    // own always-visible `Default:` line below (see renderPropRow), so the
    // reader never has to expand the row to read it.
    parts.push(
      `<span class="member-default" data-pagefind-ignore>= ${escHtml(fullDefault)}</span>`,
    );
  }
  if (!prop.optional && optionalKind === 'input') {
    // A distinct badge, not muted inline text: a reader skimming a long props
    // table must be able to spot the mandatory properties at a glance. The
    // badge styling lives on the `.member-required` rule; the class also lets a
    // test assert the required row carries it while optional rows do not.
    // Inputs only: a non-optional OUTPUT (a class or interface property such as
    // `bucketArn`) is always set, and nobody supplies it, so "required" would
    // misread as "you must pass this". See
    // `docs/adr/2026-10-26-required-badge-inputs-only.md`.
    parts.push('<span class="member-required">required</span>');
  }
  if (prop.static) {
    parts.push('<span class="member-static">static</span>');
  }
  if (deprecated) {
    parts.push('<span class="member-deprecated">deprecated</span>');
  }
  return parts;
}

function renderPropRow(
  prop: spec.Property,
  linkFor: LinkResolver,
  languages: readonly Language[],
  anchorPrefix: string | undefined,
  optionalKind: OptionalKind,
): string[] {
  const header = propRowHtml(prop, linkFor, languages, optionalKind);
  const deprecated = prop.docs?.deprecated?.trim();
  // A deprecation reason replaces the summary: it is what a reader needs
  // first, and showing both puts the superseded description on top.
  const summary = deprecated || prop.docs?.summary;
  const remarks = prop.docs?.remarks?.trim();
  const fullDefault = defaultText(prop.docs?.default);
  const prose: string[] = [];
  const detail: string[] = [];
  const labels: string[] = [];
  // A prose default is shown in full on its own always-visible line, labelled
  // `Default:`, so the reader never has to expand the row to read it. A value
  // default is already inline in the header, so it is NOT repeated here —
  // emitting it again is the duplicate `Default:` the issue rules out. Placed
  // ahead of remarks: the default is one of the first things a reader wants.
  if (fullDefault && !isValueDefault(fullDefault)) {
    prose.push(`**Default:** ${escapeProse(fullDefault)}`, '');
  }
  if (remarks) {
    if (remarks.length <= INLINE_PROSE_BUDGET) {
      prose.push(escapeProse(remarks), '');
    } else {
      detail.push(escapeProse(remarks), '');
      labels.push('notes');
    }
  }
  if (prop.docs?.example) {
    detail.push(...codeFence(prop.docs.example, 'ts'), '');
    labels.push('example');
  }
  const slug = memberAnchor(prop.name);
  const id = anchorPrefix ? `${anchorPrefix}-${slug}` : slug;
  return memberRow(id, prop.name, header, summary, prose,
    { lines: detail, labels }, false, prop.optional ? optionalKind : undefined);
}

/** Own methods plus those inherited along the base-class chain, sorted. */
export function classMethods(type: spec.ClassType, index: TypeIndex): spec.Method[] {
  const seen = new Map<string, spec.Method>();
  let current: string | undefined = type.fqn;
  while (current) {
    const entry = index.get(current);
    if (!entry || !spec.isClassType(entry.type)) {
      break;
    }
    for (const method of entry.type.methods ?? []) {
      if (!method.protected && !seen.has(method.name)) {
        seen.set(method.name, method);
      }
    }
    current = entry.type.base;
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Own properties plus those inherited along the base-class chain, sorted. */
export function classProperties(type: spec.ClassType, index: TypeIndex): spec.Property[] {
  const seen = new Map<string, spec.Property>();
  let current: string | undefined = type.fqn;
  while (current) {
    const entry = index.get(current);
    if (!entry || !spec.isClassType(entry.type)) {
      break;
    }
    for (const prop of entry.type.properties ?? []) {
      if (!prop.protected && !seen.has(prop.name)) {
        seen.set(prop.name, prop);
      }
    }
    current = entry.type.base;
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `## Methods` section: heading, highlighted signature, and summary per method, with remarks, parameter docs, and
 * examples folded into a collapsible details block.
 *
 * Member-name display flips with the active language: with 2+ languages each heading carries one `.lang-variant`
 * name span per enabled language and the whole section body sits in a `<LanguageTabs>` group so the shared state
 * reaches the heading and parameter-name spans. Identity stays canonical: the `#anchor` is pinned to the slug
 * derived from the jsii/TypeScript name, so deep links survive a client-side language switch.
 */
export function renderMethodsSection(
  methods: spec.Method[],
  linkFor: LinkResolver,
  ownerFqn: string,
  languages: readonly Language[] = [DEFAULT_LANGUAGE],
): string[] {
  if (methods.length === 0) {
    return [];
  }
  // Nothing here is excluded from the index at the container or row level. The exclusion that keeps repeated TYPE
  // NAMES out of search sits only on the parameter and return portion of each signature (see `inlineMethodSignature`):
  // the method's own identifier lives in that same header line, and excluding the whole line would take every method
  // name out of the index too.
  const body: string[] = ['<div class="methods-table member-list" v-pre>'];
  for (const method of methods) {
    body.push(...renderMethodRow(method, linkFor, ownerFqn, languages));
  }
  body.push('</div>', '');
  return [anchoredHeading(2, 'Methods', SECTION_ANCHORS.methods), '', ...wrapLanguageTabs(languages, body)];
}

/**
 * One method as a member row. The header line carries the full signature inline, so a method costs the same single
 * row as a property. Per-member deep links are the `#` permalink, which resolves to the same slug a heading would
 * produce.
 */
function renderMethodRow(
  method: spec.Method,
  linkFor: LinkResolver,
  ownerFqn: string,
  languages: readonly Language[],
): string[] {
  const deprecated = method.docs?.deprecated?.trim();
  const signature = languageVariantSpans(languages, (lang) => {
    const sig = lang === 'ts'
      ? inlineMethodSignature(method, { linkFor, ownerFqn })
      : escHtml(translateMethodSignature(method, lang));
    const cls = deprecated ? 'member-signature member-name-deprecated' : 'member-signature';
    return `<code class="${cls}">${withoutAnchorTooltips(sig)}</code>`;
  });
  const header = [signature];
  if (method.static) {
    header.push('<span class="member-static">static</span>');
  }
  if (deprecated) {
    header.push('<span class="member-deprecated">deprecated</span>');
  }
  const summary = deprecated || method.docs?.summary;
  const remarks = method.docs?.remarks?.trim();
  const prose: string[] = [];
  const detail: string[] = [];
  const labels: string[] = [];
  if (remarks) {
    if (remarks.length <= INLINE_PROSE_BUDGET) {
      prose.push(escapeProse(remarks), '');
    } else {
      detail.push(escapeProse(remarks), '');
      labels.push('notes');
    }
  }
  const documented = (method.parameters ?? []).filter((p) => p.docs?.summary);
  if (documented.length > 0) {
    detail.push('**Parameters**', '');
    for (const param of documented) {
      // Parameter names are language-variant, same span mechanism as the header line's; the doc summary is neutral.
      const name = languageVariantSpans(
        languages,
        (lang) => `\`${translateParameterName(param.name, lang)}\``,
      );
      detail.push(`- ${name} — ${escapeCell(param.docs!.summary!)}`);
    }
    detail.push('');
    labels.push(`${documented.length} ${documented.length === 1 ? 'parameter' : 'parameters'}`);
  }
  if (method.docs?.returns) {
    detail.push(`**Returns:** ${escapeCell(method.docs.returns)}`, '');
    labels.push('returns');
  }
  if (method.docs?.example) {
    detail.push(...codeFence(method.docs.example, 'ts'), '');
    labels.push('example');
  }
  // The outline shows the parameter names: encoded from the same declaration the signature above was built from.
  return memberRow(memberAnchor(method.name), method.name, header, summary, prose,
    { lines: detail, labels }, true, undefined, encodeOutlineParams(method.parameters));
}
