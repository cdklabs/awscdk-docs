# Site Generator and Build

## Status

Accepted

## Context

The CDK API reference is a large static site — ~21k pages across the
`aws-cdk-lib` services plus hand-written pages — published as a versioned zip. It
must render multi-language code examples, support fast client-side search, and
stay cheap to build and contribute to. Two forces shape every decision here:
the generator choice drives authoring and client experience, and the sheer page
count makes the production build a memory and wall-clock problem that a single
ordinary process cannot solve.

## Decision

### Static site generator: VitePress

Use VitePress (Vue/Vite). It gives first-class tabbed code groups for the
TypeScript/Python/Java/C#/Go examples, a Vite build pipeline fast enough for
thousands of pages, lightweight per-page output, and Vue components in Markdown
for custom API rendering. Source root is `docs/`; config is
`docs/.vitepress/config.mts`. Contributors need Node.js 18+ and Vue 3.x.

### SPA rendering, not MPA

Keep VitePress's default SPA mode. Do not set `mpa: true`. SPA ships a shared,
cached runtime (~75 KB gzip once: page chunk + Vue runtime/router + theme) and
then does client-side navigation fetching only the next page's lean chunk.
`mpa: true` would drop that one-time JS but make every navigation a full reload
and render all interactive theme features as inert dead markup — the type-ahead
filter, language switcher, favorites, feedback widget, type tooltips, and
Pagefind search UI all require client hydration. The trade (saving one-time
cacheable JS at the cost of every interactive feature and instant navigation)
is not worth it. Navigation-feel is a performance-tuning concern (prefetch,
payload trimming), not a rendering-mode one.

- Rejected alternative: per-page islands opt-in would require rewriting the
  entire theme layer as inlined `<script client>` islands; revisit only if
  VitePress ships stable per-component hydration.

### Sharded production build

The full SPA build holds Rollup's entire per-page chunk graph in memory at once;
that graph is superlinear (~n^1.3) in chunk count, so the full site needs ~30 GB
and OOMs every standard CI runner. Raising the heap ceiling is a dead end.
Instead, build the site in parallel disjoint **shards** and merge the dist
trees, so no single process holds the whole graph.

- **Prune per shard** (`scripts/shard-prune.cjs`). Each shard keeps only its
  assigned slice of generated pages and deletes the rest; the `constructs`
  module, hand-written pages, and the complete `sidebar`/`symbols`/
  `type-summaries` assets stay intact in every shard so each builds a valid
  site. Shards are disjoint and their union is the full page set.
- **Balance by page count (LPT), not service count.** CDK services are wildly
  unequal in size, so round-robin-by-name produced badly lopsided shards.
  `assignShards` sorts prune units by page count descending (name as tie-break)
  and greedily assigns each to the least-loaded shard — longest-processing-time
  bin-packing, within 4/3 of optimal makespan. Units larger than the ideal mean
  (`ceil(totalPages / SHARD_TOTAL)`) are first split into near-equal contiguous
  sub-units (`splitOversized`) so no single oversized service pins the floor.
  The plan is a pure function of the generated tree and `SHARD_TOTAL`, so every
  shard job computes it independently — no coordination file.
- **Skip per-shard Pagefind.** A shard renders only a subset of pages, so
  per-shard indexing would be partial. `SHARD_BUILD=1` no-ops the plugin's
  indexing command (keeping `virtual:pagefind` resolvable); indexing runs once
  post-merge. See [search and filter](./2026-10-15-search-and-filter.md).
- **Merge** (`scripts/merge-shards.cjs`). Shared theme/framework chunks are
  content-hashed and byte-identical across shards; per-page chunks and HTML are
  disjoint, so the overlay is clean. Critically, every shard's `hashmap.json` is
  **unioned** into one complete file, because the client router fetches
  `hashmap.json` at load to resolve lazy chunks for cross-shard navigation.
  Shard sitemaps are unioned the same way.
- **Verify the deploy contract** (`scripts/verify-site.sh`, run at the end of
  every full build). The merged tree must contain `index.html`,
  `hashmap.json`, and `pagefind/`, carry nothing but the hosted-path root at the
  artifact root, and hold **at least 20,000 HTML pages** — a render worker can
  OOM without failing its exit code, so the floor catches dropped pages. The
  guard runs only after every shard succeeded.

The merge relies on shared chunks staying byte-identical across shards, which
holds because every shard builds from the same theme/config and only the route
set differs. A change that made a shared chunk depend on the full route set
would break that assumption.

### One-machine sharded build

`scripts/local-shard-build.sh` (projen task `docs:build:sharded`) produces the
complete site from one invocation — for local inspection, CI, and the aws-cdk
release pipeline, none of which have a CI build matrix. It runs `docs:generate`
once, then gives each shard a scratch workspace under a per-run temp dir
(`$TMPDIR/cdk-docs-shards/run.XXXXXX`) holding a copy-on-write copy of `docs/`
plus symlinks to `node_modules`, `src`, `scripts`, `package.json`, and the
version snapshot — so the in-place prune cannot clobber other shards. Shards run
in parallel via `xargs -P` (portable to the macOS bash 3.2 baseline).

- `--num-shards N` sets the total (default: CPU cores − 2); `--concurrency`
  caps simultaneous builds; `--heap` sets the per-shard old-space cap (unset
  means Node's memory-scaled default). The plan is a pure function of the total,
  so any count merges to the complete site; memory-tight hosts raise the total
  and cap concurrency rather than lower the total.
- `--shard I/T` builds exactly one shard for debugging (incompatible with
  `--num-shards`).
- `--base` (or `DOCS_BASE`) is the only hosting knob; everything derives from it
  via `site-paths.cjs`. The script reads no GitHub Actions context. See
  [publishing and hosting](./2026-10-15-publishing-and-hosting.md).
- Successful workspaces are deleted; failed ones are kept with their logs.
  Output lands at `docs/.vitepress/dist` (under the hosted path when
  `DOCS_BASE` is set), previewable with `docs:preview`.

Local `docs:build` remains the single-shot path for development.

### Extract page metadata into a shared chunk

Set `metaChunk: true`. By default VitePress inlines the entire site hashmap plus
site data (~500 KB) into every page's HTML — ~87% of a rendered page — which
pushed the site artifact past 1 GB. `metaChunk: true`
writes that metadata once to a content-hashed
`assets/chunks/metadata.<hash>.js` referenced via `<script src>`, so per-page
HTML drops to its real rendered size and the chunk is fetched once and cached.
It composes with sharding: each shard emits its own hashed metadata chunk (they
overlay cleanly), and navigation correctness still comes from the unioned
`hashmap.json`.

### Memoized dual-theme syntax highlighting

Highlighting runs through a custom `markdown.highlight` hook, required because
VitePress only builds its default Oniguruma highlighter when the hook is unset.
Use a single Shiki highlighter on the **JavaScript regex engine** (not the
Oniguruma WASM engine, whose heap lives outside V8's `--max-old-space-size` cap
and can OOM the shard off-heap), with a dual `github-light`/`github-dark` theme
(`defaultColor: false`, emitting `--shiki-light`/`--shiki-dark` CSS vars) so code
blocks follow the site light/dark toggle. Only the languages docgen emits are
loaded, so Shiki skips its full grammar set.

The hook memoizes output in a per-process `Map` keyed on
`` `${language}\u0000${code}` `` — the resolved language (loaded lang, else the
`txt` fallback) and the **exact, non-normalized** code string (a trailing
newline changes the emitted tokens, so it must not be collapsed; the NUL
separator can never appear in a language id). Generated docs repeat identical
fences (imports, `declare const` stubs, escape-hatch pairs) heavily, so a hit
returns byte-identical HTML. Type links are applied per call *after* the cache,
because two pages can share the same signature text with different link targets.
The cache lives for one shard's build and captures all its intra-shard repeats.

- Rejected alternative: single-pass dual-color highlighting would beat the ~2×
  cost of tokenizing twice, but Shiki exposes no safe path (its token carries a
  resolved color, not the scopes needed to re-color), and reimplementing its
  theme resolver risks a light/dark parity regression. A single CSS-variables
  theme would regress away from github-light/dark.

### Build-time efficiency: cache parses, skip redundant work

- **Memoize jsii assembly parsing** in `src/docgen` (`loadAssembly`,
  per-process cache keyed by resolved assembly dir). Parsing the compressed
  `aws-cdk-lib` assembly costs ~1 s per call and docgen never mutates the parsed
  spec, so repeated `generateDocs` calls in one process (Jest workers, watch
  mode) share one parse. Test suites that parsed the assembly directly delegate
  to this loader; `docgen.test.ts` shares one `generateDocs` run in `beforeAll`.
- **Transpile-only runtime** (`tsx`) for `docs:generate`/`docs:baseline`: types
  are already checked by `compile` (tsc) and eslint, so a run-time type-check
  would only add startup latency. Type errors in `src/docgen` no longer fail
  `docs:generate` directly but are still caught by `npx projen build`, which CI
  runs first.
- **`vite.build.reportCompressedSize: false`**: Vite gzips every emitted asset
  only to log its compressed size — pure waste across ~21k pages.

### Compile existence gates into the bundle

A value that decides whether a control **exists** must be compiled into the
bundle through module resolution, which fails the build on a missing input and
can never silently degrade. A value that only decides what a control
**displays** may travel on `themeConfig` or an HTML stamp, because its failure
path is visible on the page (see
[versions and history](./2026-10-15-versions-and-history.md)).

The language toggle's gate is the live case:
`docs/.vitepress/theme/enabled-languages.ts` imports `languages` from
`docgen.config.json` as a JSON import, so Vite substitutes the value at build
time and tree-shakes the rest. A config missing the `languages` key, or a build
layout that does not carry the file, fails the build rather than defaulting the
gate off — which is exactly the shard-workspace gap that once silently shipped a
one-language site (the sharded workspace must link `docgen.config.json` among
its roots). The language vocabulary lives in a DOM-free `languages-core.ts` so
Node tests can load the gate without touching `window`. See
[multi-language](./2026-10-15-multi-language.md).

## Consequences

- The deploy build no longer OOMs: each shard bundles a bounded graph, shards
  run in parallel, and the heaviest-shard wall time and peak memory drop sharply
  versus a single ~30 GB build. Re-enabling more languages means more shards,
  not a bigger process.
- Shard-to-service mapping is build-internal and not stable as content grows; a
  service may move shards between commits, and nothing depends on that mapping.
- `metaChunk` keeps the site artifact well under 1 GB; future growth is bounded
  by actual content, not by metadata copied per page. One extra cached request
  for the metadata chunk on first load.
- SPA keeps the full interactive theme and instant client-side navigation; the
  `enhanceApp`/layout-slot architecture stays valid.
- The highlight cache and build-time memoizations change no output: emitted
  markup, page count, sidebar structure, and search index are byte-for-byte
  unchanged.
- The existence-gate pattern guarantees dev and deployed builds agree by
  construction; changing enabled languages requires a rebuild (always true in
  substance). An audit found no other existence-gating `themeConfig` consumer.
- The workspace copy assumes the generated tree fits on disk once per concurrent
  shard; copy-on-write makes this near-free on APFS, a real cost elsewhere.
