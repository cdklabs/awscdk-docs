/**
 * The member list a type page's in-page outline shows under its section headings.
 *
 * Members render as `member-row` divs, not headings, so the outline VitePress builds from headings lists only the
 * sections (`Properties`, `Methods`, `Construct Props`). This list is emitted at generate time, read from the page's
 * own rows, so each entry carries exactly the id its row has and no anchor can drift. The theme's
 * outline component nests the entries under the matching section heading
 * (`docs/adr/2026-10-22-outline-members.md`; the construct props group is
 * `docs/adr/2026-10-23-outline-construct-props.md`).
 */
import * as spec from '@jsii/spec';
import { PROPS_ANCHOR_PREFIX, SECTION_ANCHORS } from './anchors.js';
import { tokenizeFences } from './fences.js';

/** One method parameter as the outline shows it: the canonical (TypeScript) name and its optional / variadic marks. */
export interface OutlineParam {
  readonly name: string;
  readonly optional?: true;
  readonly variadic?: true;
}

/**
 * Display data an entry carries beside its anchor and name. `params` is present on every method entry (empty for a
 * method without parameters, so the theme renders `()`), absent on property and prop entries.
 */
export interface OutlineExtras {
  readonly params?: readonly OutlineParam[];
}

/**
 * One outline entry: the row's anchor id, the member's canonical (TypeScript) name, and optional display data. The
 * anchor and the name are the identity; `extras` never takes part in the link target.
 */
export type OutlineMember = readonly [anchor: string, name: string, extras?: OutlineExtras];

/**
 * Display data per row anchor, filled by the member-row emitter from the same jsii data the row's signature is built
 * from and read by {@link outlineMembers}, so the outline cannot disagree with the row and never reads the row HTML.
 */
export type OutlineExtrasByAnchor = Map<string, OutlineExtras>;

/** The outline's view of a method's parameters, from its jsii declaration: names in declared order with their marks. */
export function methodOutlineExtras(method: spec.Method): OutlineExtras {
  return {
    params: (method.parameters ?? []).map((param) => ({
      name: param.name,
      ...(param.optional ? { optional: true as const } : {}),
      ...(param.variadic ? { variadic: true as const } : {}),
    })),
  };
}

/**
 * Section heading anchor to the members listed under it, in page order: `properties`, `methods`, and a construct
 * page's inlined props section (`props-<struct>`).
 */
export type OutlineMembers = Readonly<Record<string, readonly OutlineMember[]>>;

/** Frontmatter key the theme's outline component reads. */
export const OUTLINE_MEMBERS_KEY = 'outlineMembers';

/** The fixed-anchor sections whose rows the outline lists: the type's own properties and its methods. */
const OUTLINE_SECTIONS: ReadonlySet<string> = new Set([SECTION_ANCHORS.properties, SECTION_ANCHORS.methods]);

/**
 * Whether a `##` heading opens a section whose rows the outline lists. Besides the type's own properties and
 * methods, a construct page's inlined props struct (`## Construct Props {#props-<struct>}`, rows
 * `props-<struct>-<member>`) is listed too: the props are the main way a reader configures a construct, and the
 * section anchor is the group key so the theme nests the rows under that heading.
 */
function isOutlineSection(anchor: string): boolean {
  return OUTLINE_SECTIONS.has(anchor) || anchor.startsWith(PROPS_ANCHOR_PREFIX);
}

const SECTION_HEADING = /^## .*\{#([^}\s]+)\}\s*$/;
const MEMBER_ROW = /^<div class="member-row" id="([^"]+)">/;
const PERMALINK_NAME = /class="member-permalink" href="#([^"]+)" aria-label="Permalink to ([^"]+)"/;

function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Collect the member rows of a rendered type page, grouped by the `##` section they sit under: the type's own
 * properties and methods, and the inlined construct props. Fenced code is skipped, so an example that happens to
 * contain a heading or row markup cannot add an entry. A section with no member rows gets no key, so the outline
 * never shows an empty group. An entry whose anchor has display data in `extras` carries it as a third element.
 */
export function outlineMembers(page: string, extras?: ReadonlyMap<string, OutlineExtras>): OutlineMembers {
  const groups: Record<string, OutlineMember[]> = {};
  let section: string | undefined;
  let pendingRow: string | undefined;
  for (const span of tokenizeFences(page)) {
    if (span.kind === 'code') {
      continue;
    }
    for (const line of span.text.split('\n')) {
      const heading = SECTION_HEADING.exec(line);
      if (heading) {
        section = isOutlineSection(heading[1]) ? heading[1] : undefined;
        pendingRow = undefined;
        continue;
      }
      const row = MEMBER_ROW.exec(line);
      if (row) {
        pendingRow = row[1];
        continue;
      }
      if (pendingRow === undefined || section === undefined) {
        continue;
      }
      const link = PERMALINK_NAME.exec(line);
      if (link && link[1] === pendingRow) {
        const extra = extras?.get(pendingRow);
        (groups[section] ??= []).push(
          extra ? [pendingRow, unescapeHtml(link[2]), extra] : [pendingRow, unescapeHtml(link[2])],
        );
        pendingRow = undefined;
      }
    }
  }
  return groups;
}

/**
 * Add the page's member list to its frontmatter, after the keys already there so the declared `title` keeps its
 * place. JSON is valid YAML, so the list is one line the VitePress frontmatter parser reads as a plain object. A page
 * with no member rows is returned untouched.
 */
export function withOutlineMembers(page: string, extras?: ReadonlyMap<string, OutlineExtras>): string {
  const members = outlineMembers(page, extras);
  if (Object.keys(members).length === 0) {
    return page;
  }
  const line = `${OUTLINE_MEMBERS_KEY}: ${JSON.stringify(members)}`;
  const close = page.startsWith('---\n') ? page.indexOf('\n---\n', 3) : -1;
  return close === -1
    ? `---\n${line}\n---\n\n${page}`
    : `${page.slice(0, close)}\n${line}${page.slice(close)}`;
}
