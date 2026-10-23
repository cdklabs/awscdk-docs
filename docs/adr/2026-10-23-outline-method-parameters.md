# Method Parameters in the Type-Page Outline

## Status

Accepted

Supersedes two parts of [members in the type-page outline](./2026-10-22-outline-members.md):
the `[anchor, name]` entry shape, which gains an optional third element, and the
*Markup and styling are the default theme's own* clause, since the outline item
is now this repository's own component. Everything else in that decision — the
generate-time list, the one aside component, active-entry tracking, no per-member
headings and no search-index change — stands, as does the
[construct props group](./2026-10-23-outline-construct-props.md).

## Context

The outline listed a method by its name alone. On a construct page that hides
the shape of the call: `grantRead` and `grantReadWrite` look alike, `metric`
gives no hint that it takes an options object, and nothing says which arguments
may be left out. The row signature has all of this, but the reader has to leave
the outline to see it.

The entry value was deliberately presentation-free, so the parameter list had to
go somewhere. Two places were weighed. Folding it into `name` would have given
the theme a string to print but nothing to mark up: the `?` and `...` glyphs need
accessible words, which a flat string cannot carry, and any later consumer of
the list would have had to parse the name back out. A separate, optional
display-data element keeps the identity (anchor, name) exactly as it was and
gives the theme structure to render.

The parameter data had to come from the method's jsii declaration, the same one
the row signature is rendered from, so the two cannot disagree. Reading it back
out of the rendered row HTML was rejected: it would couple the outline to the
signature markup and break the moment that markup changed.

## Decision

- **An entry is `[anchor, name, extras?]`.** `extras` is an optional object of
  display data; the anchor and the name are the identity and never change
  because of it. A method entry carries `extras.params`, the method's parameters
  in declared order as `{ name, optional?, variadic? }`, with no types. A method
  without parameters carries an empty list, so the outline renders `()`.
  Property and construct-prop entries carry no third element. Another group's
  display data extends this object rather than adding a fourth element.
- **The data comes from jsii, through the row emitter.** `renderMethodRow` in
  `src/docgen/layout.ts` records each row's anchor and `methodOutlineExtras(method)`
  into an `OutlineExtrasByAnchor` map the page renderers thread from
  `generateDocs` to `withOutlineMembers`. The collector still finds the rows in
  the rendered page and now attaches the extras recorded for that anchor. The
  row HTML is never parsed for parameters.
- **The theme renders names only: `name(a, b?, ...rest)`.** `ApiDocOutlineItem.vue`
  replaces the default theme's `VPDocOutlineItem` inside the aside outline, with
  the same markup and classes, so active-entry tracking and the wrapping rules in
  `outline.css` are untouched. The parameter list sits in a `.outline-params`
  span one shade quieter than the name (`--vp-c-text-3`), lifted with the name on
  hover and when active, so a long list wraps as ordinary text and the name still
  leads the entry. The link's `title` is the same string in full.
- **The marks are spoken as words.** `?` and `...` are `aria-hidden` glyphs,
  each paired with visually hidden text: "optional" after an optional parameter,
  "variadic" before the rest parameter. A screen reader hears
  `metric(metricName, props optional)` and `grant(grantee, variadic actions)`.
  This is the hidden-text pattern the theme already uses for icon-only controls;
  if the optional-prop mark on member rows lands, it should use the same pattern
  so the two surfaces read alike.
- **Display only.** The parameter text lives in the `outlineMembers` frontmatter
  and the aside outline, which sits outside the `data-pagefind-body` article
  Pagefind indexes. It is not in a row id, a permalink, the page body, or the
  agent-facing markdown twin, and every method anchor on the built `Bucket` page
  is the one it had before.

Which rows are listed is unchanged: the methods section lists what it listed
before, and only its entries gain a parameter list.

## Consequences

- Method entries make the `outlineMembers` frontmatter line longer by one small
  object each; `Bucket` has thirty-nine.
- The outline item is now a repository component. A VitePress upgrade that
  changes `VPDocOutlineItem` must be re-checked here as well as in the aside.
- `test/outline-members.test.ts` pins the jsii-to-parameter mapping, the
  three-element entry, the formatted text for required, optional, variadic and
  empty lists, and the nesting; `test/docgen.test.ts` pins `grantRead` on the
  generated `Bucket` page, that the text appears nowhere but the frontmatter,
  and that every `Bucket` method anchor equals its pre-change value;
  `test/e2e/outline-members.spec.ts` pins the rendered entries, the glyphs and
  their spoken words, the accessible names, the link targets and the search-body
  boundary in a browser.
