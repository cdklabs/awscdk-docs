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

/** One method parameter: name, optionality, and variadic state. */
interface MethodParam {
  readonly name: string;
  readonly optional?: boolean;
  readonly variadic?: boolean;
}

/** Display extras for an outline entry. Methods carry parameter info. */
interface OutlineMemberExtras {
  readonly params?: readonly MethodParam[];
}

/** Frontmatter `outlineMembers`: section anchor to `[anchor, name, extras?]` tuples, in page order. */
export type OutlineMembers = Readonly<Record<string, readonly (readonly [string, string, OutlineMemberExtras?])[]>>;

/** Render parameter list for an outline title: `a, b?, ...rest` or empty parentheses. */
function paramList(params: readonly MethodParam[] | undefined): string {
  if (!params || params.length === 0) {
    return '()';
  }
  const parts = params.map((p) => {
    if (p.variadic) {
      return `...${p.name}`;
    }
    return p.optional ? `${p.name}?` : p.name;
  });
  return `(${parts.join(', ')})`;
}

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
        ...group.map(([anchor, name, extras]) => {
          const title = extras?.params !== undefined ? `${name}${paramList(extras.params)}` : name;
          return { title, link: `#${anchor}`, level, children: [] };
        }),
      ],
    };
  });
}
