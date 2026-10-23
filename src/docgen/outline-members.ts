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
import { PROPS_ANCHOR_PREFIX, SECTION_ANCHORS } from './anchors.js';
import { tokenizeFences } from './fences.js';
import type { OptionalKind } from './layout.js';

/**
 * Display data an outline entry may carry beside its anchor and name. `optional` is the row's optional kind, so the
 * outline marks the same members the rows mark (`docs/adr/2026-10-23-optional-prop-marker.md`).
 */
export interface OutlineMemberExtras {
  readonly optional?: OptionalKind;
}

/**
 * One outline entry: the row's anchor id, the member's canonical (TypeScript) name, and display extras when the row
 * has any. A row with none stays a plain `[anchor, name]` pair.
 */
export type OutlineMember =
  | readonly [anchor: string, name: string]
  | readonly [anchor: string, name: string, extras: OutlineMemberExtras];

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
const MEMBER_ROW = /^<div class="member-row" id="([^"]+)"(?: data-optional="(input|output)")?>/;
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
 * never shows an empty group.
 */
export function outlineMembers(page: string): OutlineMembers {
  const groups: Record<string, OutlineMember[]> = {};
  let section: string | undefined;
  let pendingRow: string | undefined;
  let pendingOptional: OptionalKind | undefined;
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
        pendingOptional = row[2] as OptionalKind | undefined;
        continue;
      }
      if (pendingRow === undefined || section === undefined) {
        continue;
      }
      const link = PERMALINK_NAME.exec(line);
      if (link && link[1] === pendingRow) {
        const name = unescapeHtml(link[2]);
        (groups[section] ??= []).push(pendingOptional ? [pendingRow, name, { optional: pendingOptional }] : [pendingRow, name]);
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
export function withOutlineMembers(page: string): string {
  const members = outlineMembers(page);
  if (Object.keys(members).length === 0) {
    return page;
  }
  const line = `${OUTLINE_MEMBERS_KEY}: ${JSON.stringify(members)}`;
  const close = page.startsWith('---\n') ? page.indexOf('\n---\n', 3) : -1;
  return close === -1
    ? `---\n${line}\n---\n\n${page}`
    : `${page.slice(0, close)}\n${line}${page.slice(close)}`;
}
