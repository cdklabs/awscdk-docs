/**
 * The member list a type page's in-page outline shows under its section headings.
 *
 * Members render as `member-row` divs, not headings, so the outline VitePress builds from headings lists only the
 * sections (`Properties`, `Methods`). This list is emitted at generate time, read from the page's
 * own rows, so each entry carries exactly the `memberAnchor` id its row has and no anchor can drift. The theme's
 * outline component nests the entries under the matching section heading
 * (`docs/adr/2026-10-22-outline-members.md`).
 */
import { SECTION_ANCHORS } from './anchors.js';
import { tokenizeFences } from './fences.js';

/** One outline entry: the row's anchor id and the member's canonical (TypeScript) name. */
export type OutlineMember = readonly [anchor: string, name: string];

/** Section heading anchor (`properties` or `methods`) to the members listed under it, in page order. */
export type OutlineMembers = Readonly<Record<string, readonly OutlineMember[]>>;

/** Frontmatter key the theme's outline component reads. */
export const OUTLINE_MEMBERS_KEY = 'outlineMembers';

/**
 * The sections whose rows the outline lists: the type's own properties and its methods. A construct page's inlined
 * props struct (`## Construct Props`, rows `props-<struct>-<member>`) is a different type's members and stays out.
 */
const OUTLINE_SECTIONS: ReadonlySet<string> = new Set([SECTION_ANCHORS.properties, SECTION_ANCHORS.methods]);

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
 * Collect the property and method rows of a rendered type page, grouped by the `##` section they sit under. Fenced code is
 * skipped, so an example that happens to contain a heading or row markup cannot add an entry. A section with no
 * member rows gets no key, so the outline never shows an empty group.
 */
export function outlineMembers(page: string): OutlineMembers {
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
        section = OUTLINE_SECTIONS.has(heading[1]) ? heading[1] : undefined;
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
        (groups[section] ??= []).push([pendingRow, unescapeHtml(link[2])]);
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
