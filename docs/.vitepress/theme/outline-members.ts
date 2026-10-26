// Members in the "On this page" outline. A type page's member rows are divs, not headings, so the outline VitePress
// builds from headings lists only the sections. Docgen writes the page's member list into its frontmatter
// (`outlineMembers`, see src/docgen/outline-members.ts); this nests those entries under the matching section heading.
// See docs/adr/2026-10-22-outline-members.md, docs/adr/2026-10-23-optional-prop-marker.md and
// docs/adr/2026-10-26-outline-method-parameters.md.

/** Whether an optional member is an input the caller may omit or an output that may be undefined. */
export type OptionalKind = "input" | "output";

/** The words a screen reader hears in place of the visible `?`, the same ones the member rows use. */
export const OPTIONAL_LABELS: Readonly<Record<OptionalKind, string>> = {
  input: "optional",
  output: "may be undefined",
};

/** One method parameter as the outline shows it: the canonical name and its optional / variadic marks. */
export interface OutlineParam {
  readonly name: string;
  readonly optional?: true;
  readonly variadic?: true;
}

/**
 * One outline entry, the shape VitePress's outline item component renders, plus a member's display data: the
 * optional kind of a prop, or a method's parameter list (possibly empty, for `name()`). A heading entry has neither.
 */
export interface OutlineItem {
  title: string;
  link: string;
  level: number;
  children: OutlineItem[];
  optional?: OptionalKind;
  params?: readonly OutlineParam[];
}

/** Display extras an entry may carry (docs/adr/2026-10-23-optional-prop-marker.md, 2026-10-26-outline-method-parameters.md). */
export interface OutlineMemberExtras {
  readonly optional?: OptionalKind;
  readonly params?: readonly OutlineParam[];
}

/** One entry: `[anchor, name]`, or `[anchor, name, extras]` when the row has display data. */
export type OutlineMember = readonly [string, string] | readonly [string, string, OutlineMemberExtras];

/** Frontmatter `outlineMembers`: section anchor to entries, in page order. */
export type OutlineMembers = Readonly<Record<string, readonly OutlineMember[]>>;

/**
 * The visible text of one method parameter list, `(a, b?, ...rest)`; `()` when empty. The same string the item
 * component renders, so a `title` attribute and a test can be built from it without duplicating the marks.
 */
export function formatParams(params: readonly OutlineParam[]): string {
  return `(${params.map((param) => `${param.variadic ? "..." : ""}${param.name}${param.optional ? "?" : ""}`).join(", ")})`;
}

/** Only well-formed parameters are passed on, so a malformed entry cannot put arbitrary markup in the label. */
function knownParams(params: unknown): OutlineParam[] | undefined {
  if (!Array.isArray(params)) {
    return undefined;
  }
  const known: OutlineParam[] = [];
  for (const param of params) {
    if (typeof param?.name !== "string") {
      return undefined;
    }
    known.push({
      name: param.name,
      ...(param.optional === true ? { optional: true as const } : {}),
      ...(param.variadic === true ? { variadic: true as const } : {}),
    });
  }
  return known;
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
        ...group.map(([anchor, name, extras]) => {
          const params = knownParams(extras?.params);
          return {
            title: name,
            link: `#${anchor}`,
            level,
            children: [],
            // Only a known kind is passed on, so a malformed entry cannot put arbitrary text in the label.
            ...(extras?.optional === "input" || extras?.optional === "output" ? { optional: extras.optional } : {}),
            ...(params ? { params } : {}),
          };
        }),
      ],
    };
  });
}
