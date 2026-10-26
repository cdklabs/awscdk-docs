# Members in the Type-Page Outline

## Status

Accepted. Supersedes the outline rule in
[API reference pages — Uniform member rows](./2026-10-15-api-reference-pages.md#uniform-member-rows),
and lifts that record's rejection of "Vue components fed structured data" for
this one component.

## Context

Type-page members render as `member-row` divs, not headings (Uniform member
rows). The "On this page" outline is built from headings, so it listed only the
`Properties` and `Methods` sections: a reader could not see or jump to a member
from the outline, which on a long construct page is the main way to find one.

Two ways back were weighed. Per-member headings would restore the outline for
free but add roughly twelve thousand headings across the site and change what the
search index holds, which the member-row design removed on purpose. Feeding the
outline from data keeps the page markup and the index exactly as they are.

## Decision

The outline is fed from data, and nothing else about the page changes:

- **A member list is emitted at generate time.** `src/docgen/outline-members.ts`
  reads the page's own rows after the page is assembled and writes them to the
  type page's frontmatter as `outlineMembers`: a map from section anchor
  (`properties`, `methods`) to `[anchor, name]` pairs in page order. Each anchor
  is the row's `id`, the existing `memberAnchor` slug, so an entry cannot point
  at a different place than the row's own `#` permalink. The list is a plain
  value with no presentation in it, so another consumer can read it later.
  *Extended — see [optional property marker](./2026-10-23-optional-prop-marker.md):
  an entry may carry a third `extras` element, `[anchor, name, { optional }]`;
  and [method parameters in the outline](./2026-10-26-outline-method-parameters.md):
  a method entry's `extras` carries `params`.*
- **Only the type's own properties and its methods are listed.** *Superseded —
  see [construct props in the outline](./2026-10-23-outline-construct-props.md),
  which lists the inlined props as a third group. The empty-section and
  empty-page rules below stand.* A construct
  page's inlined props struct (`## Construct Props`, rows
  `props-<struct>-<member>`) belongs to another type and is not listed. A section
  with no rows gets no key, so the outline never shows an empty group; a page with
  no rows gets no frontmatter key at all.
- **One theme component reads it.** `ApiDocAsideOutline.vue` replaces the
  default theme's `VPDocAsideOutline` through a `resolve.alias` in `config.mts`,
  VitePress's documented way to override an internal theme component. It builds
  the heading outline exactly as the default theme does and nests each section's
  members under that section's entry, one level deeper
  (`theme/outline-members.ts`). Markup and styling are the default theme's own.
- **Active-entry tracking covers members.** The default tracker follows only the
  headings it collected, so the component runs the same algorithm over every
  outline entry: the active entry is the last one whose target sits above the top
  of the viewport.
- **No per-member headings, and no change to the search index.** The page body
  is byte-identical apart from the frontmatter line.

This is the one place a Vue component is fed structured data. The member rows
themselves stay native HTML emitted at build time, readable with JavaScript off
and greppable; only the outline, which already needs JavaScript in the default
theme, reads the list.

## Consequences

- Each type page carries one extra frontmatter line, its size proportional to
  its member count.
- The outline component tracks the default theme's `VPDocAsideOutline`; a
  VitePress upgrade that changes that component or the helpers it imports
  (`getHeaders`, `resolveTitle`, `VPDocOutlineItem`) must be re-checked here.
- `test/outline-members.test.ts` pins the list and the nesting,
  `test/docgen.test.ts` pins the list on generated pages, and
  `test/e2e/outline-members.spec.ts` pins the rendered outline, its links and the
  active entry in a browser.
