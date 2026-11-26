# Type Page Header: a Chip Row Under the Title

## Status

Accepted

## Context

The top of an API type page looked unlike the CDK Developer Guide it sits
beside. The breadcrumb was a gray mono bar with a fill and a radius, which
reads as a widget rather than as a position in a hierarchy. The title was a
32px heading sharing its line with the kind badge, so the one word a reader
came for — the type name — competed with its classification. Copy Markdown sat
above the breadcrumb, disconnected from everything it acts on, and no rule
separated the header from the summary that followed it.

Three further problems were not matters of taste.

**Deprecated types showed nothing.** A deprecated member already carried three
signals: a struck name, a `deprecated` marker and its reason in place of the
summary. A deprecated *type* carried none of them. A reader could read a whole
page whose entire subject was superseded without being told.

**Stable types carried no signal either.** Stability reached type pages in two
places: a banner on every page of an alpha package, and a `Stability` row in
the metadata block for an experimental type. Both say something only when the
answer is "experimental". So an absent indicator meant both "this type is
stable" and "this page does not mention stability", which a reader cannot tell
apart.

**Several edges were invisible.** Measured against their own surfaces: the kind
badge's border 1.69:1 light and 1.71:1 dark, the Copy Markdown button's edge
1.7:1, and the favorite star's edge 1.32:1 in dark mode. WCAG 1.4.11 asks 3:1
of a control boundary. The badge border came from a per-kind `-border` tint
drawn to sit *inside* a tinted fill, and had never been checked against it.

## Decision

A type page's header is, in order: the breadcrumb, the H1, one row, a divider.

**The kind leaves the H1 and becomes a chip of the row.** The heading is the
name alone. Classification is not part of a name, and its natural neighbors
are the controls that act on the page, not the words of its title. The row is
emitted by docgen at build time (`renderTypeHeader` in `src/docgen/header.ts`),
not assembled by client-side JavaScript, so a client-side navigation between
type pages renders it like any other markup and there is no frame in which the
header is half-built.

The row is a SIBLING after the H1 rather than a wrapper around it. Wrapping
would move the heading out of `.vp-doc > h1`, which the theme's rules, the page
outline and VitePress's inferred page title all select on; the ordering the
header needs is already what the page assembly produces.

**Every type states its stability, "Stable" included.** One chip, from
`typeStability` — the type's own `docs.stability` when set, otherwise its
package's. Experimental links to the stability guide, because the word alone
does not tell a reader what it costs them. `external`, and a type with no
stability at all, get no chip: there is no claim to make, and inventing a
fourth label for a case no page in the corpus exercises would be a guess.

**A deprecated type gets the three signals its members already had.** The title
is struck in the deprecation tone, the chip reads "Deprecated", and the reason
from `docs.deprecated` renders as a left-edged note between the row and the
divider.

**Both chip edges are `currentColor`.** For the kind chip that is its own ink,
whose contrast against its own fill is already pinned at 4.5:1 or better, so
the edge clears the graphics floor by construction rather than by a separate
tuning pass. The per-kind `-border` tints stay in the palette for the
hover-preview chip, which still uses the badge.

**The page actions move into the row as outlined pills.** Copy Markdown and the
favorite star teleport into two fixed mount points, `type-action-copy` then
`type-action-fav`, so the copy button always precedes the star whichever
component mounts first. Both carry a 2px `--vp-c-brand-1` edge, replacing
hairlines that were not visible. An API page with no chip row — a module or
submodule overview — keeps the placements it had: the star in the breadcrumb
bar's `breadcrumb-fav`, Copy Markdown in the `doc-before` slot.

**The breadcrumb becomes plain text with drawn separators.** Body typeface,
14px, no fill and no box. The real `.` joins stay in the DOM wrapped in a
`breadcrumb-dot` span collapsed to `font-size: 0`, and a chevron drawn from two
borders is painted after each non-final segment. `font-size: 0` rather than
`display: none`, because a hidden dot would drop out of a text selection and
the trail has to keep copying as the FQN. Only the joins collapse: a dot inside
one segment's own label, as a nested type carries, is part of the name.

**Three light inks darken.** Struct `#9d174d` to `#831843`, Enum `#9a3412` to
`#7c2d12`, L1 `#854d0e` to `#713f12`. Each had cleared AA but not the 7:1 that
idle text on a page owes; the narrowest light pair is now 7.15:1. L3 and Facade
are left alone: both sit between those floors, and moving a hue that no
reported problem names is a change without an argument.

**The H1 badge alignment override stays.** The `Added in vX.Y.Z` badge lives in
the H1, and stock VitePress alignment lifts it off the baseline the name sits
on. No page in the e2e fixture carries that badge, so a stylesheet assertion
holds it rather than a browser measurement.

The title treatment itself is keyed on the H1 that the header block follows
(`.vp-doc h1:has(+ .type-header)`). `api-layout.css` is imported globally, so
an unscoped rule would restyle module overviews and authored pages too.

## Consequences

- Markup consumers read the kind and the stability from
  `.type-header-row .type-chip`, not from a `<Badge>` in the H1. The Markdown
  twin renders the row as one line, `L2 construct · Stable`, so an agent still
  gets the classification.
- The inferred page title is now strictly the type name: the H1's only raw
  HTML is the weighted-title span, whose inner text is the name. The explicit
  `title` frontmatter that guards against leakage is still emitted, because
  the span itself is what VitePress would strip the tags from.
- Two components teleport into the same row, so both resolve their mount point
  on every content update. A page with no row keeps its old placement, which
  means the overview pages' header is untouched by this change.
- The stability chip is a third place stability appears on an alpha type page,
  alongside the banner and the metadata row. That repetition is accepted: the
  chip is what a scanning reader sees, and the banner is what a reader who
  stops gets.
- A future stability level needs an entry in one table of chips and a token
  pair; nothing in the page assembly changes.
