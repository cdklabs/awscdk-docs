// Members in the "On this page" outline. A type page's member rows are divs, not headings, so the outline VitePress
// builds from headings lists only the sections. Docgen writes the page's member list into its frontmatter
// (`outlineMembers`, see src/docgen/outline-members.ts); this nests those entries under the matching section heading.
// See docs/adr/2026-10-22-outline-members.md.

/** One outline entry, the shape VitePress's outline item component renders. */
export interface OutlineItem {
  title: string;
  link: string;
  level: number;
  children: OutlineItem[];
}

/** Frontmatter `outlineMembers`: section anchor to `[anchor, name]` pairs, in page order. */
export type OutlineMembers = Readonly<Record<string, readonly (readonly [string, string])[]>>;

/**
 * The headers with each section's members appended as its children, one level deeper. A group whose section heading
 * is not in the outline is ignored, and a section with no group is unchanged, so no empty group appears. Returns the
 * input itself when the page carries no member list.
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
        ...group.map(([anchor, name]) => ({ title: name, link: `#${anchor}`, level, children: [] })),
      ],
    };
  });
}
