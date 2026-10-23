import * as spec from '@jsii/spec';
import { anchoredHeading, SECTION_ANCHORS } from './anchors.js';
import type { TypeIndex } from './constructs.js';
import { escapeAttr, escapeVueText } from './escape.js';
import { codeFence, mapProse } from './fences.js';
import { classLineage } from './interfaces.js';
import {
  DEFAULT_LANGUAGE,
  Language,
  translateMethodSignature,
  translateParameterName,
  translatePropertyName,
  translateTypeRef,
} from './languages.js';
import { pageHref } from './links.js';
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
  /** Pre-escaped inline HTML: a link, or plain text. */
  readonly value: string;
}

/**
 * Provenance block under the type-hierarchy bar: the CloudFormation resource, the L1 counterpart and the source
 * location, each rendered only when the type has it.
 *
 * A definition list, not a table: `<dt>`/`<dd>` pairs are the structure the CSS grid needs, so row count is never
 * encoded in a selector.
 *
 * Emitted independently of the hierarchy emitters, which return nothing when a type has no relations — the block
 * must still render there.
 */
export function renderTypeMetadata(rows: readonly TypeMetadataRow[]): string[] {
  if (rows.length === 0) {
    return [];
  }
  const pairs = rows
    .map((row) => `<dt class="type-metadata-label">${escHtml(row.label)}</dt>`
      + `<dd class="type-metadata-value">${row.value}</dd>`)
    .join('');
  return [`<dl class="type-metadata" aria-label="Type metadata">${pairs}</dl>`, ''];
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

/** Names that fit the row's two-line budget, and the remainder. */
function splitToBudget(fqns: readonly string[]): { shown: string[]; hidden: string[] } {
  const shown: string[] = [];
  let used = 0;
  for (const fqn of fqns) {
    const width = shortName(fqn).length + 2; // + comma and space
    // Always show at least one name: a single name wider than the whole
    // budget must still render, or the row would be nothing but a
    // disclosure.
    if (shown.length > 0 && used + width > RELATION_ROW_BUDGET) {
      break;
    }
    used += width;
    shown.push(fqn);
  }
  return { shown, hidden: fqns.slice(shown.length) };
}

/**
 * One relation row of the hierarchy block: `implements I1, I2`. Every row reuses {@link chainLink}, so there is
 * exactly one emitter of cross-reference anchors for the whole block. The overflow disclosure is a SIBLING of the
 * visible names, never their wrapper — names inside `<summary>` would be a `nested-interactive` violation. The
 * leading gutter is a CSS border, not a `|` a screen reader would announce on every row.
 *
 * The names are ONE `<ul>` per relation, so assistive tech announces the item count and boundaries; the disclosure
 * is the list's final item, with the hidden names as a nested list inside it. `role` is re-asserted explicitly
 * because the items render `display: inline` with `list-style: none`, which makes WebKit strip native list
 * semantics, so the markup alone would announce nothing in Safari.
 */
function relationRow(label: string, fqns: readonly string[], linkFor: LinkResolver, id?: string): string {
  const { shown, hidden } = splitToBudget(fqns);
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
  const item = (fqn: string, sep: ', ' | ',' | ''): string =>
    `<li role="listitem">${chainLink(fqn, linkFor)}${sep}</li>`;
  const visible = shown
    .map((fqn, i) => item(fqn, i < shown.length - 1 ? ', ' : hidden.length > 0 ? ',' : ''))
    .join('');
  const more = hidden.length > 0
    ? `<li role="listitem"><details class="chain-more"><summary aria-label="Show ${count} more">`
      + `${count} more</summary>`
      + `<ul class="chain-list" role="list">${hidden.map((fqn, i) => item(fqn, i < hidden.length - 1 ? ', ' : '')).join('')}</ul>`
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
 * type has a base class or implemented interfaces.
 */
export function renderInheritanceChain(
  type: spec.ClassType,
  index: TypeIndex,
  linkFor: LinkResolver,
  subclasses: readonly string[] = [],
): string[] {
  // One shared walk with the reverse implementers index, so `implements` here and `implemented by` there can never
  // disagree.
  const { ancestors, interfaces } = classLineage(type, index);
  if (ancestors.length === 0 && interfaces.length === 0 && subclasses.length === 0) {
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
  ].join('');
  return [
    // Breadcrumbs repeat ancestor type names on every page; keep them out of the search index.
    `<nav class="inheritance-chain" aria-label="Type hierarchy" ${PAGEFIND_IGNORE}>`
    + `<div class="chain-line">${items.join(sep)}</div>${rows}</nav>`,
    '',
  ];
}

/**
 * Hierarchy bar for interface-like types (interfaces, structs, mixins): `IBucket · extends IResource`, each parent
 * linked to its page — the same presentation as the class inheritance chain. A struct's `used as props by` row lists
 * the classes whose initializer takes it as props. Nothing is emitted for a type with no relation to show.
 */
export function renderExtendsBar(
  type: spec.InterfaceType,
  linkFor: LinkResolver,
  implementers: readonly string[] = [],
  propsUsers: readonly string[] = [],
): string[] {
  const parents = type.interfaces ?? [];
  if (parents.length === 0 && implementers.length === 0 && propsUsers.length === 0) {
    return [];
  }
  const rows = [
    parents.length > 0 ? relationRow('extends', parents, linkFor) : '',
    // The inverse of the class bar's `implements`, from the same lineage walk.
    implementers.length > 0 ? relationRow('implemented by', implementers, linkFor) : '',
    propsUsers.length > 0
      ? relationRow('used as props by', propsUsers, linkFor, SECTION_ANCHORS.usedAsPropsBy)
      : '',
  ].join('');
  return [
    `<nav class="inheritance-chain" aria-label="Type hierarchy" ${PAGEFIND_IGNORE}>`
    + `<div class="chain-line"><span class="chain-item chain-current">${escHtml(type.name)}</span></div>`
    + rows
    + '</nav>',
    '',
  ];
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
   * What an optional property means in this table, which picks the words a screen reader hears for its `?` mark:
   * a struct prop is an INPUT the caller may leave out (`optional`), a class or interface property is an OUTPUT
   * whose value may be missing (`may be undefined`). Defaults to `input`.
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
  return `<a class="member-permalink" href="#${anchorId}"`
    + ` aria-label="${escapeAttr(`Permalink to ${label}`)}">#</a>`;
}

/**
 * The disclosure's accessible name, built from what is inside it. jsii's own field names are not reader-facing
 * vocabulary — "Remarks" tells a reader nothing about what expanding will show.
 */
function disclosureLabel(parts: readonly string[]): string {
  return parts.length === 0 ? 'more detail' : parts.join(' · ');
}

/** A member's header line, summary line, and either inline prose or a disclosure. */
function memberRow(
  anchorId: string,
  label: string,
  headerParts: readonly string[],
  summary: string | undefined,
  prose: string[],
  detail: { readonly lines: string[]; readonly labels: readonly string[] },
  indexBody = true,
  optional?: OptionalKind,
): string[] {
  // `data-optional` carries the row's optional state as data, so the outline reads it from the same jsii flag that
  // drew the row's `?` (see outline-members.ts), never from the rendered name.
  const optionalAttr = optional ? ` data-optional="${optional}"` : '';
  const lines = [`<div class="member-row" id="${anchorId}"${optionalAttr}>`];
  lines.push(
    '<div class="member-line">'
    + headerParts.join('')
    + memberPermalink(anchorId, label)
    + '</div>',
  );
  const bodyIndexing = indexBody ? '' : ` ${PAGEFIND_IGNORE}`;
  if (summary) {
    lines.push(`<div class="member-summary"${bodyIndexing}>${escHtml(summary.replace(/\s+/g, ' ').trim())}</div>`);
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
 * Blank the `title` over type links. The clamped type span carries the full spelling in a `title`, and a native
 * tooltip is inherited by descendants — so a linked type would show the browser bubble on top of the richer hover
 * card `type-tooltips.ts` renders for it. An empty `title` on the anchor suppresses the bubble there and leaves it
 * on the bare or clipped text around it.
 */
function withoutAnchorTooltips(html: string): string {
  return html.replace(/<a class="sig-type" /g, '<a class="sig-type" title="" ');
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
    const name = escHtml(translatePropertyName(prop.name, lang));
    // Every language links its types, not just TypeScript. The link resolves from the jsii reference while the text
    // stays the language's own spelling of the type.
    const type = lang === 'ts'
      ? typeRefHtml(prop.type, linkFor)
      : translatedTypeRefHtml(prop.type, lang, linkFor);
    // The type is clamped to keep the header line readable, so the full spelling stays reachable in `title`.
    const full = lang === 'ts' ? typeRefText(prop.type) : translateTypeRef(prop.type, lang);
    // Strikethrough marks the IDENTIFIER only — running it over the type or the anchor reads as a scribble.
    const nameClass = deprecated ? 'member-name member-name-deprecated' : 'member-name';
    // The `?` sits right after the name, in every language: optionality is a fact about the member, not about how
    // one language spells it.
    const mark = prop.optional ? optionalMarkHtml(optionalKind) : '';
    return `<code class="${nameClass}">${name}</code>${mark}`
      + `<span class="member-type" data-pagefind-ignore title="${escapeAttr(full)}">${withoutAnchorTooltips(type)}</span>`;
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
  if (!prop.optional) {
    // A distinct badge, not muted inline text: a reader skimming a long props
    // table must be able to spot the mandatory properties at a glance. The
    // badge styling lives on the `.member-required` rule; the class also lets a
    // test assert the required row carries it while optional rows do not.
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
  return memberRow(memberAnchor(method.name), method.name, header, summary, prose,
    { lines: detail, labels });
}
