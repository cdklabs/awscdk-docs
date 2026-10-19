import { escapeAttr, escapeVueText } from './escape.js';
import { pageHref } from './links.js';

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

/** The FQN separator plus a soft-wrap opportunity right after it. */
const DOT = '.<wbr>';

/**
 * Breadcrumb-style module hierarchy rendered above the symbol H1:
 * `aws-cdk-lib . aws_s3 . Bucket`, each ancestor linking to its module or submodule page. Labels and links are
 * emitted as escaped HTML, so a label is never read as markdown or Vue syntax and a link is always a page href.
 *
 * Segments join on a real `.` with no surrounding whitespace, so selecting the trail copies the type's FQN
 * verbatim; the visual spacing around each dot comes from segment padding, which selection does not see.
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
  // (links) inside the raw-HTML container.
  return [
    '<nav class="type-breadcrumb" aria-label="Module hierarchy">',
    '',
    `<span class="breadcrumb-trail">${crumbParts(segments).join(DOT)}</span>`,
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
