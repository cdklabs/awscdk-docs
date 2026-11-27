# API Reference Pages

## Status

Accepted

## Context

The generated API reference needs a dedicated, deep-linkable page for every
jsii type — not just per-submodule type lists — so readers can bookmark
`BucketProps` or `BucketEncryption`, cross-references resolve to real pages,
and Pagefind indexes per-type content. Each page must present a type's
identity, provenance, relationships, and members densely and scannably, work
in light and dark mode, degrade without JavaScript, and stay byte-stable
across builds. All required data is present in the jsii assemblies
(`locationInModule`, base-class chains, `implements` clauses, `datatype`
flags, `cloudformationResource` metadata, `docs.*`); see
[docgen sources](./2026-10-15-docgen-sources-and-modules.md).

## Decision

### Module type list

A module overview lists its types under a `## Types` heading as a list grouped by kind (`renderTypeList` in
`src/docgen/index.ts`). A list wraps at any width, which a table of code spans does not: a long nested name such as
`CfnCapability.EdiConfigurationProperty` would be forced wider than the page.

- One `###` heading per kind, the plural of the kind label (`Constructs (L2)`, `Constructs (L1)`, `Structs`, ...).
  Groups appear in the order each kind first appears in the sorted type list, and entries keep that order inside a
  group. Empty groups are not shown. The `## Types` anchor is `module-types`; each kind heading has its own
  `module-types-<kind>` anchor from `typeKindAnchor`. A module overview without a README has no `## Types` heading,
  and its kind headings are `##` so the heading order stays valid.
- One entry per type: the name as a link, the kind label as a small tag beside it, the summary on the next line.
  A name over the break budget (`breakableTypeName` in `src/docgen/layout.ts`) carries `<wbr>` after each dot, so it
  wraps there; a dot-separated part that is itself over the budget also breaks at the camelCase and acronym
  boundaries a page title uses. A shorter name never needs a break and carries none, which keeps the element count
  of a large module low. `<wbr>` is empty, so the copied text, the link target and the search index see exactly the
  name.
- Each list is a real `<ul role="list">`. The role is explicit because the markers are hidden, and a browser may
  drop the list role from a list without visible markers.
- The list is plain markdown plus a `type-list` wrapper. The Markdown twin of the page keeps each entry's name link,
  kind and summary on one line, in that order, and drops the `{role=list}` attribute line, which is browser-only. Spacing reads `--density-type-list-gap`, which follows the density
  level.

### One page per type, dispatched by classification

Every jsii type gets a markdown page under
`docs/v2/docs/<docId>[.<submodule>].<Name>.md` (no submodule part for module-root types),
reachable from the module type lists and indexed by Pagefind. A single
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
  typed by the enum, plus the usage rows (below) in a `Type relations` block
  when a member takes or returns the enum. A deprecated member is marked like
  a deprecated property row: struck-through name, a `deprecated` badge, and
  the deprecation reason in place of the summary.

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
1. **L1 or L2 by tag** — has `cloudformationResource` metadata. A class
   named `Cfn*` is the generated L1. Any other tagged class is a
   hand-written construct that names the resource it wraps, so it is L2.
2. **L3** — declared in a `*patterns*` submodule.
3. **L2** — extends `aws-cdk-lib.Resource`.
4. **L1** — is or extends `aws-cdk-lib.CfnElement` (catches hand-written
   `CfnOutput`, `CfnParameter`, etc. lacking CFN metadata). Last so an
   override or genuine `Resource` descendant has already matched.

Constructs matching none (e.g. `constructs.Construct` itself, `CfnJson`) take
the neutral `Construct` chip, with no `api-badge-*` color class, rather than a
chip claiming a level they do not have. The level is also a sort key: `byLevelThenName`
(`src/docgen/ordering.ts`) ranks L3 > L2 > L1 > unleveled in sidebar leaf
lists and module type lists, so the overrides and the `CfnElement` subtree reorder
listings too. Source links pin the assembly version tag with any prerelease
suffix removed, so an alpha assembly, which has no tag of its own, pins the tag
of its release version (`2.277.0-alpha.0` -> `v2.277.0`). They are omitted for
`*.generated.ts` files (build-only, would 404). Props tables inline inherited
properties — users care about the full passable set, not the declaration
hierarchy.

### Mixin pages

Mixins are behavioral interfaces identified by the `IMixin` marker interface;
see [docgen sources](./2026-10-15-docgen-sources-and-modules.md). Implementor
discovery walks each class's base chain and takes the transitive closure of
every `implements` clause, so `Bucket` counts as an implementor of `IResource`
even when the clause lives on an ancestor. `renderMixinPage` emits name with a
`Mixin` kind chip, summary, methods, properties, and the implementing classes as
the hierarchy block's `implemented by` row. The heuristic is intentionally
inclusive: any implemented behavioral interface gets a useful page. Marker
interfaces get no mixin page but still appear in module type lists as `Interface`.

### Header: breadcrumb, title, chip row, merged description, hierarchy block

A type page opens with a navigable breadcrumb, then an H1 of the type name
alone, then one row carrying the kind chip, the stability chip and the page
actions, then a divider, then one prose description, one hierarchy block, and
an optional provenance table. The page has no legacy Module/FQN metadata
table, no `## Overview` heading, and no package+version badge.

The kind used to share the H1 as a `<Badge>`. It is a chip of the row instead,
because the heading is what a reader scanned for and the classification is
not part of the name: a title that reads `Bucket L2 construct` buries the one
word the reader came for, and the kind's natural neighbors are the controls
that act on the page rather than the words of its name. Putting the row below
the H1, as a sibling, keeps the heading a direct child of `.vp-doc` — the
selector the theme, the page outline and the inferred page title all rely on.

`renderDescription()` (`src/docgen/layout.ts`) folds doc summary and remarks
into one continuous prose block, which is Pagefind-indexed (remarks read as
the page lead, where readers look). The H1 carries only the type name. The
type-name span inserts `<wbr>` at CamelCase boundaries, and
after an acronym of two or more capitals that precedes a capitalized word
(`HTTP<wbr>Server`, `DB<wbr>Instance`). A single leading capital stays attached
(`IBucket`, `OAuth<wbr>Scope`), so no line ends in a lone `I` or `O`. The
weighted span still encloses the whole name, and `<wbr>` adds no text to page
titles, search results, copied names, sidebars, outlines, or Markdown twins.
Soft hyphens (`&shy;`) are not used: they add a character to the title's text,
which would reach the search index, the inferred page title and copied names.

### Breadcrumb that copies as an FQN

The breadcrumb (`<nav class="type-breadcrumb">`, built in `index.ts`,
rendered by `renderBreadcrumb` in `header.ts`) replaces the old Module/FQN
rows with navigable segments: `aws-cdk-lib › aws_s3 › Bucket`. Ancestor
segments link to their module/submodule page (as markdown links, so VitePress
applies site `base` and `.html` resolution); the current segment is unlinked.

It is plain text in the body typeface on the page's own background, with no
fill, radius or padding box, which is how the CDK Developer Guide next door
renders the same trail; the mono chip it used to be announced itself as a
widget rather than as a position.

Segments join on a real `.` with **no surrounding whitespace**, wrapped in a
`breadcrumb-dot` span and collapsed to `font-size: 0`; what a reader sees
between segments is a chevron drawn from two borders on each non-final
segment. The collapsed dot stays in a text selection and the chevron, being a
border, is not part of one, so the trail reads as a spaced hierarchy yet
copies as the exact FQN (`aws-cdk-lib.aws_s3.Bucket`) with no JavaScript or
`copy`-event handling. `font-size: 0` rather than `display: none` for exactly
that reason: a hidden dot would drop out of the selection, and the copied
trail would lose its dots. Only the
JOINS collapse — a dot inside one segment's own label, as a nested type
carries (`CfnTopic.SubscriptionProperty` arrives as one segment), is part of
the name a reader reads and stays visible. Every segment — including unlinked
structural segments — is wrapped in an element so the chevron can hang off it.
The copyable region is its own `breadcrumb-trail` element, distinct from the
paragraph holding the favorite star on pages that have no chip row.

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

The favorite star is an icon-only button that `<Teleport>`s into whichever
mount the page offers. A type page carries a chip row, so the star goes to its
`type-action-fav` spot beside Copy Markdown
([chip row](./2026-11-26-type-page-header-chip-row.md)); a module or submodule
overview has no row, so the star goes to the `breadcrumb-fav` spot the
breadcrumb bar emits and shares that row. The target is re-resolved on
`onContentUpdated`, and a page offering neither mount leaves the Teleport
disabled, which keeps the star in its standalone `doc-before` placement.

### One type-hierarchy block: every relation as a row

All eight relationships — `implements`, `extends`, `implemented by`,
`superclass of`, a struct's `used as props by`, `obtainable from`,
`used as argument in` and `returned by` — render
as rows of one hierarchy block under the breadcrumb, emitted through one shared
row renderer (`relationRowOf`): type entries via `relationRow`, member entries
via `memberRelationRow`. There is no separate `## Subclasses`, `## Implemented by` or
`## Used as props by` section and no inline-vs-section split by direction.
`used as props by` lists the classes whose initializer takes the struct (from
the reverse usage index); its row keeps the `used-as-props-by` id, so deep
links to the former section still land on it. The three member rows come after
every type-to-type relation, in one order on every page kind: `obtainable
from`, then `used as argument in`, then `returned by`.

`obtainable from` renders on class, interface, struct and construct pages: the static methods and
static properties (including constants) in the documented assemblies whose
declared type is the page's type or an optional of it — arrays, maps and
unions do not produce one instance, so they do not count. Protected statics are
skipped, as the member tables skip them. Each entry reads `Owner.member`
(`Bucket.fromBucketName`) and links the owner's page at the member's row
anchor, or the fragment alone when the owner is the page's own type; entries
are sorted by owner FQN then member, each once; the row carries the
`obtainable-from` id and shares the budget and disclosure below. The MEMBER
NAME is rendered as an inline language variant, translated per enabled language
like the member rows (the multi-language ADR's canonical identity, translated
display): through the member-name translators (a `const`
keeps its UPPER_SNAKE name in Python, as the member rows do), with the
separator `_` for a static in Go, where jsii exposes it as the package-level
`Owner_Member` and the whole entry varies instead;
an instance member keeps the dot, because in Go it is called
on a value. Only the member name varies between languages, so wherever the
separator is the same in every enabled language the owner, the separator and
the `<wbr>` are emitted once outside the variant spans, which is three of the
five nodes an entry would otherwise cost per language. It does not change what
a reader hears: Chromium's own name computation inserts a space at the `<wbr>`,
so **every** member entry is announced `Owner. member` where it reads
`Owner.member`, in every member row of the block.
Measured on a built page through `Accessibility.getPartialAXTree`, with the
prefix outside the spans, inside each span and absent: only dropping the `<wbr>`
removes the space, and moving it before the separator moves the space there
(`Owner .member`). The `<wbr>` is kept, because the pause falls where a line
break is already allowed and the visible label is still what the name contains
(WCAG 2.5.3). Playwright computes the name differently — it ignores the `<wbr>`
and inserts a space between a text node and an element instead — so the e2e
expectation allows one break after the first separator and is exact from there
on, which still fails a member name splitting inside its own span. In **every**
member row,
including this one, an entry whose short owner name is not unique in its
**block** carries its submodule as a trailing note, `Schedule.rate (aws_events)`: two
identical link texts pointing at different pages cannot be told apart in a
links list or a tab sequence (WCAG 2.4.4), and neither of those stops at a row
boundary, so the notes are computed once over the block's member entries
rather than per row. The note is a parenthetical rather
than a prefix, because a prefix reads as a namespace and the jsii submodule is
not the namespace Go, Java or C# would use, and it is counted into the width
budget like any other text. When two owners share that segment as well
(`x.a.mixins.Thing` against `x.b.mixins.Thing`), the note is the whole
namespace path, `x.a.mixins`, because a one-segment note would be identical on
both and the block would be back to two links a reader cannot tell apart. The
note is the jsii submodule, which is the
TypeScript and Python module name, and it is **not** translated per language:
the Java and C# namespaces for the same submodule
(`software.amazon.awscdk.services.events`, `Amazon.CDK.AWS.Events`) are longer
than the entry they would disambiguate, and the note's job is to tell two rows
apart rather than to name an import. The
anchor stays on the canonical jsii name and the width budget uses the widest
translation; the block is wrapped in `<LanguageTabs>` only when a member row
carries such a variant entry. A `<wbr>` after the separator lets a long entry wrap at narrow widths;
the agent Markdown twin drops it. `implements`
lists the **full transitive closure** of
interfaces reachable through class ancestors *and* interface `extends`
(the Javadoc "All Implemented Interfaces" rule), via a memoized cycle-guarded
resolver in `src/docgen/interfaces.ts` cached per `TypeIndex`. `superclass of`
(descendants, from `buildSubclassIndex`) and `implemented by` (implementors,
from `buildImplementorsIndex`) are transitive, merged, and share the one
corpus traversal that mixin classification already performs.

`used as argument in` and `returned by` are the inverse of a member
signature: for every named type the site documents, the members that take it
as a parameter and the methods that return it. They read from the same reverse
usage index and render as `memberRelationRow` entries, so a type page answers
"what can I pass this to, and what hands me one" without a reader grepping the
assembly. The rules:

- **Sources.** Methods and static methods of classes and interfaces, plus
  initializer parameters. Properties are deliberately not listed: an enum page
  already carries `Referenced by` for the properties that reference it, and
  property types are visible in the member tables of the owning type.
- **Generic wrappers unwrap.** A type inside an array, a map, an optional or a
  union is a usage of the named type inside it, because that is the type the
  reader has to supply or receives.
- **Protected members are skipped**, for the same reason `obtainable from`
  skips protected statics: a reader cannot call one, and the owner page has no
  row to anchor the entry to.
- **The declaring type owns the entry.** A jsii type lists its own methods plus
  a redeclaration of every method it overrides or implements, carrying an
  `overrides` field. Those redeclarations are skipped, so each member is
  recorded once where it is declared (`IBucket.grantRead`, not again on
  `BucketBase` and on every subclass, and `IAspect.visit` rather than one entry
  per implementor). Two kinds of member are never redeclarations: one whose
  overridden declaration is outside the documented assemblies, because nothing
  else would record it, and a **static**, because jsii marks a subclass static
  that shadows a base static with `overrides` although it is a separate
  callable with its own anchor, and its own package-level function in Go
  (`App.of` over `Stage.of`). One
  further exception, for `returned by` only: jsii allows a covariant override, so a redeclaration can
  narrow its return type. The types the narrowed return names that the
  overridden return does not are documented nowhere else, so they are recorded
  on the override; a type the overridden return already names stays with that
  declaration, which keeps one logical member from filling a row twice when an
  override narrows `Wide | Narrow` to `Narrow`. A redeclaration whose
  overridden method cannot be found on the type its `overrides` names is
  skipped like any other: nothing is known to compare the return against.
  Parameters need no such exception, because an
  override cannot change them.
- **Entry format.** `Owner.member`, the same as `obtainable from`, linked to
  the owner's page at the member's row anchor, and the same-name note the
  shared renderer adds (above) applies here too. An **initializer** entry reads
  `Owner (initializer)`, linked to the owner page's `#initializer` section:
  jsii gives an initializer no member name, and its per-language spelling
  changes form rather than casing (`new Bucket(...)`, `Bucket(...)`,
  `NewBucket(...)`), so no `Owner<sep>member` string exists to translate. The
  suffix names the section the link lands on, and keeps a row of members from
  reading as a row of types, since the same owner name can appear in
  `superclass of` or `implemented by` right above. Such an entry is
  language-stable and carries no variant spans; its suffix counts against the
  width budget like any other text.
- **Order.** By owner short name, then by owner FQN, then by member, so two
  owners of the same short name stay adjacent and sort between themselves by
  namespace rather than interleaving by member; an initializer entry leads its
  owner's entries, matching how it renders. Each owner and member appears once
  even when several parameters of one member match.
- **No row repeats a more specific one.** A usage the same block already states
  is dropped from these rows, because reading one `Owner.member` twice in one
  block tells the reader nothing the first row did not. So `used as argument
  in` drops an initializer entry whose owner the `used as props by` row above
  already names, and `returned by` drops a member the `obtainable from` row
  above already names. The filter runs per page rather than in the index,
  because whether the more specific row is on the page depends on the page
  kind: an enum or an INTERFACE mixin page carries no `obtainable from` row, so
  there the static factories do render as returners. A class-based mixin is
  rendered by the class path and does carry the row, so its returners are
  de-duplicated against it like any other class's.
- **Page kinds.** Classes, structs, interfaces, constructs, mixins and enums.
  An enum has no type-to-type relation of its own, so it gains a block that
  holds these rows alone (`renderUsageBar`); a mixin page gains them in the
  block it already had. Enum and interface mixin pages carry no
  `obtainable from` row; a class-based mixin goes through the class path and
  carries it.
- **Landmark name.** The block's `<nav>` is labeled `Type relations` whenever it
  holds no type-to-type relation, which is every enum and any type whose only
  relations are usage rows, such as `LifecycleRule`, and `Type hierarchy`
  otherwise. The label follows what the block contains rather than the page
  kind, so a landmark never promises a hierarchy and delivers call sites.
- **The `scope` parameter is not a usage.** A leading parameter named `scope`
  and typed exactly `constructs.Construct` or `constructs.IConstruct` is the
  construct tree the member attaches to, by the
  convention `constructs` sets for initializers and for the
  `X.fromY(scope, id, …)` family. It is skipped wherever it appears, in an
  initializer or in a method, because recording it listed most of the corpus on
  those two pages and repeated what their
  `superclass of` row already carries. Every part of the test matters: a later
  parameter is a usage like any other, so is a leading `scope` of any other
  type including a `Construct` subclass such as `Stack`, and
  `Stack.of(construct)` keeps its entry because its
  parameter is named `construct`. What the rule costs, on the two pages it
  applies to, is that a factory like `Bucket.fromBucketArn(scope, id, arn)` and
  a lookup helper whose parameter is named `scope` — `Aspects.of(scope)`,
  `Tags.of(scope)` — are not listed there, while
  `Stack.of(construct)` and `Names.uniqueId(construct)`, the same shape with
  another parameter name, are. The inconsistency is jsii's parameter names, and
  the alternative is a row that lists most of the corpus.
- **Size.** Both rows are clamped and excluded from the search index like
  every other row of this block, and the whole list ships in the HTML behind
  the disclosure. Every figure below was measured on one developer host, a
  16-core arm64 Linux box, base `6052c36` against the change that introduced
  these rows, with the same
  installed dependencies, and the method is: entry counts from
  `buildUsageIndex` over the assemblies of `docgen.config.json`; corpus size as
  the total bytes of generated `.md` pages under
  `docs/v2` from `npx projen docs:generate`, which is also where the wall time
  comes from; artifact size as the total bytes of the whole VitePress `dist`
  of an e2e fixture build
  (`docs:generate`, then `scripts/e2e-fixture-prune.cjs`, then `vitepress build
  docs`), HTML and `assets/*.js` together, because the per-page hydration chunk
  is the artifact cost that counts against the deploy limit as much as the HTML
  does, with the gzipped chunk reported separately where the performance gate's
  ceiling is what matters, and the deflate zip `scripts/package-site.sh`
  produces from that same `dist`, before the Markdown twins are overlaid, since
  the twins are the whole corpus on every fixture and would drown the signal;
  DOM nodes from
  `document.querySelectorAll('*').length` on a built fixture page.

  The index holds 13,343 `used as argument in` entries over 8,376 types and
  5,806 `returned by` entries over 2,120 types. What the rows RENDER is smaller,
  because the de-duplication above drops what a more specific row already
  states: 6,437 and 2,088 entries over 3,941 types. The corpus grew 744.2 MB to
  750.0 MB, +0.79 percent over 29,893 pages, and the Markdown twins 197.6 MB to
  198.5 MB, +0.45 percent. Docgen wall time end to end is the one figure
  this host measures badly: repeated runs of the same code ranged 103 s to
  147 s. The new work was timed on its own instead, median of seven runs over
  the 41,219 types of `docgen.config.json`: `buildUsageIndex` went 179 ms to
  268 ms, so the extra parameter and return walk costs about **90 ms** for the
  whole corpus. Per page, rendering `aws_cloudwatch.MetricOptions`, the page
  with the most entries in the corpus, went from 0.5 ms to 12.1 ms with the two
  rows and the de-duplication, median of seven `renderStructPage` runs in five
  languages on the same host; a page with no usage entries pays nothing
  measurable.

  Artifact growth depends on which services the fixture keeps. Raw `dist` bytes
  are not what the deploy gate checks: `scripts/package-site.sh`
  deflate-zips `dist` and fails above `MAX_ZIP_MB` (900, under the 1 GB
  GitHub Pages limit on compressed bytes), so the zip is the figure that can
  actually stop a release, and these rows are long runs of similar markup that
  deflate takes most of back.

  Both rows were measured with the fixture the defaults then named,
  `E2E_FIXTURE_SERVICES=aws-sns,aws-sqs E2E_FIXTURE_MODULES=constructs`, which
  `scripts/e2e-fixture-prune.cjs` still honors; the defaults have since grown.
  Pass those two variables to re-measure against these numbers.

  | fixture | raw `dist` | deploy zip |
  |---|---|---|
  | SNS and SQS, 77 pages | 44,857,537 B → 45,016,359 B, +0.35% | 4,602,976 B → 4,623,324 B, +0.44% |
  | plus `aws-cloudwatch` and `aws-iam`, 410 pages | 115,979,238 B → 119,872,457 B, +3.36% | 12,631,707 B → 12,867,022 B, +1.86% |

  The second fixture is the worst case a developer host can build, because
  almost every IAM type is a parameter or a return somewhere and CloudWatch
  carries the two heaviest rows in the corpus. The full site is not built on a
  developer host, so its own zip is **not measured**: the corpus figure is the
  site-wide number and the fixture figures bracket what bundling and
  compression do to it.
  Whoever changes what these rows collect re-measures the same way and reports
  it on the pull request. A growth above **5 percent** of the deployed zip is
  the line at which this presentation has to be reconsidered rather than
  shipped, well before `MAX_ZIP_MB` becomes the thing that says no. One
  tripwire runs in CI: `test/symbol-pages.test.ts` renders the heaviest row,
  `aws_cloudwatch.MetricOptions` from `aws-cdk-lib` and `constructs`, and pins
  its bytes **per entry** 5 percent above today's 545 in five languages. That
  catches markup growth in the renderer, which is this repo's to control. It
  deliberately does not pin the row's absolute size: the number of entries
  follows the pinned CDK version, so the nightly refresh would turn red for a
  CloudWatch release that this repo did nothing to cause. It does bound that
  count loosely, at about double today's 409, so a release that doubles the
  call sites stops and asks for the re-measure above rather than landing
  unseen.
- **The heaviest pages.** Ranking the 29,893 generated pages by size, the
  biggest are catalog types that predate these rows:
  `aws_quicksight.CfnCustomPermissions.CapabilitiesProperty` and
  `aws_ec2.InterfaceVpcEndpointAwsService` at about 1.08 MB each,
  `aws_config.ResourceType` at 0.99 MB. `constructs.Construct` ranks 24th at
  0.39 MB, and these rows added 10 KB to it; its built page went 0.41 MB and
  7,685 DOM nodes to 0.42 MB and 7,853.

  Ranked by the entries the rows RENDER, over the whole corpus, the pages these
  rows add most to are `aws_cloudwatch.MetricOptions` (618 in
  `used as argument in`) and `aws_iam.IGrantable` (445), then a run of
  reference interfaces around 70 each, and for `returned by`
  `aws_cloudwatch.Metric` (588), `aws_iam.Grant` (445) and
  `aws_events.EventPattern` (115): the shape repeats wherever one struct is the
  parameter of a family of methods and one class is what they return. Ranking by
  index entries instead would put `CfnPropertyMixinOptions` first with 1,905,
  which is wrong: every one of those is an initializer entry whose owner the
  props row already names, so its rendered row is empty. All four are
  measured, on the fixture extended with `aws-cloudwatch` and `aws-iam`:

  | page | built HTML | DOM nodes | chunk, raw | chunk, gzipped |
  |---|---|---|---|---|
  | `aws_cloudwatch.MetricOptions` | 83 KB → 410 KB | 3,188 → 8,264 | 69 KB → 426 KB | 5.6 KB → 24.5 KB |
  | `aws_cloudwatch.Metric` | 110 KB → 419 KB | 3,739 → 8,450 | 101 KB → 436 KB | 8.3 KB → 25.7 KB |
  | `aws_iam.Grant` | 74 KB → 283 KB | 2,915 → 6,493 | 59 KB → 289 KB | 6.5 KB → 17.6 KB |
  | `aws_iam.IGrantable` | 43 KB → 252 KB | 2,346 → 5,938 | 24 KB → 254 KB | 3.3 KB → 14.6 KB |

  The gzipped column is the one the performance gate's 400 KB combined JS+CSS
  ceiling is measured against (the collect server serves gzipped, so
  `transferSize` is compressed bytes). Those chunks are long runs of similar
  markup, which compresses by about 17 times, and every other `assets/*.js`
  and `assets/*.css` in the fixture adds 31 KB gzipped, so the heaviest of
  these pages ships about 56 KB of the 400 KB. Raw bytes are what the deploy
  artifact pays and gzipped bytes are what a reader downloads; neither is near
  its limit.

  The other half of that gate is the Performance score, and
  `lighthouse.config.json` audits none of these pages. It was run against them
  by hand instead, with the gate's own settings — the `lighthouse` CLI,
  `--only-categories=performance --preset=desktop`, `docs.aws.amazon.com`
  blocked as `scripts/lighthouse-run.cjs` blocks it, three runs, lower-middle
  median — on the fixture that keeps `aws-cloudwatch` and `aws-iam`:
  `aws_cloudwatch.MetricOptions`, the heaviest page in the corpus, scores
  **0.95** (0.94 to 0.98) and `aws_cloudwatch.Metric` **1.00**, against the
  gate's 0.9 minimum, with total blocking time of 0 ms on both; on the default
  fixture `aws_sqs.IQueue` scores 1.00 and `constructs.IConstruct` 0.98. So the
  rows cost download bytes rather than main-thread time, which is what the
  clamped, folded markup is for. Blocking the third party matters to the
  reading: unblocked, the AWS cookie banner is the LCP element on every page
  and swamps the score, which is why the gate blocks it.

  These four are the cases to measure before adding a third such row: the
  disclosure bounds the height a reader sees, not
  the DOM the browser parses or the chunk it downloads.

Each row is clamped to two lines by a **build-time character budget**
(`RELATION_ROW_BUDGET = 70`, tuned by measurement — a derived 150 ran to 3–4.75
line-heights), not a CSS line clamp, because unclamping a CSS clamp needs the
hidden names inside `<summary>`, which is the `nested-interactive` a11y
violation. Truncation is **lossless**: a sibling `<details>` reveals every
hidden name and its summary states what is *hidden* (`2,507 more`), reading as
the row's continuation. Its accessible name leads with that same visible count
and then names the row, `2,507 more superclass of`: one block can hold several
overflowing rows, and a reader moving by controls has to be able to tell which
one each disclosure opens (WCAG 2.4.4), while the visible text leading the name
is what 2.5.3 asks for. This applies to every row of the block, including the
ones that predate the usage rows. The disclosure is plain HTML, so pages work before
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
item (`', '` between names, bare `','` before the disclosure). Type rows and
`obtainable from` are FQN-sorted for byte-stable output; the usage rows sort by
owner short name first, as their Order bullet above records, which is byte-stable
too. All relations ship in the HTML (hidden by
`<details>`); the block carries `data-pagefind-ignore` so type names repeating
on every page do not pollute search ([search](./2026-10-15-search-and-filter.md)).

Interface-to-interface "Extended by" is deliberately out of scope — a separate
reverse index; an interface's own `extends` already renders in its row.

### Provenance metadata block

A metadata table (`renderTypeMetadata`, rows from the shared
`typeMetadataRows(type, assembly, index, linkFor)`) renders under the
hierarchy block on every type page. Each row has one `<th scope="row">`
label and one `<td>` value, and only facts that apply to the type render:

| row | source | link |
|---|---|---|
| Stability | the type's stability, falling back to its assembly | stability guide; experimental types only |
| CloudFormation | the L1's own resource type, or the L1 an L2 is backed by | AWS resource reference, `target="_blank"` |
| L1 type | the backing L1, on non-L1 pages only | that L1's page, via `pageHref` |
| Source | upstream file and line | repository, or the text *Generated at build time* |
| Type last changed | page history for the type's shape | version and release date text |

A hand-written L2 that carries the `cloudformationResource` tag shows that
tag's resource type and no L1 type row.

Provenance is neither prose nor title material, so it lives here rather than in
the H1 or the description. The block emits nothing when there are no rows (no
empty shell), and another row needs no markup or layout change. The only
positional selector, `tr:nth-child(2n)`, cancels VitePress's zebra stripe; it
does not encode a row count. `isGeneratedSource()` is a predicate with no
markup; the source chip no longer lives in the H1.

Indexing is **selective**: the CloudFormation and L1-type values are indexed
(each names exactly one page, so searching `AWS::S3::Bucket` finds `Bucket`);
the Source value carries `data-pagefind-ignore` because its file-path text
would compete with real prose. The link affordance on in-block links is brand-2
with an at-rest underline (brand-1 on `--vp-c-bg-soft` clears AA only by a thin margin, 4.61:1; brand-2 is 12.11:1).

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

### Property type wraps inside the row

A property row's header line is `flex-wrap: wrap`; the summary sits in its own
block below it, so the type competes with nothing on its line. A type too long
for the column **wraps rather than clips**: the type is part of the member
contract and appears nowhere else in the row, so an ellipsis hides exactly the
part a reader came for. The language-variant wrapper is `white-space: nowrap`
with `min-width: 0` and `max-width: 100%`, keeping the name and its type
together and inside the row; `.member-list .member-type` releases the `nowrap`
for the type's own text. Breaks happen at the spaces a type already has
(`IResolvable | …`, `typing.Union[a, b]`) and, in a qualified name longer than
the narrowest column holds whole (32 characters), after every dot, which the
renderer follows with a `<wbr>` in the visible copy only — a nested-type name
(`CfnRegistry.CustomMetadataSchemaConfigurationProperty`) breaks after
`CfnRegistry.` rather than mid-word, while a short `typing.List` stays together
because its dot would be taken before the bracket or space beside it. That
qualification exists in the TypeScript spelling; the other languages name a
nested type by its last segment, which takes the `overflow-wrap` fallback when
it does not fit. A single token wider than the whole column falls back to the
page's `overflow-wrap: break-word`; the type span carries the wrapper's
`min-width: 0` and `max-width: 100%` itself for the single-language shape,
where it is the row's flex item. The full spelling stays in the span's `title`
as plain text. The wrapper's `nowrap` is shared by method rows, where the
variant holds the whole signature;
`.member-signature` releases it (`white-space: normal`, `overflow-wrap:
anywhere`) so a long signature wraps inside the content column instead of
running over the outline — a signature has no single line to clamp to and is
never truncated.

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
  `members`, `referenced-by`, `used-as-props-by`, `obtainable-from`,
  `used-as-argument-in` and `returned-by`. Module
  overview sections are `module-submodules` and `module-types`, because README
  prose above them can carry its own `## Types` heading. Each kind group in the
  type list is `module-types-<kind>` (`typeKindAnchor`), e.g. `module-types-structs`.
- **Members:** `memberAnchor(name)` from the canonical TypeScript name; inlined
  construct props as `props-<shortname>-<prop>` (above).
- **Enum members:** the lowercased member name on each Members row.
- README headings come from upstream content and keep VitePress's slugs.

No anchor carries a numeric `-1` disambiguation suffix.

### Kind palette

The kind travels as a class on the header row's kind chip
(`class="type-chip type-chip-kind api-badge-l2"`), giving each of eight kinds a
distinct hue, declared once as `--cdk-badge-<kind>-{bg,text,border}`
in `:root` and shadowed in `.dark` (an unshadowed `:root` color wins in dark
mode). A plain class and a level-less construct carry no `api-badge-*` class at
all: their chip reads the neutral `--th-chip-neutral-{bg,text}`, the ninth row
of the table below. All eighteen contrast pairs, nine rows in two schemes,
clear WCAG AA, and every dark pair clears 7:1 (narrowest 8.02:1). In light mode
every pair clears 7:1 except L3 (6.49:1) and Facade (6.73:1): darkening Struct,
Enum and L1 is what closed the last three, leaving L1 the narrowest of those at
7.79:1. Every pair is pinned by hex in `test/theme.test.ts`.

| Kind | Light text / bg | Dark text / bg |
|---|---|---|
| L1 | `#713f12` / `#fef3c7` | `#fcd34d` / `#422006` |
| L2 | `#1e40af` / `#dbeafe` | `#93c5fd` / `#172554` |
| L3 | `#166534` / `#dcfce7` | `#86efac` / `#052e16` |
| Mixin | `#6b21a8` / `#f3e8ff` | `#d8b4fe` / `#2e1065` |
| Facade | `#115e59` / `#ccfbf1` | `#5eead4` / `#042f2e` |
| Struct | `#831843` / `#fce7f3` | `#f9a8d4` / `#500724` |
| Interface | `#3730a3` / `#e0e7ff` | `#a5b4fc` / `#1e1b4b` |
| Enum | `#7c2d12` / `#ffedd5` | `#fdba74` / `#431407` |
| Class | `#424650` / `#f2f3f3` (neutral) | `#d5dbdb` / `#232f3e` |

L1 keeps the amber construct pages already wore. Rules live in `api-layout.css`
(not `custom.css`, which is constrained to pure variable declarations).

The chip's EDGE is `currentColor`, not a palette tint. The former
`--cdk-badge-*-border` tints measured 1.69:1 light and 1.71:1 dark against the
chip fill and so were not a visible edge at all; as the ink, `currentColor`
clears whatever the chip's label clears against that fill, because the ink/fill
pair is already pinned above. Those tints are gone from the palette, along with
the H1 badge rules that were their only readers. The neutral Class chip carries its own opaque pair rather than the
translucent `--vp-c-default-soft` it once inherited, so that pair can be read
and pinned like the others.

The badge alignment override — `.vp-doc h1 > .VPBadge.api-badge` restating
`vertical-align: middle; margin-top: 0; transform: none` — STAYS even though
the kind badge has left the H1: the `Added in vX.Y.Z` badge has not, and stock
`vertical-align: top` plus `translateY(-2px)` lifts it off the baseline the
name sits on. It remains scoped to `.api-badge` so hand-written prose badges
are untouched; any badge reaching an API H1 must opt in.

The palette governs three surfaces consistently: the page's kind chip, a
link's hover-preview chip, and the sidebar level tag. One label format, `<L> construct` from
`constructLevelLabel()`, is built once at build time and emitted as a `label`
field on the type's `type-summaries.json` entry (no second browser formatter).
`TypeEntry.kind` keeps its `Construct (L2)` classification form, because
`searchKind()` derives the Pagefind `kind:` filter from its first word. The preview chip takes its target page chip's full palette. Leveled constructs
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
README degrades to list-only. The canonical URL never moves (`links.ts`
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
canonical per-module overview stays at its `-readme` URL. The `"/v2/"` sidebar
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
- Type pages open with breadcrumb, H1, a kind + stability chip row carrying the
  page actions, a divider, one prose description, one hierarchy block, an
  optional provenance table, then members — no legacy Module/FQN table and no
  empty shells.
- Markup consumers must use
  `member-row`/`type-breadcrumb`/`type-header-row`/`type-metadata`
  vocabularies; the old `prop-row`/`method-details` markup, the H1 kind
  `<Badge>` and markdown props tables are gone.
- Relationship rows ship every entry in the HTML behind native `<details>`, so
  the heaviest base-class pages pay in bytes for completeness; the figures, the
  measurement method and the pages to watch are in the Size and heaviest-pages
  bullets above. An absolute "… and N more" cap is the lever if those pages are
  later judged too heavy.
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
  fire the event; collapsed join dots and CSS-drawn chevrons achieve it for
  free.
- **A CSS `max-width` cap on the property type** — a second number that binds
  where nothing is wrong; the shrink weighting orders type-over-description in
  one declaration.
