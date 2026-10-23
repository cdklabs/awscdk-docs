# Search and Filter

## Status

Accepted

## Context

The site needs two complementary ways to find things across hundreds of CDK
modules and tens of thousands of API pages: full-text search over page prose,
and a fast "jump to a known symbol" filter. Both must be fully static — no
external service, no backend, no per-keystroke network round-trip — because the
site is served from static hosting (see
[publishing-and-hosting](./2026-10-15-publishing-and-hosting.md)).

These are different workflows and are kept separate: full-text search answers
"which pages are *about* this term", while the symbol filter answers "take me to
`s3.Bucket`". Conflating them buries the canonical page under thousands of
incidental type-cell mentions, so each is tuned for its own job and the two
coexist.

## Decision

### Full-text search: Pagefind

Full-text search uses **Pagefind**, integrated via `vitepress-plugin-pagefind`
(both declared as dev dependencies in `.projenrc.ts`). `pagefindPlugin()` is
registered in the VitePress config's `vite.plugins`; it runs the Pagefind
indexer over the rendered output after the build and replaces the default navbar
search UI. The built-in VitePress local search (MiniSearch) is not configured.

Pagefind indexes the built site into sharded static files, so a query downloads
only small index fragments on demand rather than one monolithic in-memory index.
This keeps search fast and bandwidth low as the API surface grows, and the output
is plain static files.

- *Rejected alternatives:* MiniSearch (single monolithic index does not scale to
  an API reference of this size); Algolia DocSearch (hosted external service,
  ruled out by the local-only constraint).

### Index relevance (docgen, `src/docgen/search.ts`)

The plugin marks the whole rendered article as `data-pagefind-body`, so without
intervention every type cell, signature, facts table, and cross-reference list
is indexed and `bucket` matches thousands of pages that merely *mention* a
bucket. Docgen counters this:

- Wrap generated boilerplate in `data-pagefind-ignore` (via `ignoreBlock`):
  property type cells, facts/metadata tables, signatures, the type-hierarchy
  block (including a struct's "used as props by" row), and cross-reference lists
  ("Referenced by"). Property names stay indexable inside their existing
  type-page entry, matching method names without creating per-member results;
  property types and descriptions stay ignored so they cannot add incidental
  matches. Symbol *lookup* is the type-ahead filter's job. This also shrinks the
  index.
- Weight the H1 symbol name with `data-pagefind-weight="10"` (via
  `weightedTitle`) so an exact title match ranks decisively first (Pagefind's
  default h1 weight is 7).
- Emit hidden `data-pagefind-filter` spans `module:<slug>` and
  `kind:<construct|class|struct|interface|enum|mixin|facade|trait>` on every API
  page (`searchModule`, `searchKind`, `searchFilterHtml`). The module slug is the
  submodule slug when present else the assembly slug, lowercase with hyphens,
  matching the URL; the kind is coarse and lowercase.
- A root `pagefind.yml` carries `div.aside`/`a.header-anchor` exclude selectors
  so the CI post-merge `npx pagefind` run matches the plugin's own flags.

### Query filters and warm-up (theme, `search-client.ts`)

The plugin's search UI always passes empty Pagefind options, so filters and
ranking are applied by wrapping the `window.__pagefind__` handle rather than
forking the UI:

- `withQueryFilters()` parses `module:` / `kind:` tokens out of the query text
  (`parseSearchQuery`; recognized keys only — unknown keys and empty values stay
  in the text) and forwards them as real Pagefind `filters`. A token-only query
  searches with `null` text, which Pagefind treats as "all pages matching the
  filters".
- A `module:` value is forgiving, because the index stores the slug
  (`aws-s3`) while the sidebar and import paths show `aws_s3`. The typed value
  is normalized (lowercase, `_` and `/` to `-`, leading `@` dropped) and
  resolved against the module list the engine reports through `filters()`,
  read once per handle: a value equal to a known module selects that module
  only; otherwise every known module whose hyphen-separated words contain the
  typed words in order, each as a prefix, is selected and passed as an any-of
  filter (`module:s3` selects `aws-s3`, `aws-s3-assets`, `aws-s3-deployment`,
  `aws-s3-notifications`, `aws-s3tables-alpha`). A value that selects no
  module answers empty without a search. `kind:` stays an exact match. When a
  module value matches nothing, or the selection returns no results, a hint
  under the result list names up to five close modules (containing matches
  first, then by edit distance). The syntax stays typed; there is no dropdown.
  `withQueryFilters()` also keeps only the first 50 ranked candidates before
  another wrapper can call each result's `data()`. The favorites wrapper reorders that
  bounded pool, then returns 20 display results; without favorites it returns the
  first 20 directly, so broad queries load 20 fragments instead of every match.
  The search heading says `Top 20 results` rather than implying the capped count
  is the total match count. This wrap composes with the favorites-boost property
  trap on the same handle.
- `warmSearchIndex()` imports and `init()`s Pagefind immediately on client mount
  instead of waiting for the plugin's `requestIdleCallback`, so the first query
  after a cold page load hits a warm engine. A `<link rel="modulepreload">` in
  the head warms the module fetch, and the warm-up reads that link's href so a
  based build (e.g. `/cdk-docs/`) resolves the real path instead of 404ing.
  Import failure on the dev server (no built index) is swallowed.
- Ranking is tuned at search time via `pagefind.options({ ranking: SEARCH_RANKING })`
  before `init()`, where `SEARCH_RANKING = { termSimilarity: 3.0,
  termFrequency: 0.4, termSaturation: 1.2 }`: for reference docs, defining a term
  once beats mentioning it often. Ranking is not an index-time option (no
  `ranking` key in `pagefind.yml`), so it must be set on the loaded module in the
  browser.

### Canonical-language indexing (docgen, `src/docgen/variants.ts`)

Every symbol page embeds language-variant regions (signatures, member names,
code examples) for every enabled language in the DOM, toggled client-side (see
[multi-language](./2026-10-15-multi-language.md)). CSS-hidden variants are still
index-visible, so without care a symbol would be indexed once per language with
near-identical transliterated spellings, multiplying both index size and noise.

Pagefind indexes **only the canonical language's variant** of each region: the
variant emitters stamp `data-pagefind-ignore` on every `.lang-variant` whose
language is not canonical. The canonical language is the site default
(TypeScript) when enabled, else the first enabled language in canonical display
order (`canonicalLanguage()`). This agrees with the canonical URL slugs and
heading anchors, so search results surface canonical identifiers for every
reader regardless of their active language, and with one enabled language the
emitters produce bare canonical output with no wrapper or ignore attribute.

### Symbol type-ahead filter

A client-side filter matches constructs, classes, interfaces, enums, mixins,
facades, and traits by name and navigates straight to the API page:

- **Build-time symbol index.** `buildSymbolIndex` flattens the same
  `SidebarEntry` data that feeds the service sidebar into a content-hashed static
  asset (`api-sidebar/symbols.<hash>.js`), fetched once, lazily on first focus of
  the filter input. Each entry carries `name`, `kind`, `link`, `service`, an
  optional `experimental: true` flag (set from the jsii `docs.stability`, present
  only for alpha modules), and an optional construct `level` (`L1`/`L2`/`L3`,
  carried through from the sidebar entry — see
  [sidebar-navigation](./2026-10-15-sidebar-navigation.md)). Types without a
  dedicated page fall back to their (sub)module type table so every result is
  navigable.
- **Component placement.** `NavFilter.vue` is injected at the top of the sidebar
  via the default theme's `sidebar-nav-before` slot, above the favorites list and
  the API nav tree it filters. It is a sidebar navigation aid, so it follows the
  sidebar's own responsive behavior (wide viewports and the mobile drawer) and
  leaves the Pagefind navbar search untouched.
- **Pure, testable matching.** Matching and ranking live framework-free in
  `filterSymbols.ts` (symbol index, Enter-to-jump) and `api-sidebar.ts`
  (`filterSidebarTree`, in-place tree pruning), unit-tested with Jest and sharing
  one case-insensitive algorithm.

### In-sidebar filtering, no popup

Typing in the filter narrows the API sidebar tree in place rather than opening a
floating listbox:

- `NavFilter.vue` publishes its query into a module-level Vue ref
  (`sidebarFilterQuery` in `sidebar-filter.ts`) that `ApiSidebar.vue` consumes. A
  tiny shared ref is preferred over an event bus or provide/inject because both
  components live in one client app with exactly one filter input.
- A minimum query length gates action: `MIN_FILTER_QUERY_LENGTH = 2` and
  `isFilterActive()`. A shorter query behaves exactly like an empty one — no
  narrowing, no Enter target, no hint.
- `filterSidebarTree` prunes (never mutates) the loaded tree: a node whose path
  satisfies every term keeps its whole subtree, a group survives only if a
  descendant does. While filtering, surviving groups render force-expanded and
  caret clicks are ignored; the user's own expansion state is never written, so
  clearing the input restores the exact pre-filter sidebar.
- **Enter-to-jump** navigates to the best-ranked `filterSymbols` match from the
  lazily fetched index, with an inline `aria-live` hint naming the target while
  typing; Escape clears. On non-`/api/` pages the sidebar does not render but
  Enter-to-jump still works, so the input is not dead weight.
- The input is a plain labeled text field plus a polite live region — no
  `role="combobox"`/`role="listbox"` overlay. Colors use VitePress theme
  variables so the brand theme applies in both modes.

### AND-based multi-term matching with qualifiers

The query is tokenized once by `splitTerms` (lowercase, whitespace-split,
collapsing repeats) and terms combine with **AND**, order-independent: every term
must match for an entry to survive. A blank/short query means "not filtering".

- **Rank tiers** (lower is better), summed per term so more precise matches sort
  first: name prefix (0), word-boundary — camelCase or `.`/`_` segment start (1),
  substring (2), and context/qualifier (3). Ties break stable-before-alpha, then
  shorter name, then alphabetically, then index order. So `function` opens the
  `aws-cdk-lib` `Function`, while naming the alpha symbol more precisely still
  reaches it.
- **Service as a qualifier.** A term may be satisfied by the entry's `service`
  label (admitting all of a service's symbols for `s3`), but a service match
  *qualifies the area* rather than identifying the symbol: it costs nothing once
  some other term matches the name, and only when no term matches the name does
  every qualifier pay the context rank. So `s3 bucket` ranks `Bucket` (S3) ahead
  of an `S3BucketOrigin` whose bare name happens to carry both terms. This mirrors
  how `filterSidebarTree` consumes an ancestor match for a whole subtree, keeping
  the two surfaces consistent.
- **Construct level terms.** `l1`, `l2`, `l3` (case-insensitive) form a fixed
  three-term vocabulary — no `level:` prefix, no general field grammar. A level
  term is satisfied **only** by the entry's `level`, never by the name or
  service, so `Layer1` does not answer `l1` and an entry with no level (every
  interface, struct, enum, mixin, facade, trait) can never match one. A level term
  ranks as a qualifier on the same rule as service, so `l2 bucket` ranks by
  `bucket` alone among L2 constructs and a bare `l2` puts every L2 construct at one
  rank. This applies to the type-ahead/Enter-to-jump only: `filterSidebarTree`
  matches on node text alone, so `l2` resolves a jump target while pruning the
  visible tree to nothing.

## Consequences

- Search scales with site size and stays local-only: no external service, no
  telemetry. The index is built from rendered output, so dev-mode search reflects
  the last build rather than live edits.
- `bucket` matches pages whose prose/title concern buckets and `aws-s3.Bucket`
  ranks near the top; queries are scopable by `module:`/`kind:` without any filter
  dropdown UI. The `module:`/`kind:` token syntax and the `l1`/`l2`/`l3`
  vocabulary are bespoke and documented in the placeholder; a native dropdown
  would require forking the plugin's Search.vue and is out of scope.
- Property/parameter *names* are no longer full-text searchable — the type-ahead
  filter and on-page Ctrl+F cover that lookup. If too aggressive, individual
  sections can be re-included by dropping their `ignoreBlock` wrapper.
- Pagefind index size and result counts stay flat as languages are enabled; a
  transliterated spelling (`add_to_resource_policy`) does not match full-text
  search, but the canonical spelling and type names (the dominant need) always do.
- The symbol index is one extra content-hashed asset per build (gitignored like
  the rest of the generated docs), fetched only after user intent. It grows with
  the documented API surface and by one short `level` field per leveled construct.
- The type-ahead and full-text search remain complementary, not redundant: the
  filter matches symbol names, Pagefind matches prose.
- Typing a level term (`l2`) jumps on Enter but empties the visible sidebar,
  because the tree still matches on text — the honest cost of not widening the
  shared tree predicate here. Whether the tree should become level-aware is a
  separate question. A future full-FQN match key would retire the service
  fallback (and its qualifier rule) but not the level term, since a level is not
  part of an FQN.
