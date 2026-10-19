# Performance rules: the lookup

Rows are grouped by family: build, page weight, client assets, search, measurement. See the
`cdk-docs-review-principles` skill for the shared lookup convention. This dimension has fewer rows drawn
from past reviews than the others, so more rows carry `(doc-absent detail)` calibration.

## Build

**[PERF-BUILD-ARTIFACT-LIMIT] (BLOCKING)**: A change that pushes the built artifact toward a hard limit.
`docs/.vitepress/config.mts` records that inlining metadata into every page "pushed the Pages artifact over
GitHub Pages' 1GB limit", which is why `metaChunk: true` exists. Anything added to every page's HTML is
multiplied by ~21k.

- **Detection method (doc-absent detail):** measure the per-page byte delta on a median fixture page and
  multiply by the page count; state both numbers.

**[PERF-BUILD-SHARD-SEARCH] (BLOCKING)**: A search indexing pass added to the per-shard or merge steps. The
search index is one JSON asset docgen writes once before the shards; nothing in the build should index pages
again.

**[PERF-BUILD-PER-PAGE-WORK] (RECOMMENDED)**: New work inside a per-page loop (docgen render, `transformHtml`,
a VitePress hook) that recomputes something constant across pages: re-reading a file, re-parsing the
assembly, re-building an index. Hoist it and cache per `TypeIndex` as the existing resolvers do. Up-tier
BLOCKING when it threatens the shard job timeout or memory.

**[PERF-BUILD-SHARD-BALANCE] (RECOMMENDED)**: A change to shard assignment, or one that concentrates new
pages in one module, without checking balance. The site-generator ADR: shards are assigned greedily by
size because "round-robin-by-name produced badly lopsided shards." The slowest shard sets wall time.

## Page weight

**[PERF-PAGE-UNBOUNDED-DOM] (BLOCKING)**: Markup whose size scales with corpus relations and has no bound:
listing every subclass, implementor or member reference inline. `constructs.Construct` has 2,332
descendants. The api-reference-pages ADR bounds relation rows with a build-time budget
(`RELATION_ROW_BUDGET` in `src/docgen/layout.ts`) and a lossless `<details>` remainder, not a CSS clamp.

- **Detection method (doc-absent detail):** find the largest real instance of the new structure, not the
  fixture's, and count the elements it emits.

**[PERF-PAGE-BUDGET-RETUNED] (RECOMMENDED)**: A build-time budget constant changed without the measurement
that justifies it. The ADR records `RELATION_ROW_BUDGET = 70` as "tuned by measurement"; a new value
needs a new measurement, and the ADR updated (`GEN-CLAIM-STALE-ADR`).

**[PERF-PAGE-DUPLICATED-PAYLOAD] (RECOMMENDED)**: Data or markup emitted into every page that the client
could fetch once (a shared lookup inlined per page, an icon SVG repeated per row). Move it to a shared,
content-hashed asset.

## Client assets

**[PERF-CLIENT-BUDGET] (BLOCKING)**: The combined gzipped JS+CSS per audited page exceeds 400KB, or the
Performance score drops below 90 (quality-gates ADR, `lighthouse.config.json` `minScore: 0.9`). The
`docs:lighthouse` check reports it; your finding adds which import or rule caused it.

**[PERF-CLIENT-EAGER-IMPORT] (RECOMMENDED)**: A theme component imports a large module or data file
eagerly when it is needed only after interaction (search, tooltips, the API sidebar). Use a dynamic import
or the lazy fetch pattern the sidebar uses.

**[PERF-CLIENT-RENDER-BLOCKING] (RECOMMENDED)**: A new synchronous script or stylesheet in `head`, or a
font without `font-display`. Existing inline bootstraps (appearance, code theme) exist to prevent a flash;
a new one needs the same justification.

**[PERF-CLIENT-SHARED-CHUNK-BLOAT] (RECOMMENDED)**: Code placed in a module every page loads when only
API pages need it. (doc-absent detail) Check the built chunk graph, not the import site.

## Search

**[PERF-SEARCH-INDEX-GROWTH] (RECOMMENDED)**: New fields, longer summaries or extra entries per page added to
the search index (`src/docgen/search.ts`) that grow the JSON asset every reader downloads on first search. The
asset carries one short entry per page; raising `SUMMARY_MAX_CHARS` or indexing page bodies needs a measured
size before and after. Removing real content from the index is the agent-support dimension's concern, not
this one.

## Measurement

**[PERF-MEAS-GATE-WEAKENED] (BLOCKING)**: A change that lowers `minScore`, raises the byte budget, reduces
`numberOfRuns`, drops an audited URL, or lets a `null` score or a non-200 page pass. The quality-gates ADR
lists each of these guards and why it exists.

- **Conditional:** not a finding when the PR also updates the quality-gates ADR to record a maintainer
  decision to change the threshold.

**[PERF-MEAS-UNATTRIBUTED] (RECOMMENDED)**: A performance number in the PR body, an ADR or a comment that
does not say which run produced it: commit, command, fixture or full site, machine class. An unattributed
number cannot be re-checked, and fixture numbers do not extrapolate to the full site without saying so.
