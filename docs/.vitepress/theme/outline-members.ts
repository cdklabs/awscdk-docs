// Members in the "On this page" outline. A type page's member rows are divs, not headings, so the outline VitePress
// builds from headings lists only the sections. Docgen writes the page's member list into its frontmatter
// (`outlineMembers`, see src/docgen/outline-members.ts); this nests those entries under the matching section heading.
// See docs/adr/2026-10-22-outline-members.md.

/** Whether an optional member is an input the caller may omit or an output that may be undefined. */
export type OptionalKind = "input" | "output";

/** The words a screen reader hears in place of the visible `?`, the same ones the member rows use. */
export const OPTIONAL_LABELS: Readonly<Record<OptionalKind, string>> = {
  input: "optional",
  output: "may be undefined",
};

/** One outline entry, the shape VitePress's outline item component renders, plus a member's optional kind. */
export interface OutlineItem {
  title: string;
  link: string;
  level: number;
  children: OutlineItem[];
  optional?: OptionalKind;
}

/** Display extras an entry may carry (docs/adr/2026-10-23-optional-prop-marker.md). */
export interface OutlineMemberExtras {
  readonly optional?: OptionalKind;
}

/** One entry: `[anchor, name]`, or `[anchor, name, extras]` when the row has display data. */
export type OutlineMember = readonly [string, string] | readonly [string, string, OutlineMemberExtras];

/** Frontmatter `outlineMembers`: section anchor to entries, in page order. */
export type OutlineMembers = Readonly<Record<string, readonly OutlineMember[]>>;

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
        ...group.map(([anchor, name, extras]) => ({
          title: name,
          link: `#${anchor}`,
          level,
          children: [],
          // Only a known kind is passed on, so a malformed entry cannot put arbitrary text in the label.
          ...(extras?.optional === "input" || extras?.optional === "output" ? { optional: extras.optional } : {}),
        })),
      ],
    };
  });
}
