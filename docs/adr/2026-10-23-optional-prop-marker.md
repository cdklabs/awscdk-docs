# Optional Property Marker

## Status

Accepted

Supersedes the *Optional properties carry no required marker* sentence of
[required property marker as a distinct badge](./2026-10-21-required-prop-badge.md):
optional properties are now marked too. Everything else in that record — the
`required` badge, its styling and when it is emitted — stands.

Extends the outline entry shape of
[members in the type-page outline](./2026-10-22-outline-members.md) from
`[anchor, name]` to `[anchor, name, extras?]`. The rest of that record, and of
[construct props in the outline](./2026-10-23-outline-construct-props.md),
stands.

## Context

Required properties get a `required` badge and optional ones get nothing, so a
reader can only tell a prop is optional by its missing badge. TypeScript and
jsii spell an optional property with a trailing `?`, a mark readers already
know. The issue (cdklabs/awscdk-docs#74) asks for that mark after every optional
property's name, in the rows and in the "On this page" outline. The maintainer
settled the open choices on the issue before it was worked.

## Decision

- **A separate `?` after the name.** An optional property's row emits
  `<span class="member-optional">` right after `<code class="member-name">`, in
  every language variant: optionality is a fact about the member, not about one
  language's spelling. Required properties get no mark. The `required` badge is
  kept.
- **Inputs and outputs.** The mark covers struct props (inputs: the caller may
  leave them out) and class, interface and mixin properties (outputs: the value
  may be undefined). Each property table says which it is
  (`PropsRenderOptions.optionalKind`). Methods and parameters are out of scope.
- **Accessible text by kind.** The visible `?` is `aria-hidden`. A visually
  hidden label beside it reads `optional` for an input and `may be undefined`
  for an output, so a screen reader never announces a bare question mark.
- **Display only.** The mark and its label carry `data-pagefind-ignore` and
  `user-select: none`. They never reach anchors, permalinks, the search index,
  copied text, or the Markdown and `llms.txt` output, which read the name and
  type elements only.
- **The outline reads the same data.** The row carries its kind as
  `data-optional="input|output"`, set from the same jsii `optional` flag that
  drew the mark. The outline collector reads that attribute, never the rendered
  name, and writes it into the entry as `extras`: `[anchor, name, { optional }]`.
  An entry with no extras stays a plain `[anchor, name]` pair. `extras` is the
  place for later display data on outline entries.
- **One outline item component.** VitePress's outline item renders its title as
  plain text, so `ApiDocOutlineItem.vue` replaces it inside the aside outline.
  It is the default item's markup and classes plus the mark, so `outline.css`
  and the active-entry tracking apply unchanged.

## Consequences

- Optional properties are visible at a glance in the rows and the outline, and
  the outline cannot disagree with a row, because both come from one flag.
- A search for `bucketName` still finds the prop, and a copied name needs no
  cleanup.
- `test/api-layout.test.ts` pins the mark on an optional input and output and
  its absence on a required one. `test/outline-members.test.ts` pins the
  `extras` entry. `test/e2e/optional-marker.spec.ts` checks the built `Bucket`
  page: the mark in the rows and the outline, no `?` in anchors or the search
  index, and the spoken labels.
