# Version the runtime-fetched JSON indexes per build

## Status
Accepted

## Context
The site is built in shards with `metaChunk: true`, so each page's metadata chunk carries the page-to-chunk-hash map
for its own shard only. A link into another shard misses that map, and the VitePress router falls back to fetching
`<base>hashmap.json`, replaces its in-memory map with the response, and retries once. The merge step unions every
shard's `hashmap.json`, so this file is the only complete map and is on the path of most client-side navigation.

`hashmap.json` has a fixed, unhashed name, and the hosting serves `.json` with a one-day `max-age`. A browser that
cached the file before a deploy keeps answering the fetch with the old map. Its chunk hashes no longer exist, so the
retried page 404s, and because the stale map replaced the in-memory one, every later navigation 404s too until a full
reload brings a fresh metadata chunk.

The file cannot carry a content hash in its name: the router fetches a hard-coded path, and upstream relies on that
path staying fixed so a page left open across a deploy can still find the new map.

The hover-tooltip lookup, `type-summaries.json`, had the same fixed name and the same one-day cache. A stale copy
leaves types added since the cached copy without a tooltip and shows outdated summaries. Unlike `hashmap.json`, it
is only fetched by this site's own theme code, which can be told any name.

## Decision
A Vite plugin (`docs/.vitepress/hashmap-cache-buster.ts`) rewrites the router's fetch to
`hashmap.json?v=<build id>` during the build. The build id is `DOCS_BUILD_ID` when set, otherwise the checked-out
commit. `scripts/local-shard-build.sh` resolves it once and exports it, because every shard must bake the same value
into the shared router chunk and the shard workspaces are not git checkouts. A shard build without an id fails, and
the plugin fails the build if the router is not transformed, so a VitePress upgrade that moves the fetch cannot
silently drop the buster.

The type-summary lookup moves to `api-sidebar/type-summaries.<hash>.js`, named by its own content like the sidebar
skeleton and the symbol index beside it. The VitePress config reads the hashed name off the generated directory and
passes it through `themeConfig.typeSummariesAsset`, and the tooltip code fetches that name. Every shard generates the
identical file, so all shards agree on the name.

## Consequences
- A deploy changes the `hashmap.json` query, so a cached map from an earlier deploy is never reused. Builds of the same
  commit share a URL, which is correct because they produce the same map.
- The file and its unhashed URL stay in place, so the upstream new-deploy retry still works for pages loaded before
  this change.
- A page left open across a deploy runs the old router and asks for the old query. This only matters if the hosting
  keeps serving that URL from cache; the upstream retry has the same limitation.
- The plugin depends on the exact fetch expression in VitePress's `client/app/router.js`, pinned by a unit test
  against the installed version.
- The type-summary lookup only gets a new URL when its content changes, so its roughly 5 MB is not re-downloaded for
  releases that do not touch it, and it could be cached as immutable. It is served with a `.js` extension like the
  other api-sidebar assets, so the hosting applies the TTL it gives scripts.
