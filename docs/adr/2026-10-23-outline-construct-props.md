# Construct Props in the Type-Page Outline

## Status

Accepted

Supersedes the *Only the type's own properties and its methods are listed*
bullet of [members in the type-page outline](./2026-10-22-outline-members.md).
Everything else in that decision — the generate-time list, the `[anchor, name]`
shape, the one theme component, active-entry tracking, no per-member headings
and no search-index change — stands.

## Context

A construct page inlines its props struct as a `## Construct Props
{#props-<struct>}` section, rows `props-<struct>-<member>`, because the props
are how a reader configures the construct and sending them to the struct's own
page lost that context (API reference pages). The member outline listed the
type's own properties and methods but left those rows out, on the grounds that
they belong to another type.

In use the opposite holds: on a construct page the props section is the one a
reader most often scans, and it is the longest. `Bucket` has fourteen
properties, nine methods and thirty-eight props. An outline that lists `bucketArn`
but not `bucketName`, the prop a reader is looking for, points at the smaller
part of the page and leaves the larger one a single collapsed entry.

The old collector keyed the listed sections on their fixed anchors
(`properties`, `methods`). The props section's anchor is derived from the struct
name, so it could not be matched by a fixed set.

## Decision

- **The inlined construct props are listed as a third group.** The collector
  in `src/docgen/outline-members.ts` recognizes a `##` section whose anchor
  starts with the props prefix and lists its rows under that anchor, so the map
  gains a `props-<struct>` key beside `properties` and `methods`. The theme
  component already nests any group under the heading that carries its anchor,
  so the props appear one level under the `Construct Props` entry with no theme
  change, and follow the same active-entry tracking.
- **The prefix is shared, not repeated.** `PROPS_ANCHOR_PREFIX` in
  `src/docgen/anchors.ts` is the one constant both the emitter (`propsAnchor` in
  `constructs.ts`) and the collector use, so the section id and the rule that
  recognizes it cannot drift apart.
- **Row ids are unchanged.** Entries point at the existing
  `props-<struct>-<member>` row ids, which are already namespaced under the
  section slug, so a prop and an own property with the same name get distinct
  entries and distinct targets.
- **The empty-group and no-props rules stand.** A props section with no rows
  gets no key, and a page without a `Construct Props` section is byte-identical
  to before.

Per-member headings were not reconsidered: the reasons the original record
rejected them (twelve thousand headings, a changed search index) apply to the
props rows as well.

## Consequences

- Construct pages carry a longer `outlineMembers` frontmatter line, by one entry
  per prop: thirty-eight short pairs on `Bucket`. Other pages are unchanged.
- The outline on a construct page is taller, since the props group is usually
  its largest. The outline already scrolls independently of the content.
- `test/outline-members.test.ts` pins the props group and its keys,
  `test/docgen.test.ts` pins it on the generated `Bucket` page (`bucketName`
  under `props-bucketprops`), and `test/e2e/outline-members.spec.ts` pins the
  rendered entry, its link target and the active state in a browser.
