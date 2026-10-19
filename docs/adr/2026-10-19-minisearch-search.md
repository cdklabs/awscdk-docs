# Site Search with MiniSearch

## Status

Accepted

Supersedes the full-text search sections of
[search and filter](./2026-10-15-search-and-filter.md). The symbol type-ahead
filter described there is unchanged.

## Context

The published site is served under a Content Security Policy set by the host,
not by this repository. Its `script-src` allows neither `'wasm-unsafe-eval'` nor
`'unsafe-eval'`, so `WebAssembly.instantiate()` throws a `CompileError` in the
browser. Pagefind, the search engine the site shipped until now, runs its engine
as a WebAssembly module and has no JavaScript fallback, so search never loaded
in production. A page cannot relax a header policy from inside the page, and the
header is outside this repository's control, so no in-repo change could make
Pagefind run.

The earlier decision rejected MiniSearch because a single monolithic index does
not scale to an API reference of this size. That objection assumed the index
would carry full page bodies, as Pagefind's did. It does not have to.

## Decision

### Engine: MiniSearch, plain JavaScript

Site search uses **MiniSearch** (`minisearch`, a production dependency declared
in `.projenrc.ts`). It runs entirely as JavaScript in the browser, so it works
under the host policy as served today and needs no change to the policy, the
hosting or the publish path. No WebAssembly is loaded anywhere in the site.

Pagefind is removed completely: the `pagefind` and `vitepress-plugin-pagefind`
packages, `pagefind.yml`, the post-merge indexing step in
`scripts/local-shard-build.sh`, the `pagefind/` directory check in
`scripts/verify-site.sh`, the module preload in the VitePress `head`, and every
`data-pagefind-*` attribute and hidden filter span docgen emitted into the
pages. The variant and cross-reference wrappers that existed only to exclude
markup from the Pagefind index are gone with it; the initializer fences keep a
plain `initializer-variants` container because the responsive stylesheet targets
it.

### Index: one static JSON asset from docgen, summaries not bodies

Docgen writes `docs/public/search/index.<hash>.json` alongside the sidebar
assets, with one entry per API page — type pages and module and submodule
overviews — carrying the page's title, coarse kind (`construct`, `class`,
`struct`, `interface`, `enum`, `mixin`, `facade`, `trait`, or `module`), module
slug, link and a one-paragraph plain-text summary truncated to 240 characters
(`src/docgen/search.ts`). That is what keeps a single index viable at ~23k pages:
a few megabytes uncompressed and about one megabyte over the wire, fetched once
per session and only after the reader opens the search.

Full page bodies are deliberately not indexed. Type cells, signatures and
cross-reference lists were what made `bucket` match thousands of pages that
merely mention a bucket under Pagefind, and they needed a web of exclusion
markup to tame. Indexing titles and summaries answers "which pages are *about*
this term" directly. Property and parameter names are found through the
type-ahead symbol filter and on-page find, as before.

The asset is content-hashed like the sidebar assets; `config.mts` discovers the
file name at config time and passes it to the theme as `themeConfig.searchAsset`.
Docgen runs once before the sharded build, so every shard carries the same
asset and the merge step needs no indexing pass.

### Client: the theme's own dialog in the navbar slot

`docs/.vitepress/theme/SearchBox.vue` is aliased over VitePress's
`VPNavBarSearch.vue` through `vite.resolve.alias` in `config.mts` — the same
substitution the Pagefind plugin performed — so it occupies the `.search`
region the navbar layout already centers, without configuring a
`themeConfig.search` provider. The trigger opens a modal dialog (Ctrl+K / Cmd+K
too); `search-client.ts` fetches the index on first open, builds the MiniSearch
index client-side and caches it for the session.

Ranking is tuned for an API reference: field boosts weight the title far above
the summary and the module slug a little, a page whose title *is* the query term
outranks pages whose title merely extends it, prefix and light fuzzy matching are
on, and terms combine with AND. The tokenizer splits camelCase identifiers so
`PythonFunction` is found by `function` while the whole identifier stays a token
of its own. The `module:` / `kind:` query tokens are kept and now filter on the
index entries' fields; a token-only query lists every matching page by title.
Starred pages sort first among the results.

The e2e suite drives the dialog in a real browser, including the assertion that
no `.wasm` request is made and no WebAssembly or policy error reaches the console.

## Consequences

- Search works on the production host under its existing policy, and would keep
  working under a stricter one: nothing in the site needs `eval` or WebAssembly.
- One asset of a few megabytes is fetched on the first search of a session; the
  first query then takes the time MiniSearch needs to index ~23k short entries
  in the browser (well under a second on current hardware). Later queries are
  instant. Readers who never open the search download nothing.
- Prose inside page bodies and READMEs beyond the first paragraph is not
  searchable. A term that appears only deep in a README finds the module page
  only if it is also in the title or the opening paragraph.
- Docgen owns the index, so anything it emits is testable in Jest without a
  built site, and the index cannot drift from the pages it was emitted with.
- The review skills that named Pagefind boundaries (`data-pagefind-ignore`) and
  the per-shard indexing gate are updated to the new index: the search-relevant
  question for a docgen change is now whether a page's title, kind, module or
  summary changed, not where an exclusion attribute moved.
