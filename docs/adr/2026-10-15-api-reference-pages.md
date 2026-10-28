# API Reference Pages

## Status

Accepted

## Context

The generated API reference needs a dedicated, deep-linkable page for every
jsii type — not just per-submodule type tables — so readers can bookmark
`BucketProps` or `BucketEncryption`, cross-references resolve to real pages,
and Pagefind indexes per-type content. Each page must present a type's
identity, provenance, relationships, and members densely and scannably, work
in light and dark mode, degrade without JavaScript, and stay byte-stable
across builds. All required data is present in the jsii assemblies
(`locationInModule`, base-class chains, `implements` clauses, `datatype`
flags, `cloudformationResource` metadata, `docs.*`); see
[docgen sources](./2026-10-15-docgen-sources-and-modules.md).

## Decision

### One page per type, dispatched by classification

Every jsii type gets a markdown page under
`docs/api/modules/<pkg>/<submodule>/<Name>` (`core` for module-root types),
reachable from the submodule type tables and indexed by Pagefind. A single
dispatch in `src/docgen/index.ts` assembles frontmatter, breadcrumb, body,
and search filters per page, then routes by kind:

- **Constructs** and **mixins** use their own renderers (below).
- **Classes** (`renderClassPage`) show the hierarchy block, initializer,
  and methods/properties collected along the base-class chain.
- **Structs** (interfaces with the `datatype` flag) show a property table
  plus a `used as props by` hierarchy row from a reverse usage index over
  class initializer parameters.
- **Behavioral interfaces** that are not mixins show methods and properties.
- **Enums** show a members table and a "Referenced by" list of properties
  typed by the enum.

Type references in property tables render as markdown links when the target
has a documented page (`linkFor` over a global FQN → link map), falling back
to plain code spans. Page count reaches the full type count of documented
assemblies (~23k pages for the shipped corpus); generation is one memoized
pass per type and VitePress build time is the practical scaling limit.

### Construct detection and L1/L2/L3 classification

A class is a construct when its base-class chain reaches
`constructs.Construct`; the type index spans all configured assemblies
because the chain crosses assembly boundaries. `constructLevel()` classifies
the level in order, first match wins:

0. **Explicit FQN override** — carries `Stage`, `App`, `Stack`,
   `NestedStack`, and `Resource` as **L2** (curated abstractions no
   inheritance test can reach, since `Resource` is the base). Matched by
   exact FQN, never inherited, so `aws_servicecatalog.ProductStack` is not
   promoted with `Stack`.
1. **L1** — has `cloudformationResource` metadata (generated `CfnXxx`).
2. **L3** — declared in a `*patterns*` submodule.
3. **L2** — extends `aws-cdk-lib.Resource`.
4. **L1** — is or extends `aws-cdk-lib.CfnElement` (catches hand-written
   `CfnOutput`, `CfnParameter`, etc. lacking CFN metadata). Last so an
   override or genuine `Resource` descendant has already matched.

Constructs matching none (e.g. `constructs.Construct` itself, `CfnJson`) get
no badge rather than a wrong one. The level is also a sort key: `byLevelThenName`
(`src/docgen/ordering.ts`) ranks L3 > L2 > L1 > unleveled in sidebar leaf
lists and type tables, so the overrides and the `CfnElement` subtree reorder
listings too. Source links pin the assembly version tag and are omitted for
`*.generated.ts` files (build-only, would 404). Props tables inline inherited
properties — users care about the full passable set, not the declaration
hierarchy.

### Mixin pages

Mixins are behavioral interfaces identified by the `IMixin` marker interface;
see [docgen sources](./2026-10-15-docgen-sources-and-modules.md). Implementor
discovery walks each class's base chain and takes the transitive closure of
every `implements` clause, so `Bucket` counts as an implementor of `IResource`
even when the clause lives on an ancestor. `renderMixinPage` emits name with a
`Mixin` badge, summary, methods, properties, and the implementing classes as
the hierarchy block's `implemented by` row. The heuristic is intentionally
inclusive: any implemented behavioral interface gets a useful page. Marker
interfaces get no mixin page but still appear in type tables as `Interface`.

### Header: breadcrumb, merged description, hierarchy block

A type page opens with a navigable breadcrumb above the H1, then an H1 of the
type name plus its kind badge, then one prose description, then one hierarchy
row — no metadata table, no `## Overview` heading, no package+version badge.

`renderDescription()` (`src/docgen/layout.ts`) folds doc summary and remarks
into one continuous prose block, which is Pagefind-indexed (remarks read as
the page lead, where readers look). The H1 carries only the type name and the
kind badge.

### Breadcrumb that copies as an FQN

The breadcrumb (`<nav class="type-breadcrumb">`, built in `index.ts`,
rendered by `renderBreadcrumb` in `header.ts`) replaces the old Module/FQN
rows with navigable segments: `aws-cdk-lib . aws_s3 . Bucket`. Ancestor
segments link to their module/submodule page (as markdown links, so VitePress
applies site `base` and `.html` resolution); the current segment is unlinked.

Segments join on a real `.` with **no surrounding whitespace**; visual spacing
is `padding-inline` on each segment. Padding is not part of a text selection,
so the trail reads as a spaced hierarchy yet copies as the exact FQN
(`aws-cdk-lib.aws_s3.Bucket`) with no JavaScript or `copy`-event handling.
This holds because the dot-joined trail *is* the FQN byte-for-byte, including
nested types (`CfnTopic.SubscriptionProperty` arrives as one segment). Every
segment — including unlinked structural segments — is wrapped in an element so
padding reaches it. The copyable region is its own `breadcrumb-trail` element,
distinct from the paragraph holding the teleported favorite star.

Each dot is followed by `<wbr>` so a wide trail wraps after a dot rather than
inside `aws-cdk-lib`; `overflow-wrap: anywhere` on the trail is the fallback
for a single identifier wider than the line (longest is 63 chars). `nowrap`
and `break-word` were both rejected on measurement: as a flex item the trail's
min-content width is the unbroken string, so `break-word` widened the bar
instead of wrapping.

Trails longer than `BREADCRUMB_MAX_SEGMENTS` (4) collapse: the first two
segments and the last two stay visible, the middle collapses to a single `…`.
Collapsed labels stay in the DOM as text (shrunk with `font-size: 0`, ellipsis
painted by a pseudo-element) so they remain selectable, the copy stays the
whole FQN, and `title` lists the hidden labels. Fixed ends were chosen over
width-responsive truncation because the bar is static markdown with no client
measurement step. The breadcrumb is generated per language prefix, so it stays
correct under the multi-language URL scheme
([multi-language](./2026-10-15-multi-language.md)).

The favorite star is an icon-only button that `<Teleport>`s into a
`breadcrumb-fav` mount the breadcrumb bar emits, sharing the breadcrumb's row.
The target is re-resolved on `onContentUpdated`; where no mount exists (module
overview pages) the Teleport is disabled and the star keeps its standalone
`doc-before` placement.

### One type-hierarchy block: every relation as a row

All five relationships — `implements`, `extends`, `implemented by`,
`superclass of`, and a struct's `used as props by` — render as rows of one
hierarchy block under the breadcrumb, emitted by a single `relationRow`
renderer. There is no separate `## Subclasses`, `## Implemented by` or
`## Used as props by` section and no inline-vs-section split by direction.
`used as props by` lists the classes whose initializer takes the struct (from
the reverse usage index); its row keeps the `used-as-props-by` id, so deep
links to the former section still land on it. `implements` lists the **full transitive closure** of
interfaces reachable through class ancestors *and* interface `extends`
(the Javadoc "All Implemented Interfaces" rule), via a memoized cycle-guarded
resolver in `src/docgen/interfaces.ts` cached per `TypeIndex`. `superclass of`
(descendants, from `buildSubclassIndex`) and `implemented by` (implementors,
from `buildImplementorsIndex`) are transitive, merged, and share the one
corpus traversal that mixin classification already performs.

Each row is clamped to two lines by a **build-time character budget**
(`RELATION_ROW_BUDGET = 70`, tuned by measurement — a derived 150 ran to 3–4.75
line-heights), not a CSS line clamp, because unclamping a CSS clamp needs the
hidden names inside `<summary>`, which is the `nested-interactive` a11y
violation. Truncation is **lossless**: a sibling `<details>` reveals every
hidden name and its summary states what is *hidden* (`2,507 more`), reading as
the row's continuation. The disclosure is plain HTML, so pages work before
hydration and nothing is dropped even on `constructs.Construct` (2,332
descendants) or `IConstruct`.

The clamp's `<details class="chain-more">` starts closed at the Compact and
Balanced layout levels and opens at Spacious, where a reader has asked to see
everything at once; they can still close it. The generated HTML and the budget
are unchanged; the level sets the `open` attribute at runtime (ADR
2026-10-23-layout-density, "Spacious opens every fold-out").

A row's names are one `<ul>` with `role="list"`/`"listitem"` **re-asserted
explicitly** — WebKit strips native list semantics from inline-styled lists,
and the row must flow as text (`display: inline; list-style: none`) for the
clamp. The disclosure is the list's final item with the hidden remainder as a
nested `<ul>` inside it, never inside `<summary>`. Separators live inside each
item (`', '` between names, bare `','` before the disclosure). Order is
FQN-sorted for byte-stable output. All relations ship in the HTML (hidden by
`<details>`); the block carries `data-pagefind-ignore` so type names repeating
on every page do not pollute search ([search](./2026-10-15-search-and-filter.md)).

Interface-to-interface "Extended by" is deliberately out of scope — a separate
reverse index; an interface's own `extends` already renders in its row.

### Provenance metadata block

A definition list (`renderTypeMetadata`, rows from the shared
`typeMetadataRows(type, assembly, index, linkFor)`) renders under the
hierarchy block on every type page, carrying at most three rows:

| row | source | link |
|---|---|---|
| CloudFormation | the L1's own resource type, or the L1 an L2 is backed by | AWS resource reference, `target="_blank"` |
| L1 type | the backing L1, on non-L1 pages only | that L1's page, via `pageHref` |
| Source | upstream file and line | repository, or the text *Generated code* |

Provenance is neither prose nor title material, so it lives here rather than in
the H1 or the description. The block emits nothing when there are no rows (no
empty shell). It is a two-column grid (`max-content 1fr`) with **no**
`nth-child`/`:first-child`/`:last-child` styling — a fourth row is a row, not a
CSS change (a test asserts the absence). `isGeneratedSource()` is a predicate
with no markup; the source chip no longer lives in the H1.

Indexing is **selective**: the CloudFormation and L1-type values are indexed
(each names exactly one page, so searching `AWS::S3::Bucket` finds `Bucket`);
the Source value carries `data-pagefind-ignore` because its file-path text
would compete with real prose. The link affordance on in-block links is brand-2
with an at-rest underline (brand-1 on `--vp-c-bg-soft` measures only 4.22:1).

### Uniform member rows

Properties and methods render the **same** `member-*` row: a header line
(name plus full inline signature), a summary line, then short prose inline or
long prose behind a labeled disclosure. There are no per-member headings; the
`## Methods` and `## Properties` section headings remain, keep their outline
entries (members are listed under them from data, not headings — superseded in
part by [members in the outline](./2026-10-22-outline-members.md)), and
per-member deep links move to the `#` permalink whose slug
(`memberAnchor`) is byte-identical to the old heading pin so every `#member`
link still resolves. Where a construct page inlines a props struct **and**
lists the type's own properties, the inlined table namespaces its rows under
that section's slug (`props-<struct>-<member>`) to avoid duplicate ids; the
type's own members and all methods keep the bare slug.

The disclosure is a native `<details>` with an empty `<summary>` named by
`aria-label` and a `+`/`−` glyph positioned by CSS absolute positioning
(never nesting one control inside another — the `nested-interactive`
constraint). The type link and one-line summary stay visible while collapsed;
the summary is clamped with an ellipsis.

The inline-vs-disclosure threshold is a **character budget**
(`INLINE_PROSE_BUDGET = 240`), not CSS `line-clamp` (which would force a
disclosure onto every row). It approximates ~2.5 lines at the content column;
re-tune against real pages if the corpus changes, do not raise it to flatter a
page. A property's `@default` is classified as a code-like **value** or
descriptive **prose** by one rule: a value is a single token with no internal
whitespace that fits `INLINE_DEFAULT_BUDGET = 32` (`undefined`, `true`,
`RemovalPolicy.DESTROY`, `-1`); everything else is prose. A value shows inline
in the header after `= `, in full: the budget is its only length bound, with no
narrower CSS clamp, and when the header line cannot hold it beside the name and
type the line wraps it onto a line of its own. A prose default (a phrase such as `Assigned
by CloudFormation (recommended)`) is NOT put in the header — it is shown in full
on its own always-visible line labelled `Default:`, ahead of any remarks,
because a default is one of the first things a reader looks for and truncating
it behind the disclosure hides exactly that. Exactly one `Default:` is emitted
per property: a value lives only in the header, a prose default only on its own
line. The leading jsii "no value" marker is stripped (`/^-(?:\s+|$)/`,
collapsing whitespace first so a multi-line doc block renders on one line and
cannot break markup) while a literal `-1` survives. Default normalization is a
single collapse-then-strip at the top of the row emitter so the classification
and both render paths never disagree.

The deprecated marker (`--api-c-deprecated`, declared in `:root` and shadowed
in `.dark`, both pinned WCAG AA against the page background) never rests on
color alone — a strikethrough carries deprecation independently and covers the
identifier only, never parameters, return type, or anchor.

The search-index boundary is drawn **inside the signature**: the parameter and
return portion is excluded (it repeats type names, the same leak that removed
props tables from the index — [search](./2026-10-15-search-and-filter.md)) but
the `.sig-name` identifier stays indexed, because with per-member headings gone
it is the only indexable carrier of the member name (12,418 method names in
`aws-cdk-lib`). A non-TypeScript language variant is one translated string and
stays fully excluded, so only the canonical TypeScript member spelling is
indexed; see [multi-language](./2026-10-15-multi-language.md). The fluent
`// chainable` badge is retained inline. Type-reference links in signatures and
property types share one affordance (dotted underline, solid brand on hover).

### Member permalink in the gutter

`.member-permalink` is `position: absolute; top: 0; left: 0; margin-left:
-0.87em` on a `position: relative` `.member-line`, hanging the `#` glyph in the
left gutter — exactly the theme's heading-anchor treatment — so member names
start flush with the content edge and no empty slot shows at rest. The anchor is
emitted last in markup order (assistive tech reads the member name first). The
gutter is 64px at default layout and ~14px wide, so the glyph never overlaps the
sidebar. This is the one permitted out-of-flow rule in the member-row section; a
density test permits exactly `.member-permalink` and fails any second
`position: absolute` there.

### Property row shrink priority

A property row is one `flex-wrap: nowrap` line. When too narrow for both the
type and the description, the **description yields first**:
`.props-table .prop-summary` has `flex-shrink: 100` against the type box's `1`,
so the type stays complete (it is part of the member contract and appears
nowhere else in the collapsed row) while the description clips. No `max-width`
cap on the type — the shrink weighting alone orders it in one declaration. The
clamp is an inline-block on the type (making it a flex item blockifies the
adjacent name `code` and shifts row height); the span gets `white-space: nowrap`,
`min-width: 0`, `overflow: hidden`, and a full-type `title`. Both clamps release
at the `max-width: 640px` breakpoint where rows stack. The language-variant
wrapper's `nowrap` is shared by method rows, where the variant holds the whole
signature; `.member-signature` releases it (`white-space: normal`,
`overflow-wrap: anywhere`) so a long signature wraps inside the content column
instead of running over the outline — a signature has no single line to clamp
to and is never truncated.

### "Construct Props" heading with a pinned anchor

A construct page's inlined props section is titled `## Construct Props` with an
explicit `{#props-<shortname>}` anchor reproducing the slug the old
``Props (`BucketProps`)`` heading auto-derived (lowercase, dots collapsed to
hyphens). `propsAnchor(fqn)` in `src/docgen/constructs.ts` reimplements that
two-operation slug subset rather than importing VitePress's slugifier, which
runs long after docgen emits markdown. This keeps every existing
`#props-<type>` deep link resolving byte-identically and keeps ids unique per
props type (no generic `#construct-props` collision).

### Explicit anchors

Every anchor a type page carries is set explicitly from the API, never slugged
from heading text, so headings can be reworded without moving a deep link.
`src/docgen/anchors.ts` owns them; `test/anchors.test.ts` asserts the ids in the
HTML VitePress renders.

- **Page title:** the shape the previous reference used, so its deep links
  resolve: `class-<name>`, `class-<name>-construct`, `class-<name>-mixin`,
  `interface-<name>` or `enum-<name>`, with the lowercased type name (no
  enclosing type). `-construct` marks a concrete `constructs.Construct` subclass
  whose public initializer takes `scope` first; abstract bases, `Construct`
  itself and `App` are plain classes. `-mixin` marks a Mixin-classified class.
  The previous reference also appended its experimental/deprecated badge markup
  to the title id; that tail is not reproduced.
- **Sections:** fixed ids `example`, `initializer`, `properties`, `methods`,
  `members`, `referenced-by` and `used-as-props-by`. Module overview sections are
  `module-submodules` and `module-types`, because README prose above them can
  carry its own `## Types` heading.
- **Members:** `memberAnchor(name)` from the canonical TypeScript name; inlined
  construct props as `props-<shortname>-<prop>` (above).
- **Enum members:** the lowercased member name on each Members row.
- README headings come from upstream content and keep VitePress's slugs.

No anchor carries a numeric `-1` disambiguation suffix.

### Kind badge palette

The kind travels as a class merged onto the badge root
(`class="api-badge api-badge-l2"`) via Vue attribute fallthrough, giving each of
nine kinds a distinct hue, declared once as `--cdk-badge-<kind>-{bg,text,border}`
in `:root` and shadowed in `.dark` (an unshadowed `:root` color wins in dark
mode). All sixteen contrast pairs clear WCAG AA (narrowest L1 light 6.15:1) and
are pinned by hex in `test/theme.test.ts`.

| Kind | Light text / bg | Dark text / bg |
|---|---|---|
| L1 | `#854d0e` / `#fef3c7` | `#fcd34d` / `#422006` |
| L2 | `#1e40af` / `#dbeafe` | `#93c5fd` / `#172554` |
| L3 | `#166534` / `#dcfce7` | `#86efac` / `#052e16` |
| Mixin | `#6b21a8` / `#f3e8ff` | `#d8b4fe` / `#2e1065` |
| Facade | `#115e59` / `#ccfbf1` | `#5eead4` / `#042f2e` |
| Struct | `#9d174d` / `#fce7f3` | `#f9a8d4` / `#500724` |
| Interface | `#3730a3` / `#e0e7ff` | `#a5b4fc` / `#1e1b4b` |
| Enum | `#9a3412` / `#ffedd5` | `#fdba74` / `#431407` |
| Class | `--vp-c-default-*` (neutral) | unchanged |

L1 keeps the amber construct pages already wore. Rules live in `api-layout.css`
(not `custom.css`, which is constrained to pure variable declarations). A badge
alignment override — `.vp-doc h1 > .VPBadge.api-badge` restating
`vertical-align: middle; margin-top: 0; transform: none` — keeps the badge on
the H1 baseline and is scoped to `.api-badge` so hand-written prose badges are
untouched; any badge reaching an API H1 must opt in. The palette governs three
surfaces consistently: the H1 badge, a link's hover-preview chip, and the
sidebar level tag. One label format, `<L> construct` from
`constructLevelLabel()`, is built once at build time and emitted as a `label`
field on the type's `type-summaries.json` entry (no second browser formatter).
`TypeEntry.kind` keeps its `Construct (L2)` classification form, because
`searchKind()` derives the Pagefind `kind:` filter from its first word. The preview chip takes its target page badge's full palette. Leveled constructs
use `.type-tooltip-kind-l{1,2,3}`; page-badged kinds use
`.type-tooltip-kind-{mixin,facade,struct,interface,enum}`. Both paths keep
`--api-c-badge-*` unchanged because REQUIRED/STATIC chips share it. The
sidebar tag borrows only the foreground over its own composited
`--vp-c-default-soft` chip — see
[sidebar navigation](./2026-10-15-sidebar-navigation.md).

### Per-module overview configuration

Every documented module owns one overview page at its canonical `-readme` URL
([docgen sources](./2026-10-15-docgen-sources-and-modules.md)), rendered by one
`renderOverviewPage()`. What it shows is chosen per module by an optional
`overviews` map in `docgen.config.json`, keyed by module id (`<assemblyName>`
or `<assemblyName>.<submodule>`), discriminated exhaustively on `kind`:

| kind | body |
|---|---|
| `readme` | the module's own README (**default**, including package roots) |
| `none` | no README — type list only |
| `copy` | another module's README body verbatim (one hop only; chains rejected) |
| `generated` | the artificial index (package roots only) |

`readme` as the default means a package root like `aws-cdk-lib` renders the
library README at its canonical URL rather than an artificial index; a missing
README degrades to table-only. The canonical URL never moves (`links.ts`
untouched) — `none` changes content, never existence, since removing a page
would 404 tens of thousands of breadcrumb roots. Package roots pass root-only
extras through two ordered slots: a **preamble** (documented version +
separate-install/experimental alert, above the README so an alpha package's
caveat sits above the fold) and **sections** (the `## Submodules` list, below).
The assembly description is dropped (the README's opening prose restates it).

Validation fails fast and names the offending key: `parseOverviews` checks
shape at config load (unknown kind, `copy` with blank/self/chained `from`);
`assertOverviewsResolvable` checks resolution before the first write (key or
`from` naming no module, `generated` on a submodule). `copy` runs the source
README through `prepareReadme` and looks up example translations under the
source module's fqn, but keeps the copying module's breadcrumb, sections, and
type list; relative links inside a copied README are not rewritten.

The API root publishes the authored AWS Construct Library overview; the
canonical per-module overview stays at its `-readme` URL. The `"/api/"` sidebar
key is retained as a load-bearing non-empty wrapper — VitePress derives
`hasSidebar` from array length and the generated API tree renders through
`sidebar-nav-after`, so an empty array would strip the entire API tree from all
generated pages ([sidebar navigation](./2026-10-15-sidebar-navigation.md)).
`renderModuleIndex` survives only as the `generated` implementation.

### Declared page title

Every type page declares `title: "<TypeName>"` (JSON-quoted) as its first
bytes, written at the single seam in `index.ts` where the page is assembled —
not at the six source-chip call sites. VitePress prefers `frontmatter.title`
over H1 inference, so the raw-HTML badge in the H1 can no longer contaminate the
browser `<title>` or the Favorites snapshot (which copies `page.title` at star
time). Frontmatter must precede the breadcrumb (VitePress parses it only at the
file top); a unit test pins the leading bytes and an e2e test asserts the
rendered `<title>`. `outline` is deliberately absent — type pages keep their
outline, only overview pages suppress it.

## Consequences

- Every jsii type is deep-linkable, cross-referenced, and Pagefind-indexed;
  build output grows to the full type count (~23k pages) and VitePress build
  time scales linearly, the practical ceiling.
- Type pages open with breadcrumb, H1 + kind badge, one prose description, one
  hierarchy block, an optional provenance list, then members — no table, no
  empty shells.
- Markup consumers must use `member-row`/`type-breadcrumb`/`type-metadata`
  vocabularies; the old `prop-row`/`method-details` markup and markdown props
  tables are gone.
- Relationship rows ship every entry in the HTML behind native `<details>`, so
  the four heaviest base-class pages pay in bytes (`constructs.Construct.md`
  ~211 KB) for completeness; an absolute "… and N more" cap is the lever if
  those pages are later judged too heavy.
- Nine badge hues, their contrast pairs, and the per-kind label are this
  project's to maintain; a tenth kind means a new hue and two pinned pairs.
- The L-level heuristic can misclassify unconventional constructs; it is
  confined to `constructLevel()`.
- Breadcrumb copy behavior, member-row geometry, and permalink placement are
  only observable in a browser, so they are pinned by `test/e2e/` specs.

## Rejected alternatives

- **Vue components fed structured data** for the interactive layout — rejected
  for native HTML emitted at build time, so pages stay static, no-JS functional,
  and greppable as plain text. The in-page outline is the one exception: it reads
  a generated member list
  ([members in the outline](./2026-10-22-outline-members.md)).
- **Grouping overflow relations by owning submodule** — `Construct`'s
  descendants span 316 namespaces, so grouping replaces one list with 316
  headings; the two-line budget plus disclosure handles the pathological pages
  without an index change.
- **A fixed count cap on relation rows** (e.g. 50 implementors) — silently
  withholds thousands of entries; the width budget truncates visibly and
  losslessly instead.
- **A `copy`-event handler rewriting clipboard data** for the FQN breadcrumb —
  makes the clipboard disagree with the DOM and fails for readers who do not
  fire the event; CSS padding achieves it for free.
- **A CSS `max-width` cap on the property type** — a second number that binds
  where nothing is wrong; the shrink weighting orders type-over-description in
  one declaration.
