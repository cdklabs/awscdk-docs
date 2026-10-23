// Members in the "On this page" outline. A type page's member rows are divs, not headings, so the outline VitePress
// builds from headings lists only the sections. Docgen writes the page's member list into its frontmatter
// (`outlineMembers`, see src/docgen/outline-members.ts); this nests those entries under the matching section heading.
// See docs/adr/2026-10-22-outline-members.md and docs/adr/2026-10-23-outline-method-parameters.md.

/** One method parameter as the outline shows it: the canonical name and its optional / variadic marks. */
export interface OutlineParam {
  name: string;
  optional?: true;
  variadic?: true;
}

/** Display data an entry may carry beside its anchor and name. `params` is present on every method entry. */
export interface OutlineExtras {
  params?: readonly OutlineParam[];
}

/**
 * One outline entry, the shape the outline item component renders. `params` is set on a method entry (possibly
 * empty, for `name()`); a heading, property or prop entry has none and renders its title alone.
 */
export interface OutlineItem {
  title: string;
  link: string;
  level: number;
  children: OutlineItem[];
  params?: readonly OutlineParam[];
}

/** Frontmatter `outlineMembers`: section anchor to `[anchor, name, extras?]` entries, in page order. */
export type OutlineMembers = Readonly<Record<string, readonly (readonly [string, string, OutlineExtras?])[]>>;

/**
 * The visible text of one method parameter list, `(a, b?, ...rest)`; `()` when empty. The same string the item
 * component renders, so a `title` attribute and a test can be built from it without duplicating the marks.
 */
export function formatParams(params: readonly OutlineParam[]): string {
  return `(${params.map((param) => `${param.variadic ? "..." : ""}${param.name}${param.optional ? "?" : ""}`).join(", ")})`;
}

/**
 * The headers with each section's members appended as its children, one level deeper. A group whose section heading
 * is not in the outline is ignored, and a section with no group is unchanged, so no empty group appears. Returns the
 * input itself when the page carries no member list. The link is always the row anchor: an entry's display data
 * never takes part in the target.
 */
export function nestOutlineMembers<T extends OutlineItem>(headers: T[], members: OutlineMembers | undefined): T[] {
  if (!members || Object.keys(members).length === 0) {
    return headers;
  }
  return headers.map((header) => {
    const group = members[header.link.replace(/^#/, "")];
    if (!group || group.length === 0) {
      return header;
    }
    const level = header.level + 1;
    return {
      ...header,
      children: [
        ...header.children,
        ...group.map(([anchor, name, extras]) => ({
          title: name,
          link: `#${anchor}`,
          level,
          children: [],
          ...(extras?.params ? { params: extras.params } : {}),
        })),
      ],
    };
  });
}
