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

A type page's header is, in order: the breadcrumb, the experimental banner on an
alpha package's pages, the H1, one row, a divider.

**The kind leaves the H1 and becomes a chip of the row.** The heading is the
name alone. Classification is not part of a name, and its natural neighbors
are the controls that act on the page, not the words of its title. The row is
emitted by docgen at build time (`renderTypeHeader` in `src/docgen/header.ts`),
not assembled by client-side JavaScript, so a client-side navigation between
type pages renders it like any other markup. The action pills do arrive after
mount, into space the server-rendered row already reserves.

The row is a SIBLING after the H1 rather than a wrapper around it. Wrapping
would move the heading out of `.vp-doc > h1`, which the theme's rules, the page
outline and VitePress's inferred page title all select on; the ordering the
header needs is already what the page assembly produces.

**Every type with a jsii stability states it, "Stable" included.** One chip,
from `typeStability` — the type's own `docs.stability` when set, otherwise its
package's. Experimental links to the stability guide, because the word alone
does not tell a reader what it costs them. Only a type with no stability at all
gets no chip; that page carries the kind chip alone and its Markdown twin's
classification line names the kind only.

Generated L1 types are the corpus case: jsii gives a CloudFormation resource
`external` stability, and every `Cfn*` page chips **External**. The label is
jsii's own word rather than a reading of it. The AWS guides do not agree on
what `external` promises — the v2 migration guide calls L1 constructs always
stable, the versioning page says generated L1 code may contain backward
incompatible changes — so the chip repeats the metadata and leaves that reading
to the reader, instead of leaving an L1 page as the one place a missing chip
still means two things. The chip is gray in both schemes, not a signal color,
and links nowhere: `external` is not a level the stability guide ranks.

**A deprecated type gets the three signals its members already had.** The title
is struck in the deprecation tone, the chip reads "Deprecated", and the reason
from `docs.deprecated` renders as a left-edged note between the row and the
divider.

**Both chip edges are `currentColor`.** The edge is then the ink, so whatever
clears a chip's label against its fill clears its edge against that fill too,
and the edge needs no tuning pass of its own. Every chip's ink/fill pair is
pinned by hex: the eight per-kind pairs in the palette, the four stability
pairs, and the neutral pair a plain class or a level-less construct takes. The
stability pairs take the conventional tones for what they say, amber for
experimental, green for stable, red for deprecated, and a neutral gray for
external, which signals no level, drawn from the same palette the kind hues
come from. Amber is L1's pair in both schemes, and green shares
L3's fill in both, with L3's ink as well in dark mode, so an L1 or an L3 page
can show two chips in one tone; the label and the fixed order tell them apart,
and picking a second amber for the sake of difference would cost the convention
and gain nothing a reader uses. The neutral pair is why the neutral chip has
an opaque `--th-chip-neutral-bg` rather than the translucent
`--vp-c-default-soft` it could have inherited: a translucent fill has to be
composited against the page before its contrast can be read, and a pair a test
cannot read is a pair nothing holds. The per-kind `-border` tints leave the
palette with this change: their only readers were the H1 badge rules, and the
H1 no longer carries a kind badge.

**The page actions move into the row as outlined pills.** Copy Markdown and the
favorite star teleport into two fixed mount points, `type-action-copy` then
`type-action-fav`, so the copy button always precedes the star whichever
component mounts first. Both carry a 2px `--vp-c-brand-1` edge, replacing
hairlines that were not visible. Below 960px the pills keep their 32px height
rather than growing to the 44px touch floor: three 44px controls with a 2px
edge and a bold label outweighed the title above them. The edge thins to 1.5px
and the label to 600, and each pill reaches 44px tall through a transparent
overlay outside its painted box, the way the linking stability chip does. The
overlay adds height only: Copy Markdown keeps its own width floor, and ▾ and the
star stay 32px wide, above the 24px minimum target size but below a 44×44 box,
with the 8px row gap keeping the areas apart. An API page with no chip row — a
module or submodule overview — keeps the placements it had: the star in the
breadcrumb bar's `breadcrumb-fav`, Copy Markdown in the `doc-before` slot, both
at the 44px box on phones.

**The breadcrumb becomes plain text with drawn separators.** Body typeface,
14px, no fill and no box. The real `.` joins stay in the DOM wrapped in a
`breadcrumb-dot` span collapsed to `font-size: 0`, and a chevron drawn from two
borders is painted after each non-final segment. `font-size: 0` rather than
`display: none`, because a hidden dot would drop out of a text selection and
the trail has to keep copying as the FQN. Only the joins collapse: a dot inside
one segment's own label, as a nested type carries, is part of the name.

**Three light inks darken.** Struct `#9d174d` to `#831843`, Enum `#9a3412` to
`#7c2d12`, L1 `#854d0e` to `#713f12`. Each had cleared AA but not the 7:1 that
text on a page owes; all three now clear it, L1 the narrowest of them at
7.79:1. That leaves L3 (6.49:1) and Facade (6.73:1) as the only light pairs
clearing AA but not 7:1, and they are left alone deliberately: moving a hue
that no reported problem names is a change without an argument behind it.

**The H1 badge alignment override stays.** The `Added in vX.Y.Z` badge lives in
the H1, and stock VitePress alignment lifts it off the baseline the name sits
on. No page in the e2e fixture carries that badge, so the browser test appends
one to a live H1 and compares the shipped alignment with the stock one; a
stylesheet assertion pins the declarations themselves.

The title treatment itself is keyed on the H1 that the header block follows
(`.vp-doc h1:has(+ .type-header)`). `api-layout.css` is imported globally, so
an unscoped rule would restyle module overviews and authored pages too.

## Consequences

- Markup consumers read the kind and the stability from
  `.type-header-row .type-chip`, not from a `<Badge>` in the H1. The Markdown
  twin renders the row as one line, `L2 construct · Stable`, so an agent still
  gets the classification.
- The header block costs about 460 bytes of HTML per type page, and the page's
  lean hydration chunk gives most of it back. Measured base `a0f033c` against
  `d90fa57` on the baseline fixture
  (`E2E_FIXTURE_SERVICES=aws-sns,aws-sqs E2E_FIXTURE_MODULES=constructs`, 77
  pages and 78 built HTML pages both times): `docs:generate`, then
  `scripts/e2e-fixture-prune.cjs`, then `vitepress build docs`, then
  `scripts/package-site.sh`. On `aws_sqs.Queue`, HTML goes 184,464 to 184,928 B
  (+464) and the full page chunk 183,815 to 184,095 B (+280), while the lean
  chunk goes 182,256 to 181,854 B (-402), because a page without an `Added in`
  badge no longer uses the `<Badge>` component. All three scale with the page
  count. One-time: the shared chunks +610 B and the stylesheet 178,419 to
  181,970 B (+3,551). On the fixture that nets raw `dist` 45,265,959 to
  45,282,069 B (+0.04%) and the deploy zip 4,645,588 to 4,638,740 B (-0.15%).
  The corpus carries 29,154 type pages: `docs:generate` writes 29,892 pages
  under `docs/v2/docs`, of which 738 are `-readme.md` module overviews, which
  have no chip row. Extrapolating the per-page figures alone over those 29,154
  gives about +12.9 MiB of HTML, +7.8 MiB of full chunks and -11.2 MiB of lean
  chunks, that last figure an upper bound: no fixture page carries an `Added in`
  badge, and a page that does still loads `<Badge>`. The
  zip is deliberately not extrapolated, because a
  repeated block's compression ratio does not scale linearly, so the fixture
  figure is the measurement and the deployed zip is what `package-site.sh`
  reports on each release.
- The H1 source stays markup: the weighted-title span, wrapped in
  `type-title-deprecated` for a deprecated type, plus any `Added in` badge
  `injectBadges` appends. So the explicit `title` frontmatter is still what
  holds the inferred page title to the bare type name.
- Two components teleport into the same row, so both resolve their mount point
  on every content update, and both read a `typeHeader` frontmatter flag to
  know at server-render time whether a row is coming. The empty actions box
  reserves the pills' height, so the row's height is final from the first
  paint.
- Module and submodule overviews render the same breadcrumb, so they take its
  restyle: the collapsed join dots and the CSS chevrons. What they keep is
  their action placements, Copy Markdown in `doc-before` and the star in
  `breadcrumb-fav`, because they have no chip row to teleport into.
- The stability chip is a third place stability appears on an alpha type page,
  alongside the banner and the metadata row. That repetition is accepted: the
  chip is what a scanning reader sees, and the banner is what a reader who
  stops gets.
- A future stability level needs an entry in one table of chips and a token
  pair; nothing in the page assembly changes.
