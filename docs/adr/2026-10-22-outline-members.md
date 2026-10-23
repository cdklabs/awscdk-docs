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

Later, method entries showed only the method name, so overloads and similar
methods could not be told apart and a reader could not see how many arguments
a method takes. Parameter names were added to method outline entries so each
method reads as `name(a, b?, ...rest)` or `name()` when empty.

## Decision

The outline is fed from data, and nothing else about the page changes:

- **A member list is emitted at generate time.** `src/docgen/outline-members.ts`
  reads the page's own rows after the page is assembled and writes them to the
  type page's frontmatter as `outlineMembers`: a map from section anchor
  (`properties`, `methods`) to `[anchor, name, extras?]` tuples in page order.
  Each anchor is the row's `id`, the existing `memberAnchor` slug, so an entry
  cannot point at a different place than the row's own `#` permalink. The
  optional `extras` object carries display data; methods use it for parameter
  info. The list is a plain value with no presentation in it, so another
  consumer can read it later.
- **Method entries show parameter names.** The `extras.params` field lists each
  parameter as `{ name, optional?, variadic? }`. The theme renders these as
  `name(a, b?, ...rest)`, with `?` for optional parameters and `...` for
  variadic ones, or `name()` when there are no parameters. Parameter names come
  from the jsii spec at generate time, not from parsing the rendered HTML.
  Types are not shown, so the entry stays short.
- **Static methods are unchanged.** Only instance methods carry parameter extras;
  static methods render with name only, matching their exclusion from the
  Methods section listing.
- **Only the type's own properties and its methods are listed.** A construct
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
  is byte-identical apart from the frontmatter line. Parameter text is display
  only and does not appear in anchors, the search index, or the `llms.txt` and
  markdown output.

This is the one place a Vue component is fed structured data. The member rows
themselves stay native HTML emitted at build time, readable with JavaScript off
and greppable; only the outline, which already needs JavaScript in the default
theme, reads the list.

## Consequences

- Each type page carries one extra frontmatter line, its size proportional to
  its member count.
- Method outline entries are longer but more informative, helping readers
  distinguish overloads and see the call shape at a glance.
- The outline component tracks the default theme's `VPDocAsideOutline`; a
  VitePress upgrade that changes that component or the helpers it imports
  (`getHeaders`, `resolveTitle`, `VPDocOutlineItem`) must be re-checked here.
- `test/outline-members.test.ts` pins the list and the nesting,
  `test/docgen.test.ts` pins the list on generated pages, and
  `test/e2e/outline-members.spec.ts` pins the rendered outline, its links and the
  active entry in a browser.
