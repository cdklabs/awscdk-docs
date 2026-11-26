import * as spec from '@jsii/spec';
import { STABILITY_ROUTE } from '../site-routes.js';
import { escapeAttr, escapeSummaryHtml, escapeVueText } from './escape.js';
import { pageHref } from './links.js';
import { PAGEFIND_IGNORE, weightedTitle } from './search.js';
import { typeStability } from './stability.js';

/** One segment of the breadcrumb rendered above a type page's H1. */
export interface BreadcrumbSegment {
  /** Text shown for the segment. */
  readonly label: string;
  /**
   * Page link for the segment. The current page and structural groupings without an overview page may lack one.
   * Only the final segment renders bold.
   */
  readonly link?: string;
}

/**
 * Breadcrumbs longer than this collapse their middle segments: the first
 * two (package + submodule) and the segment directly above the current
 * type always stay visible.
 */
const BREADCRUMB_MAX_SEGMENTS = 4;

/**
 * A dot inside one segment's own label, plus a soft-wrap opportunity after it. Shown, because it is part of the name.
 */
const DOT = '.<wbr>';

/**
 * The separator BETWEEN segments: a real `.` so a selection copies the FQN, wrapped so CSS can collapse it to no
 * size and paint a chevron in its place, plus the same wrap opportunity after it.
 */
const JOIN = '<span class="breadcrumb-dot">.</span><wbr>';

/**
 * Breadcrumb-style module hierarchy rendered above the symbol H1:
 * `aws-cdk-lib . aws_s3 . Bucket`, each ancestor linking to its module or submodule page. Labels and links are
 * emitted as escaped HTML, so a label is never read as markdown or Vue syntax and a link is always a page href.
 * Excluded from the Pagefind index.
 *
 * Segments join on a real `.` with no surrounding whitespace, so selecting the trail copies the type's FQN
 * verbatim; what a reader sees between segments is a chevron drawn in CSS, which selection does not see. Only the
 * joins are collapsed that way — a dot inside a segment's own label, as a nested type carries, stays visible.
 *
 * Every dot is followed by a `<wbr>`, so a trail too wide for its line wraps after a dot rather than at the
 * hyphens inside `aws-cdk-lib`, which are otherwise its only natural break points. `<wbr>` is an empty element:
 * it adds nothing to a selection or to `innerText`, so the copied FQN is unchanged.
 *
 * The bar also carries a trailing `breadcrumb-fav` mount point: the theme's icon-only FavoriteStar teleports into
 * it so breadcrumb and favorite share a single row. Over-long trails collapse their middle segments: the labels
 * stay in the DOM as text, so a selection still copies the whole FQN, and CSS paints the ellipsis in their place.
 */
export function renderBreadcrumb(segments: readonly BreadcrumbSegment[]): string[] {
  if (segments.length === 0) {
    return [];
  }
  // Blank lines let markdown-it parse the inner lines as markdown
  // (links) inside the raw-HTML container — same pattern as ignoreBlock.
  return [
    `<nav class="type-breadcrumb" aria-label="Module hierarchy" ${PAGEFIND_IGNORE}>`,
    '',
    `<span class="breadcrumb-trail">${crumbParts(segments).join(JOIN)}</span>`,
    '',
    '<span class="breadcrumb-fav"></span>',
    '',
    '</nav>',
    '',
  ];
}

/**
 * Rendered crumb list with middle-collapse: trails longer than {@link BREADCRUMB_MAX_SEGMENTS} keep the first two
 * segments (package + submodule) and the last two (the segment above the current type, and the type itself).
 *
 * The hidden labels are still emitted as text so the trail keeps copying as the whole FQN — CSS shrinks them away
 * and paints the ellipsis — with `title` retained as hover text. Dropping that text node would break the copy.
 */
function crumbParts(segments: readonly BreadcrumbSegment[]): string[] {
  // Bold marks the current page, so only the LAST segment earns it. An ancestor without a link is a real case: a
  // structural grouping like `interfaces` may lack an overview page, and bolding it would claim "you are here" twice.
  const last = segments.length - 1;
  const crumb = (s: BreadcrumbSegment, i: number): string => {
    if (s.link) {
      return `<a href="${escapeAttr(pageHref(s.link))}">${escapeVueText(s.label)}</a>`;
    }
    // Wrapped so the segment carries the same padding as a linked or bold one:
    // the spacing between segments is padding, and a bare text node has none.
    // A nested type arrives as one label carrying its enclosing type (`CfnBucket.PolicyProperty`), so its own
    // dot needs the same wrap opportunity as the joins.
    return i === last
      ? `<strong>${escapeVueText(s.label).split('.').join(DOT)}</strong>`
      : `<span class="breadcrumb-segment">${escapeVueText(s.label)}</span>`;
  };
  // Rendered by ABSOLUTE index before any slicing: the collapse below
  // slices the rendered strings, so deciding "is this the last segment"
  // after slicing would read a slice-relative index and lose the bold.
  const rendered = segments.map(crumb);
  if (segments.length <= BREADCRUMB_MAX_SEGMENTS) {
    return rendered;
  }
  const hidden = segments.slice(2, -2).map((s) => s.label).join('.');
  return [
    ...rendered.slice(0, 2),
    `<span class="breadcrumb-ellipsis" title="${escapeAttr(hidden)}">${escapeVueText(hidden)}</span>`,
    ...rendered.slice(-2),
  ];
}

/** The kind chip shown first in a type page's header row. */
export interface TypeKindChip {
  /** Chip text, e.g. `L2 construct`, `Struct`, `Mixin`. */
  readonly text: string;
  /** Per-kind color class, e.g. `api-badge-l2`. Omitted for a plain class, which keeps the neutral chip. */
  readonly kindClass?: string;
}

/** What a type page's header needs beyond its name. */
export interface TypeHeaderOptions {
  /** Type name, rendered as the H1. */
  readonly name: string;
  /** Kind chip; always present. */
  readonly kind: TypeKindChip;
  /** jsii stability of the type. A type with none shows no stability chip. */
  readonly stability?: 'stable' | 'experimental' | 'deprecated' | 'external';
  /** The `@deprecated` reason, shown as a note under the row when the type is deprecated. */
  readonly deprecationReason?: string;
}

/** Stability chips, keyed by jsii stability. `external` and an absent stability show no chip. */
const STABILITY_CHIPS: Readonly<Record<string, { label: string; chipClass: string; link?: string } | undefined>> = {
  stable: { label: 'Stable', chipClass: 'type-chip-stable' },
  experimental: { label: 'Experimental', chipClass: 'type-chip-experimental', link: STABILITY_ROUTE },
  deprecated: { label: 'Deprecated', chipClass: 'type-chip-deprecated' },
};

/**
 * The top of a type page: the H1 carrying the type name alone, then one row holding the kind chip, the stability
 * chip and the mount points the theme's page actions teleport into, then — for a deprecated type — the reason.
 *
 * The kind sits in the row rather than the H1, so the heading is the name a reader came for and the classification
 * sits beside the controls that act on the page. Every type states its stability, "Stable" included, so that no
 * reader has to decide whether a missing chip means "stable" or "not shown".
 *
 * The row is one raw-HTML block, so markdown-it passes it through whole and the chips need no markdown escape; it is
 * excluded from the Pagefind index, because the kind is already a `kind:` search filter and the stability is stated
 * in the indexed metadata row and, on an alpha package, in the banner. A deprecated type strikes its title and
 * carries the reason as a note, matching the three signals a deprecated member already gets.
 *
 * The reason's whitespace is collapsed before it is escaped, like the member summaries it reads beside: a raw HTML
 * block in markdown ends at a blank line, so a reason carrying a paragraph break would otherwise split this block
 * and strand its closing tags. `escapeSummaryHtml` also turns a web link in the reason into an anchor.
 */
export function renderTypeHeader(options: TypeHeaderOptions): string[] {
  const title = weightedTitle(options.name);
  const deprecated = options.stability === 'deprecated';
  const chips = [kindChip(options.kind), stabilityChip(options.stability)].filter((c) => c !== undefined);
  const reason = options.deprecationReason?.trim();
  return [
    `# ${deprecated ? `<span class="type-title-deprecated">${title}</span>` : title}`,
    '',
    '<div class="type-header">',
    `<div class="type-header-row" ${PAGEFIND_IGNORE}>${chips.join('')}<span class="type-header-gap"></span>`
      + '<span class="type-actions"><span class="type-action-copy"></span><span class="type-action-fav"></span>'
      + '</span></div>',
    ...(deprecated && reason
      ? ['<p class="type-deprecated-note"><span class="type-deprecated-label">Deprecated:</span> '
        + `${escapeSummaryHtml(reason.replace(/\s+/g, ' '))}</p>`]
      : []),
    '</div>',
    '',
  ];
}

function kindChip(kind: TypeKindChip): string {
  const color = kind.kindClass ? ` ${kind.kindClass}` : '';
  return `<span class="type-chip type-chip-kind${color}">${escapeVueText(kind.text)}</span>`;
}

function stabilityChip(stability: TypeHeaderOptions['stability']): string | undefined {
  const chip = stability ? STABILITY_CHIPS[stability] : undefined;
  if (!chip) {
    return undefined;
  }
  const cls = `type-chip type-chip-stability ${chip.chipClass}`;
  return chip.link
    ? `<a class="${cls}" href="${escapeAttr(pageHref(chip.link))}">${chip.label}</a>`
    : `<span class="${cls}">${chip.label}</span>`;
}

/**
 * {@link renderTypeHeader} for a jsii type: the stability is the type's own when set, otherwise its package's, and
 * the deprecation reason comes from the type's own docs. One entry point for all six page renderers, so no page kind
 * can read stability differently from another.
 */
export function renderTypeHeaderFor(type: spec.Type, assembly: spec.Assembly, kind: TypeKindChip): string[] {
  const stability = typeStability(type, assembly);
  return renderTypeHeader({
    name: type.name,
    kind,
    ...(stability ? { stability } : {}),
    ...(type.docs?.deprecated ? { deprecationReason: type.docs.deprecated } : {}),
  });
}
