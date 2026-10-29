# API Sidebar Navigation

## Status

Accepted

## Context

The API reference documents on the order of ~27.5k types across ~320
sections. The sidebar is the primary map of that corpus. Readers navigate by
what they know — the AWS service — not by npm packaging, which leaks an
implementation detail (which package a type ships in) that readers do not
care about. The site is statically generated and published as static files,
so there is no backend: per-reader state lives client-side, and the tree
must be served without inflating per-page HTML.

The sidebar is fully generated. Docgen builds the tree in
`src/docgen/sidebar.ts`; the theme renders it. Grouping and labeling are a
data-layer concern — canonical page routes
(`/api/modules/<lang>/<pkg>/<submodule>/<TypeName>`), anchors, and
cross-reference targets are never changed by a navigation decision, only
*where a type is listed* changes.

The optional package regrouping of this same data is recorded in
[API Sidebar Navigation Styles](./2026-10-23-sidebar-navigation-styles.md).

## Decision

### Service → resource → kind structure

`buildServiceSidebar()` groups by AWS **service**, then **resource**, then
**kind** — never by package:

- **Section per service.** A jsii submodule maps to its service via the
  first token after the `aws_` prefix, so integration submodules fold in
  (`aws_s3` and `aws_s3_deployment` both land in *S3*). Display names use
  curated entries for branded, renamed, and multi-word services, with an
  acronym/title-case fallback for unchanged names. Types from different
  packages that map to the same service merge into one section.
- **Core section.** Foundational types — the `constructs` package,
  module-root types (`Stack`, `App`, ...), and `assets` — lead, with a flat
  kind grouping (Constructs / Mixins / Others); resource grouping does not
  apply to Core.
- **Resource groups.** *Superseded for constructs that resolve a
  CloudFormation resource type — see
  [sidebar grouping by CloudFormation resource](./2026-10-22-sidebar-grouping-by-cloudformation-resource.md).
  The name-stem rule below remains the fallback for constructs that resolve
  none.* Within a service, types group by resource, named by
  the construct's *stem* — its name with the `Cfn` L1 prefix stripped, so
  `CfnBucket` and `Bucket` pair under one *Bucket*. Related types attach by
  stem (stripping the `I` interface prefix and `Props` suffix:
  `IBucket`/`BucketProps` → Bucket), or failing an exact match the longest
  resource that prefixes the stem at an uppercase boundary
  (`BucketPolicyProps` → BucketPolicy, not Bucket). Unmatched types land in
  a service-level *General* group. The heuristic is name-based, so types
  whose names do not reference their resource (e.g. `BlockPublicAccess`)
  land in *General*; this is accepted — a semantic association would require
  analyzing type usage, and *General* keeps them discoverable.
- **Conditional wrappers.** A section with **at most one** resource
  collapses its wrappers: it lists that resource's constructs directly with
  the remaining kinds beside them, and has no service-level *General* group
  (the submodule *Type index* fallback then appears in that section's own
  *Others*). So nesting depth depends on how many resources a section has,
  not how many types: two-or-more resources nest four levels (service →
  resource → kind → type), at-most-one nests three.
- **Kind groups.** Each resource splits into *Constructs*, *Mixins*,
  *Facades*, *Traits*, *Others* (classes/interfaces/enums), in that
  building-block order; empty groups are omitted. Constructs and mixins link
  to their dedicated pages ([api reference pages](./2026-10-15-api-reference-pages.md)); others link
  dedicated pages where they exist, otherwise fall to *General*/*Others* so
  the submodule type-table fallback (*Type index*) appears once per section.
  Kind headings carry an explicit marker in the data; the de-emphasis
  styling keys on that marker, not on tree depth, so a heading renders
  identically with or without a resource wrapper.
- **Facades and Traits classified structurally**
  (`src/docgen/classification.ts`), not from name lists. A **Facade** is a
  non-construct class with a static `from{Resource}()` factory returning
  itself whose first parameter is a resource reference interface (`I…Ref`),
  named `{Resource}{Feature}` (e.g. `BucketGrants`); this rejects lookalikes
  such as config-object factories. A **Trait** is a non-datatype interface
  pair — a factory interface with a method taking a single L1 `CfnResource`
  and returning the trait interface it produces. Capability interfaces
  without a factory (`IGrantable`, `IConnectable`) stay under *Others* by
  design. New facades and traits classify automatically; there is no curated
  list.
- **Overview entries.** `buildServiceSidebar()` prepends direct `Overview`
  leaf link(s) to each section, before the resource/kind groups, reusing the
  entry's canonical `indexLink`. Section headers stay pure disclosure
  controls (expand/collapse), never navigation — overloading one control
  with navigate-vs-disclose is a touch-device mis-click hazard. A section
  folding one module gets a plain `Overview`; one folding several puts the
  primary `aws-cdk-lib` service module first, then keeps the canonical-package
  and link order for related overviews. A primary module is a non-empty
  `aws_<service>` or `alexa_<service>` name with no further suffix. Multiple
  overviews are disambiguated as `Overview (<submodule>)`, qualified with the
  package name on a cross-package collision. Labels are language-aware via
  `labelVariants`.

### Framework / Services split

Sections partition into two expanded-by-default top-level roots —
**Framework** (Core plus every non-service feature module) first, then
**Services** (AWS service modules). Classification is by naming convention,
not an allowlist: `isServiceSubmodule` treats `aws_*` (plus vendored
`alexa_*`) as services and everything else as Framework. New services carry
the prefix and land in Services automatically; new framework modules land in
Framework with no list to maintain. The tree marks both roots
`collapsed: false` and `ApiSidebar` seeds its expansion set from the
pre-opened roots, so the reader lands on the familiar section list.

### Curated Framework top level

The Framework root no longer lists every framework module as a peer. Its top
level is an editorial allow list kept as data in
`src/docgen/framework-nav.ts` (`FRAMEWORK_NAV`), shown in list order:
`aws-cdk-lib`, Custom Resources, Testing, Triggers, `constructs`. This
replaces only the flat, alphabetical top level; which modules count as
Framework is still the naming convention above, so a new framework module
needs no list entry to appear. A flat list of a dozen-plus package names
buried the handful of modules most readers look for under internals such as
`cloud_assembly_schema` and `cx_api`.

- Every unlisted framework module nests under its package root when that
  root is listed (`aws-cdk-lib.pipelines` under `aws-cdk-lib`), else under
  `defaultParent` (`aws-cdk-lib`, which adopts the `@aws-cdk/*` framework
  packages). Nested modules follow the parent's own kind groups, sorted
  unscoped-alphabetical with `@`-scoped packages last, and keep their own
  Overview link and types, so no page leaves the nav. Their page stems join
  the parent's `modules`, so the served skeleton still finds the chunk for
  every page. A listed module the build does not document is skipped; with
  no listed parent available, an unlisted module stays on the top level.
- A friendly label is display only: `text` stays the package-qualified
  module name (`aws-cdk-lib.assertions`), so links, group keys and collapse
  memory are unchanged, and the in-sidebar filter matches the label as well
  as the module name.
- The list is editorial and has to be maintained when a module should be
  promoted or renamed; that cost is accepted for a short, readable top level.

### Structural submodules rolled into their owning service

`serviceSubmodule()` normalizes `aws-cdk-lib`'s structural submodules in the
data layer so they do not surface as garbled branches (`Interfaces.aws S3`,
`S3.mixins`): `interfaces.<sub>` → `<sub>`, bare `interfaces` → module root
(Core), `<sub>.mixins` → `<sub>`. Rolled-in types then flow through the
normal resource/kind grouping. Classification into Framework/Services runs
on the owner submodule, so these types follow their owner. New reserved
submodule names in future releases would need adding here.

### Construct level as a sidebar field

A construct's level (`L1`/`L2`/`L3`) travels as its own optional field
(`SidebarEntry.level`, `ApiSidebarNode.level`), never folded into `text` or
`label` — `text` is the node's identity (group keys, in-sidebar filter,
jump), so `Bucket` must not become matchable as `l2` through its text. The
level is determined once by `constructLevel()` (L1 has jsii
`cloudformationResource` metadata, L3 lives in a `*patterns*` submodule, L2
extends `Resource`) and carried to three consumers. The theme renders it as
a `aria-hidden` chip inside the leaf link, before the name, with a fixed
`min-width` so L1/L2/L3 measure identically. The level reaches assistive
tech through the link's `aria-label`, spelled out and **appended** (`Queue
(L2 construct)`) so the accessible name still starts with the visible label
(label-in-name). Only leveled constructs get a chip — no reserved gutter on
untagged rows. The chip uses `--vp-c-text-2` (and `--vp-c-brand-2` on the
active row) to meet 4.5:1 contrast; `--vp-c-text-3` fails there because the
chip's `aria-hidden` text is the only visual level channel. Because level is
a field, it is also a sort key: `byLevelThenName` in `src/docgen/ordering.ts`
orders construct lists L3, L2, L1, then unleveled, alphabetically within
each tier, applied to sidebar leaf lists and index/overview type tables.

### Lazy loading, skeleton + per-section chunks, content-hashed

VitePress server-renders the configured sidebar into the HTML of every page
it applies to. A full ~27.5k-entry tree on every API page is O(n²) HTML, so
the tree is generated once and loaded on demand, keeping the native
VitePress sidebar shell:

- `themeConfig.sidebar["/api/"]` carries only the "Overview" link so the
  rail still renders. The tree is served as static assets under
  `docs/public/api-sidebar/`.
- Docgen emits (`splitSidebarChunks`) a **skeleton** (`sidebar.<hash>.js`):
  both roots and every section node with its text, collapse state, and a
  `modules` list of page-id stems (`<docId>[.<submodule>]`) it owns — but
  no `items`; each section names its `chunk` instead. Each section's
  `items` live in `chunks/<name>.<hash>.js`. The canonical
  `docs/api/sidebar.json` stays the full tree; the split is serving-only.
- A theme component **`ApiSidebar`** (mounted in `sidebar-nav-after`, inert
  outside `/api/`) fetches the skeleton once per session, then a chunk when
  its section is needed: on load/route-change the section owning the active
  page (matched against `modules` stems on a whole-stem boundary — `<stem>.`
  or `<stem>-readme`, longest stem wins, so `aws_s3` cannot claim
  `aws_s3_deployment`); on section open; and **every** chunk when the
  in-sidebar symbol filter activates (it prunes the whole corpus). Fetches
  go through one memoized retry-on-failure loader; a failed chunk leaves the
  skeleton usable. Internal links are native `<a>`, so the VitePress router
  preserves SPA navigation; active-state and auto-expansion derive from
  `useRoute()`/`activeAncestorKeys`.
- **Content-hashed names** (eight hex of SHA-256) make assets cache-bustable
  and safely long-cacheable; identical content reproduces the name, so an
  unchanged rebuild is a no-op. The directory is cleared before each
  generation. The symbol index lives here too as `symbols.<hash>.js`. Chunk
  names are resolved from the skeleton (which the component already holds);
  the skeleton and symbol index are resolved at build time and passed
  through `themeConfig`, so no name costs an extra request. An empty name is
  treated as an absent asset (sidebar error state).

Framework-free logic (path normalization, active-branch computation, fetch
memoization) lives in `docs/.vitepress/theme/api-sidebar.ts` and is unit
tested. A cold load of a construct page fetches ~7.5 KB gzip of sidebar data
(skeleton + that section) instead of ~275 KB for the whole tree; the largest
single chunk is ~26 KB gzip. Server-rendered page content and its inline
cross-links are unaffected, so the crawlable link graph and Pagefind
indexing ([search and filter](./2026-10-15-search-and-filter.md)) still work.

### Nesting depth stays visible

The Framework and Services section headers and service rows remain flush.
Every level below a service adds one `--density-sidebar-indent`; leaf links
add the caret's 16px width after that same depth offset. Resource groups, kind
groups, and types therefore form distinct parent/child steps while siblings
at each depth share one text column. The density setting owns the step size,
so Compact, Balanced, and Spacious remain consistent. Long names still wrap
within the widened sidebar instead of being clipped.

### Collapsed subtrees are not rendered

`ApiSidebarItem.vue` renders a group's children under **`v-if`**, not
`v-show`, so a collapsed subtree is absent from the DOM. Keeping the whole
corpus mounted-but-hidden cost ~96,500 DOM elements on every API page
(Total Blocking Time ~570ms); `v-if` drops that to ~3,400. Unmounting is
safe here because no child holds its own state (expansion lives in the
`ApiSidebar` root's shared `expanded` set, and filter-time folds in its
`filterCollapsed` set), `syncActive()` works off tree
data not the DOM, both reveal paths wait for `nextTick`, the filter opens
surviving groups by default, and `.api-sidebar-list` has no CSS transition.
Expanding a group pays the mount cost (~577 rows for the widest) only when a
reader opens it. This is deliberately opposite to the Favorites section
(below), which keeps its handful of entries mounted: the discriminator is
whether collapsed content size scales with the corpus.

### Persistent collapse memory

`docs/.vitepress/theme/sidebar-collapse.ts` stores the reader's disclosure
choices in `localStorage` behind an injected `StorageLike` seam (unit-tests
in plain Node). `localStorage`, not the scroll memory's `sessionStorage`: a
disclosure choice ("I do not want Services expanded") outlives the tab and
should apply to a new one. The key is versioned
(`cdk-docs:sidebar-expanded:v1`) and capped at 200 entries (parsed on every
API page). State is **tri-state** per key — `opened`, `closed`, or
*untouched* — because a plain open-set cannot represent "closed a group the
generated tree opens by default" (the Framework/Services roots), which would
spring back open on reload. The effective open set is computed:
`effectiveExpanded(defaults, explicit)` layers reader choices over the
tree's defaults. Only explicit `toggle()` writes; the auto-reveal path
unions into the *live* open set but is never persisted (it is a side effect
of navigation, not a choice, and would grow unbounded). Every read and
mutation re-syncs from storage first, so concurrent tabs do not clobber each
other. Stored keys are pruned to live `groupKeys` on load; corrupt data
degrades to defaults; a failing write degrades to in-memory.

### Scroll preservation

`docs/.vitepress/theme/sidebar-scroll.ts` records the sidebar's `scrollTop`
per normalized route in `sessionStorage` (survives reload and hard
back/forward within the tab; a throwing/absent storage degrades to an
in-memory map; entries are capped, least-recently-saved evicted).
`sessionStorage` because a scroll offset is a property of *this* tab's
reading position. Restore happens **only on history traversal** (a
`popstate` listener marks it) and on load; forward navigation leaves the
position untouched — the component stays mounted, so it carries over, and
restoring would surprise the reader. On load with no remembered position,
the active entry is scrolled into view, centered, smooth (instant under
`prefers-reduced-motion: reduce`).

Save captures the route and position **together, at scroll-event time**:
`createThrottledScrollSaver(save, schedule)` returns `record(path, top)` and
the frame only flushes the last captured pair. Handing over values (not
re-reading the route or `scrollTop` when the frame runs) makes mis-filing
under a history traversal that flips the route mid-frame *unexpressible*.
Coalescing is unchanged — one `save` per flush carrying the last pair. The
`isApi` guard runs at event time, so leaving an API route still records the
outgoing position.

### Sticky sidebar header

The symbol filter (which carries the locate control in its status row) and
the favorites list are wrapped in one `.sidebar-header` element that is
pinned (one wrapper because sticky siblings do not stack and would overlap).
The offset is `top: 0`, measured not derived — the aside's own top inset
already positions the scrollport below the navbar, so adding the navbar
height again would leave a gap. The desktop rail clips at its own border
box; the mobile drawer gets a `::before` mask anchored at `bottom: 100%` to
cover the strip above the pinned block (VitePress scopes its `.curtain` mask
to ≥960px). Because the block occludes the top of the scrollport, the reveal
logic insets the visible region it passes to `sidebar-scroll.ts` (keeping
that module DOM-free) and sets `scrollPaddingTop` from the same measured
header `bottom`, so keyboard focus landing near the top clears the block —
box-containment alone would wrongly treat an occluded entry as visible
(WCAG 2.4.11). Specs assert visibility by hit-testing a painted point, not
by coordinates, which are invariant under exactly these faults.

The nearest enclosing group heading is pinned directly under this block too
(`2026-10-28-sidebar-sticky-group-heading.md`), so the visible region and
`scrollPaddingTop` are also inset by that heading's measured height.

### Locate current page

A `JumpToCurrent.vue` control (label **Locate current page**, which is also
its accessible name — no `aria-label` that would shadow it under WCAG 2.5.3)
reveals the active entry. It lives in the filter's status row — `NavFilter`
exposes a generic `status-actions` slot and knows nothing about the jump
feature — which keeps the header height a property of the filter alone (62px
on both the API overview root and a type page) rather than growing it when
the control appears. The control communicates with the sidebar through a
module-level monotonic counter in `sidebar-jump.ts` (a counter, not a
boolean, so pressing it again after wandering off has a second edge to
watch). The reveal is additive — it reuses `syncActive()`, which only *adds*
ancestor keys, never collapsing a group the reader opened — and changes no
route, slug, or anchor. If the active row is already fully visible it leaves
scroll untouched, moves focus (`preventScroll`), and flashes the row (static
outline under reduced motion); off-screen/collapsed rows get the additive
unfold + centered scroll. It is a no-op while the filter has pruned the entry
away, and is withheld while the filter query is long enough to filter
(`MIN_FILTER_QUERY_LENGTH`) since the row then shows the filter hint. The
reveal uses the shared duration-pinned scroll animation
(`smooth-scroll.ts`), because the UA's native smooth scroll scales duration
with distance (a long jump measured ~1,506ms against a ~300ms budget).
Rendering is gated on `activePath.startsWith("api/")`, excluding the `/api/`
overview root (which has no entry to reveal). The control carries a 24px box
inside the 18px row via 3px padding offset by a `-3px` block margin
(footprint stays 18px), meeting WCAG 2.5.8's 24px minimum; the 44px floor
`test/responsive.test.ts` sets for drawer/nav controls cannot be honored
here without reinstating the route-dependent height difference, and the
control is outside that test's enumerated selectors.

### Client-side favorite pages

Starred pages persist in `localStorage` under `cdk-docs:favourites` as a
JSON array of `{ path, title }`, paths stored base-stripped and without
`.html` so they survive base-path or clean-URL changes, capped at 20;
corrupt or oversized data is discarded, never thrown. The store
(add/remove/toggle/subscribe) lives in
`docs/.vitepress/theme/favorites.ts` with an injectable storage backend
(dependency-free, unit-testable without a DOM). Two Vue components mount
through layout slots: `FavoriteStar.vue` (the per-page toggle) and
`FavoritesList.vue` (`sidebar-nav-before`, the quick-access section atop the
API sidebar). Both read state in `onMounted` so static markup never
mismatches hydration. A `storage` event listener syncs across tabs. The
store is exposed as `window.__cdkDocsFavorites` as a stable, documented
integration point for the navbar type-ahead; search result boosting is
best-effort and degrades to plain relevance order
([search and filter](./2026-10-15-search-and-filter.md)).

The Favorites section header is a real `<button>` disclosure
(`aria-expanded`/`aria-controls`, reusing the tree caret) and defaults to
**collapsed** so it does not displace the primary navigation before the
reader asks for it; the count stays on the header (`★ Favorites (2)`) to
keep the feature discoverable. The collapse flag gets its own key
`cdk-docs:favourites:collapsed` rather than widening the array to an object
(no on-disk migration); the read is `!== "false"`, so anything
absent/corrupt/foreign reads as collapsed. Entries stay in the DOM while
collapsed (`v-show`), and the section renders nothing with zero favorites.

## Consequences

- Readers navigate by AWS service and CDK framework feature; package layout
  and `interfaces.*`/`*.mixins` structural submodules are invisible in the
  nav. Service name changes require a curated display entry and a pinned
  output test; the resource-stem heuristic still fails readable rather than wrong.
- Per-page HTML is the shallow "Overview" baseline; the tree is session-
  cached assets fetched incrementally, so build time, artifact size,
  cold-load transfer, and rendered DOM are all bounded independent of page
  count. The sidebar beyond "Overview" requires JavaScript — acceptable for
  this SPA.
- Native VitePress behavior is retained: SPA navigation, active-state,
  mobile drawer, and light/dark theming inherited from the CDK brand theme
  ([brand theme and icons](./2026-10-15-brand-theme-and-icons.md)).
- Per-language sidebar assets are emitted per [multi-language](./2026-10-15-multi-language.md).
- Reader state is per-browser and client-side: favorites and collapse
  choices in `localStorage`, scroll position in `sessionStorage`, no consent
  surface needed. The two sidebar stores differ deliberately (durable
  disclosure vs ephemeral scroll).
- Interactive behavior is covered by `test/e2e/` specs per repository
  convention ([repository conventions](./2026-10-15-repository-conventions.md)), since Jest never loads
  the rendered site. If VitePress renames `.VPSidebar`, scroll-restore and
  jump-scroll degrade silently and the e2e specs catch it.
- New content types (guides, tutorials) are added as sibling top-level
  groups in the VitePress config without touching the generated structure.
