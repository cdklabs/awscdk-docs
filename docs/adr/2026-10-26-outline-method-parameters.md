# Method Parameters in the Type-Page Outline

## Status

Accepted

Extends the outline entry shape of
[members in the type-page outline](./2026-10-22-outline-members.md) a second
time: the `extras` element that
[optional property marker](./2026-10-23-optional-prop-marker.md) introduced as
`{ optional }` gains `params`, a method's parameter list. Supersedes the
*Methods and parameters are out of scope* sentence of that record's *Inputs and
outputs* clause for parameters: an optional parameter is now marked in the
outline too. Everything else in both records — the generate-time list, the one
aside component, active-entry tracking, no per-member headings, no search-index
change, the row mark and its labels — stands, as does the
[construct props group](./2026-10-23-outline-construct-props.md).

## Context

The outline listed a method by its name alone. On a construct page that hides
the shape of the call: `grantRead` and `grantReadWrite` look alike, `metric`
gives no hint that it takes an options object, and nothing says which arguments
may be left out. The row signature has all of this, but the reader has to leave
the outline to see it.

The parameter data had to come from the method's jsii declaration, the same one
the row signature is rendered from, so the two cannot disagree. Parsing the
rendered signature back out of the row HTML was rejected: it would couple the
outline to the signature markup and break the moment that markup changed. The
optional marker had already settled how a row hands display data to the
outline — a data attribute on the row, written from the jsii flag and read by
the collector — so the parameter list takes the same path rather than a second
mechanism.

A first version of this change painted the parameter list one shade quieter
than the name (`--vp-c-text-3`). The accessibility gate rejected it: at rest
that token sits near 3:1 against the page in light mode and under 2:1 in dark,
short of the 4.5:1 floor WCAG 1.4.3 sets for 14px text, and an outline entry is
at rest almost all the time. The parameter names are the content the entry
exists to show, so they are painted like the name.

## Decision

- **`extras.params` on every method entry.** A method entry is
  `[anchor, name, { params }]`, with `params` the method's parameters in
  declared order as `{ name, optional?, variadic? }` and no types. A method
  without parameters carries an empty list, so the outline renders `()`.
  Property and construct-prop entries carry no `params`. The anchor and the
  name are the identity and never change because of it.
- **The data rides the row as `data-params`.** `renderMethodRow` in
  `src/docgen/layout.ts` writes the method's parameters onto its row as
  `data-params="a,b?,...rest"` (`encodeOutlineParams`, empty for none), from
  the same declaration the signature is built from. The collector in
  `src/docgen/outline-members.ts` reads the attribute off the row's opening tag
  and decodes it (`decodeOutlineParams`) into the entry's extras, beside
  `data-optional`. Parameter names are identifiers, so the encoding is
  unambiguous and needs no quoting. The rendered signature is never parsed.
- **The theme renders names only: `name(a, b?, ...rest)`.** `ApiDocOutlineItem.vue`,
  already this repository's own outline item, renders the list in a
  `.outline-params` span after the name, in the link's own colour, so it meets
  the same contrast the name does at rest, on hover and when active. A `<wbr>`
  before the opening parenthesis gives a long entry a break point there, so the
  column's `overflow-wrap: anywhere` does not split a word first. The link's
  `title` is the same string in full.
- **The marks are spoken as words.** `?` and `...` are `aria-hidden` glyphs,
  each paired with visually hidden text: "optional" after an optional parameter,
  "variadic" before the rest parameter. A screen reader hears
  `metric(metricName, props optional)` and `grant(grantee, variadic actions)`.
  This is the pattern the optional property marker uses, so the two surfaces
  read alike.
- **Display only.** The parameter text lives in the `outlineMembers` frontmatter
  and the aside outline, which sits outside the `data-pagefind-body` article
  Pagefind indexes. It is not in a row id, a permalink, the page body, or the
  agent-facing markdown twin, and every method anchor on the built `Bucket` page
  is the one it had before.

Which rows are listed is unchanged: the methods section lists what it listed
before, and only its entries gain a parameter list.

## Consequences

- Method rows carry one `data-params` attribute each, and method entries make
  the `outlineMembers` frontmatter line longer by one small object each;
  `Bucket` has thirty-nine.
- A third kind of display data extends the `extras` object, never a fourth
  tuple element.
- `test/outline-members.test.ts` pins the encoding and decoding, the
  three-element entry, the formatted text for required, optional, variadic and
  empty lists, and the nesting; `test/docgen.test.ts` pins `grantRead` on the
  generated `Bucket` page, that the text appears nowhere but the frontmatter and
  the row attribute, and that every `Bucket` method anchor equals its pre-change
  value; `test/e2e/outline-members.spec.ts` pins the rendered entries, the
  glyphs and their spoken words, the accessible names, the link targets, the
  search-body boundary and the parameter list's contrast in both themes in a
  browser.
