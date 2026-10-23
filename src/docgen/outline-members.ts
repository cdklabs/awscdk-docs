/**
 * The member list a type page's in-page outline shows under its section headings.
 *
 * Members render as `member-row` divs, not headings, so the outline VitePress builds from headings lists only the
 * sections (`Properties`, `Methods`). This list is emitted at generate time, read from the page's
 * own rows, so each entry carries exactly the `memberAnchor` id its row has and no anchor can drift. The theme's
 * outline component nests the entries under the matching section heading
 * (`docs/adr/2026-10-22-outline-members.md`).
 */
import * as spec from '@jsii/spec';
import { SECTION_ANCHORS } from './anchors.js';
import type { TypeIndex } from './constructs.js';
import { tokenizeFences } from './fences.js';

/** One method parameter: name, optionality, and variadic state. */
export interface MethodParam {
  readonly name: string;
  readonly optional?: boolean;
  readonly variadic?: boolean;
}

/** Display extras for an outline entry. Methods carry parameter info. */
export interface OutlineMemberExtras {
  readonly params?: readonly MethodParam[];
}

/** One outline entry: the row's anchor id, the member's canonical name, and optional display extras. */
export type OutlineMember = readonly [anchor: string, name: string, extras?: OutlineMemberExtras];

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
 * Extract method parameter info from a jsii type, including inherited methods. Returns a map from method name to parameter list.
 * Only class and interface types with methods are processed.
 */
function methodParams(type: spec.Type, index: TypeIndex): ReadonlyMap<string, readonly MethodParam[]> {
  const map = new Map<string, readonly MethodParam[]>();

  // For class types, walk up the inheritance chain
  if (spec.isClassType(type)) {
    let current: string | undefined = type.fqn;
    while (current) {
      const entry = index.get(current);
      if (!entry || !spec.isClassType(entry.type)) {
        break;
      }
      for (const method of entry.type.methods ?? []) {
        // Skip static methods and already-seen methods (child class overrides)
        if (method.static || map.has(method.name)) {
          continue;
        }
        const params = (method.parameters ?? []).map((p) => ({
          name: p.name,
          optional: p.optional,
          variadic: p.variadic,
        }));
        map.set(method.name, params);
      }
      current = entry.type.base;
    }
    return map;
  }

  // For interface types, just use direct methods (interfaces don't inherit in the same way)
  if (spec.isInterfaceType(type) && type.methods) {
    for (const method of type.methods) {
      if (method.static) {
        continue;
      }
      const params = (method.parameters ?? []).map((p) => ({
        name: p.name,
        optional: p.optional,
        variadic: p.variadic,
      }));
      map.set(method.name, params);
    }
  }

  return map;
}

/**
 * Add parameter extras to method outline entries. The base outline comes from parsing the page HTML,
 * and the jsii type provides parameter data for methods. Properties and static methods are unchanged.
 */
function withMethodParams(members: OutlineMembers, type: spec.Type | undefined, index: TypeIndex): OutlineMembers {
  if (!type) {
    return members;
  }
  const params = methodParams(type, index);
  if (params.size === 0) {
    return members;
  }
  const methodList = members.methods;
  if (!methodList || methodList.length === 0) {
    return members;
  }
  const updated = methodList.map(([anchor, name]) => {
    const methodParameters = params.get(name);
    if (!methodParameters) {
      return [anchor, name] as OutlineMember;
    }
    return [anchor, name, { params: methodParameters }] as OutlineMember;
  });
  return { ...members, methods: updated };
}

/**
 * Add the page's member list to its frontmatter, after the keys already there so the declared `title` keeps its
 * place. JSON is valid YAML, so the list is one line the VitePress frontmatter parser reads as a plain object. A page
 * with no member rows is returned untouched.
 */
export function withOutlineMembers(page: string, type: spec.Type | undefined, index: TypeIndex): string {
  const members = withMethodParams(outlineMembers(page), type, index);
  if (Object.keys(members).length === 0) {
    return page;
  }
  const line = `${OUTLINE_MEMBERS_KEY}: ${JSON.stringify(members)}`;
  const close = page.startsWith('---\n') ? page.indexOf('\n---\n', 3) : -1;
  return close === -1
    ? `---\n${line}\n---\n\n${page}`
    : `${page.slice(0, close)}\n${line}${page.slice(close)}`;
}
