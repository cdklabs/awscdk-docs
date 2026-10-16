# CDK Version Tracking and Per-Page History

## Status

Accepted

## Context

The docs must stay fresh as `aws-cdk-lib` releases (roughly weekly) and must show readers which CDK versions
the ecosystem is at. Two reader needs drive this:

- A single `/versions` page and a machine-readable `/versions.json` endpoint listing the current releases of the
  core CDK ecosystem packages, each linking to its GitHub release and its API documentation.
- On every API page, which release a type or module README first appeared in and which release last changed its
  observable shape.

Every version this flow handles originates as `dist-tags.latest` in an npm packument fetched over the network and
travels a long way — into a committed snapshot, the published endpoint, an S3 object key, and the publish marker —
so it is untrusted input and must be validated at every boundary. The site build itself must make no registry call,
so a registry outage cannot fail it and a build of one commit is reproducible.

## Decision

### Tracked packages and release-tag patterns

Four packages are tracked, declared in `TRACKED_PACKAGES` in `src/docgen/versions.ts`, each carrying its repo,
release-tag pattern, and documentation link explicitly:

- `aws-cdk-lib` — releases from `aws/aws-cdk` tagged `v<version>`.
- `aws-cdk` (CLI), `@aws-cdk/toolkit-lib`, `@aws-cdk/cloud-assembly-schema` — release from the `aws/aws-cdk-cli`
  monorepo tagged `<package>@v<version>`.

The three CLI-adjacent packages are deliberately **not** dependencies: `@aws-cdk/toolkit-lib` ships no jsii
assembly, and `@aws-cdk/cloud-assembly-schema` is re-exported as an `aws-cdk-lib` submodule. They exist only as
rows on the page and entries in the JSON. Adding a tracked package is a one-entry change; `docsUrl` is mandatory,
so the compiler forces a documentation-target choice. Pre-releases are excluded; only stable releases are tracked.

### Build-time version data: one page, one endpoint, no drift

`docs/versions.data.ts` is a thin VitePress build-time data loader; the registry, release-URL construction, semver
ordering, and packument-to-page mapping are pure functions in `src/docgen/versions.ts`, unit-tested offline against
fixture packuments. The loader reads the committed snapshot once per build and feeds two pure functions —
`buildVersionsData()` (the HTML page) and `buildVersionsJson()` (the endpoint) — so the page and JSON cannot drift.
Nothing is fetched client-side.

Each package row shows the `latest` dist-tag with its publish date, a release link, and a `docs` link. The page
lives at `/versions`, is linked from the navbar, renders as a real `<table>` with scoped headers styled with theme
variables only, links `versions.json`, and states the v1 end-of-support date. A "Previous releases" column was
rejected: readers want what is current, and the release-notes link already reaches full history.

`versions.json` is emitted at the site root beside `/versions.html` — swapping the extension on the page URL
reaches it (under the hosting base, `/cdk/api/versions.html` and `/cdk/api/versions.json`). It is written into
`docs/public/`, copied verbatim by VitePress, and is a gitignored build artifact. Each entry carries `package`,
`version` (**always** the full `major.minor.patch`, including for major-only display packages), `date` (the
registry publish timestamp), `releaseUrl`, and `docsUrl`; a top-level `generatedAt` records the snapshot's refresh
time. In an opt-in release-candidate build, the documented package reports the candidate's own pre-release version
— the value the pipeline reads its S3 key from. In the sharded build every shard emits its own `versions.json`;
because all shards read the one committed snapshot, the copies are byte-identical and the merge step keeps one.
Consumers needing the schema's exact version must read the JSON, not the major-only HTML page.

### Major-only view for the Cloud Assembly Schema

`@aws-cdk/cloud-assembly-schema` sets an opt-in `majorOnly?: boolean` on its tracked entry. Its minor/patch cadence
is independent of `aws-cdk-lib` and not actionable for readers; its **major** version is the compatibility
contract. When set, `packageVersions()` delegates to `majorOnlyPackageVersions()`, which — relying on descending
version order — keeps the newest stable release of the `latest` dist-tag's major line and renders `v<major>` alone,
linked to and dated by that release. All logic (`majorOf`, `toMajorRelease`, `majorOnlyPackageVersions`) stays in
the pure docgen layer. The flag is per-package, so adopting it for a future package is a one-field change.

### Static v1 entry

AWS CDK v1 is end-of-life; its final release `@aws-cdk/core@1.204.0` shipped 2023-06-19 and will never change, so
it is a single static constant `CDK_V1` in `src/docgen/versions.ts`, never resolved from npm and kept out of
`TRACKED_PACKAGES`. It pins the package identifier (`@aws-cdk/core` — `aws-cdk-lib` did not exist in v1), version
(`1.204.0`), publish date (`2023-06-19T20:55:21.633Z`), release URL (`v1.204.0`), end-of-support date
(`2023-06-01`), and `docsUrl` the archived v1 API reference (`https://docs.aws.amazon.com/cdk/api/v1/`). The one
constant feeds both `buildVersionsData()` (appended as the last row — an EOL line belongs below live packages) and
`buildVersionsJson()`, so page and JSON cannot drift. A second static/EOL line, if ever needed, follows the same
pattern rather than reintroducing a per-entry npm lookup.

### Documentation links and absolute URLs in the endpoint

Each tracked package declares one `docsUrl`, the single source of truth for the page's `docs` link and the JSON's
`docsUrl` field. Targets:

- `aws-cdk-lib` → this site's own generated module docs, built via `siteApiDocsUrl()` from the default language
  rather than hardcoding `ts` (this site *is* the aws-cdk-lib reference).
- `aws-cdk` → the CLI command reference (`docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd.html`).
- `@aws-cdk/toolkit-lib` → its AWS API reference (`docs.aws.amazon.com/cdk/api/toolkit-lib/`).
- `@aws-cdk/cloud-assembly-schema` → the npm package page.

A `docsUrl` starting with `/` is a page on this site: the page component wraps it in VitePress `withBase()` and it
opens in the same tab. Anything else is absolute and opens in a new tab (`target="_blank" rel="noopener"`). The
stored value never bakes in the deploy base.

The JSON endpoint has no site to resolve a relative path against, so `buildVersionsJson()` absolutizes site-relative
values at build time via `absoluteDocsUrl()`, joining a leading-`/` path onto a configurable site prefix with
`new URL()` against a directory-style base (tolerating a prefix with no trailing slash; absolute values pass through
byte-identical). The prefix is `DEFAULT_DOCS_SITE_URL` (`https://docs.aws.amazon.com/cdk/api/`), overridable by the
`DOCS_SITE_URL` env var. `DOCS_SITE_URL` is distinct from `DOCS_BASE` and is not composed with it: an override must
already include whatever base the deployment uses (a preview sets its own full root). Under the default prefix the
`aws-cdk-lib` entry resolves to `https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib-readme.html`. A deployment
serving the site elsewhere must set `DOCS_SITE_URL` or the JSON advertises links into production — the safer failure
for the endpoint's real consumers.

### Nightly refresh via a committed snapshot and one auto-merged PR

`versions.snapshot.json` holds a trimmed packument per tracked package — `dist-tags.latest` plus a `time` map
reduced to the versions actually rendered — and `loadVersionsData()` reads it instead of the registry. The trim
mirrors `packageVersions`' selection and is kept safe by a test asserting that rendering a trimmed packument equals
rendering the full one for every tracked package (measured ~1,900 `time` entries down to 12 with identical output).
`generatedAt` comes from the snapshot, not the clock — the property that makes a build reproducible.

`cdk-version-check` runs once nightly, resolves released versions, applies whatever moved (the core
`aws-cdk-lib` pin, the shared alpha-module pin, the snapshot, and the history ledger), and opens one PR labeled
`auto-approve` on the fixed branch `chore/cdk-version-bot/refresh-cdk-versions`. Merge stays gated on a green
`build`; the merge to `main` triggers the existing deploy/release flow via `enablePRAutoMerge`. The run is split
into `versions:plan` (the only registry query, records a plan) → `versions:apply` (offline) → `docs:baseline`
(updates the ledger from the newly installed release), so applied versions cannot differ from planned ones.

Every judgment is a pure function in `src/docgen/version-bump.ts` (alpha-publication check, did-anything-move
comparison, plan summary, reusing `isNewerVersion` from `freshness.ts`); the workflow holds no decision logic and
no package list — the alpha module list derives from the installed devDependencies projen generates from the single
documented-alpha-modules list. Both pins are structured data in `projenrc/cdk-versions.json`, which `.projenrc.ts`
imports (no `sed` over TypeScript source). An alpha candidate qualifies only when **every** documented module has
published it, tried newest-first over a bounded window; if none is unanimous the alpha pin is held and the PR body
names the missing modules. The two cursors may diverge: when alphas lag, the core pin still moves, so `Added in`
badging for alpha pages tracks the alpha cursor and can lag the core library by a release. `@jsii/spec` is out of
scope and bumps separately so a jsii-spec break cannot block a CDK bump.

### The registry is untrusted input: one version shape, validated at every boundary

`src/docgen/version-format.ts` is the single definition of a version's shape, and every boundary calls it:

- `VERSION_PATTERN` (`/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/`) — canonical form, rejects a leading `v` because npm
  dist-tags never carry one.
- `VERSION_PARSE_PATTERN` (`/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/`) — tolerates `v` and captures parts,
  because this repo may have written such a value itself.

Both are end-anchored so a longer string cannot pass as its own prefix, and a test asserts each source ends with
`$` literally, since anchoring is invisible to behavior tests using only well-formed input. **Validate, do not
sanitize:** `isValidVersion` and `assertValidVersion` throw on a bad value, and a throw in the planner means "do
not bump" — a night with no PR, not a laundered one. Both the read door (`parseVersionSnapshot`) and the write door
(`trimPackument`, where `dist-tags.latest` is copied) are guarded, because the snapshot diff reports a change for
*any* tracked package — a malformed `latest` on a non-pinned package would otherwise reach the committed file with
both pins `undefined`. The `$GITHUB_OUTPUT` write goes through one pure function `renderWorkflowOutputs(plan)` that
renders and validates all three lines, with a test pinning that the CLI has no second raw append path. In
JavaScript, `$` without the `m` flag matches only the very end of input and admits no trailing newline, which is
what stops output-line forging; a test pins this rather than leaving it as folklore.

### The publish marker never moves backwards

The release publish step writes a `latest-<stream>` marker (see
[publishing and hosting](./2026-10-15-publishing-and-hosting.md)). It reads the existing marker first and compares
the documented `aws-cdk-lib` version before writing, so a re-run against an older commit or a race between runs
cannot point consumers at stale docs. A missing marker always writes; a `head-object` tolerates only a 404, so a
denied read fails rather than masquerading as a first publish. The publish job checks out no source, so synth
embeds `VERSION_PARSE_PATTERN` into the step's environment and an inline script compares captured release parts
with the same semantics as the shared comparator; a test pins the embedded pattern to the module's and derives each
ordering verdict from the comparator, so semantics cannot drift. Strictly-newer and equal versions write (equal is
the same-version rebuild and still refreshes `published` and `rebuild_nonce`); an older version skips the write,
emits a `::warning::` naming both versions and the uploaded key, and keeps the job green (its versioned artifact
upload is legitimate). A current version that does not parse fails the job; an existing marker with no parseable
`version=` line is overwritten with a warning, self-healing a corrupted marker.

### Version-history ledger

`docgen.baseline.json` is a persistent, accumulating ledger keyed by fingerprint:

```jsonc
{
  "fingerprintVersion": 1,
  "versions": ["2.268.0", "2.268.0-alpha.0"],          // interned; rows hold indices
  "types":   { "aws-cdk-lib.aws_s3.Bucket": [0, 0, "2026-09-02T19:49:09.300Z", "cd685dd03726"] },
  "readmes": { "aws-cdk-lib.aws_s3":        [null, null, null, "9f2a1c4b8e07"] }
}
```

A row is `[introducedIn, lastChangedIn, lastChangedAt, fingerprint]` where `null` means unknown, shown everywhere
as absence, never a guess. One timestamp suffices because an entry's introduction is its first change. Rows for
removed types are kept so a re-added type carries honest history.

A fingerprint is a 12-hex (48-bit) truncated SHA-256 over a page's **observable shape**: for a type, its kind,
deprecation, stability, bases and interfaces, initializer parameters, and per member (sorted, so order is not a
change) name, parameter names/types with optional and variadic flags, return type, property type with optional,
readonly, static, abstract, const and protected flags, `@default`, stability and deprecation. Deliberately
excluded: `docs.summary`, `docs.remarks`, `docs.see`, `docs.example`, `docs.custom`, member order, and
`locationInModule` (line numbers move whenever anything above them changes, which would flag most of the library on
most releases). A README's fingerprint is over the markdown as the assembly ships it. 48 bits keeps the silent-
collision probability negligible at 30k+ entries, where 32 bits would be ~10%.

The docs build **only reads** the ledger. The sole writer is the explicit `docs:baseline` task
(`tsx src/docgen/cli.ts --update-ledger`), run by the nightly refresh *after* `versions:apply` installs the new
release, so it can diff new assemblies against recorded shapes. A build that mutated committed state would be
irreproducible and would race parallel shards. The task refuses to run when the stored `fingerprintVersion` differs
from the code's: changing the fingerprint definition invalidates every stored hash, and re-fingerprinting is a
deliberate re-seed. A change is dated by the release's npm publish time when the committed snapshot tracks the
package, else by the observing run. A release-candidate (dist-mode) build has no npm version and nowhere to commit,
so it reads whatever the last nightly committed; an unrecorded key resolves to unknown (no badge, no row) — a
candidate build must never attribute a type to the wrong release, and the build gains no write capability to close
that gap.

Migration lives in the loader: a pre-ledger baseline is read as rows with unknown history and no fingerprint; the
first update records shapes without inventing dates, and a type absent from the old list is introduced in the
installed release. Whether a run is the migration is reported from the file's shape, not inferred from empty
fingerprints.

**First documentation of a package seeds unknown history.** A key first seen in an assembly the ledger holds no
rows for is recorded `[null, null, null, fingerprint]`, not as introduced-in-the-installed-release — those types
were published years before the site chose to document them, so a badge and a `Type last changed · today` row would
be false. An assembly counts as already documented when the ledger holds its README key or any key prefixed with
its name. An empty ledger is exempt (a deliberate from-scratch seed, where the install is the only evidence). The
`docs:baseline` summary reports three buckets — introductions, changes, and `seeded` — so a bot PR writing hundreds
of rows accounts for them. This loses one real signal (a package published and documented in the same release reads
as unknown) to avoid a false one; the ledger cannot distinguish the cases and under-badging one module is cheaper
than dating an API to the wrong year.

### Display

Docgen writes recorded values into each page's frontmatter (`cdkDocsIntroducedIn`, `cdkDocsLastChangedIn`,
`cdkDocsLastChangedAt`) and the VitePress config lifts them into `cdk-docs-introduced-in`,
`cdk-docs-last-changed-in`, `cdk-docs-last-changed-at` metas, plus a `cdk-docs-content-revised` meta on every page
— not `themeConfig` (which round-trips through a fetched chunk with `metaChunk` on), and not the site-wide stamp
(these are per page). Three surfaces answer different questions:

- The type-metadata block gains a `Type last changed` row (`v2.150.0 · 3 Mar 2025`) from the fingerprint's version
  and date, omitted when unknown. It answers *when did this type change*.
- The page footer states `Content revised <date>`: the later of `CONTENT_REVISED_DATE` (one exported constant in
  `src/page-history.ts`, the lever to re-date every page after a broad documentation improvement — a floor-raiser,
  not a floor) and the page's own `lastChangedAt`, with the version appended only when the page's own change set the
  date. It answers *when was this page last revised*. The constant may raise the footer but never carries a version
  and never clamps the metadata row.
- An `Added in vX.Y.Z` badge on the H1 of a type or README page whose `introducedIn` shares `major.minor` with the
  documented version (patch ignored, so everything in a minor line reads as new for the life of that minor). An
  unknown `introducedIn` never badges — correct by construction, unknown means older than the window.

Dates are day-only in visible text (UTC, e.g. `3 Mar 2025`, identical in SSR) and full ISO timestamps in the head.

### Bounded version-history backfill

A manually invoked script (`history-backfill-cli.ts`) recovers history the migration left unknown without
installing dozens of dependency trees. It fetches the npm packument once, selects a stable release window ending at
the pinned `aws-cdk-lib` version, and processes oldest to newest, downloading one tarball at a time, extracting only
`.jsii`/`.jsii.gz`, and calling the same fingerprint functions, retaining only the previous release's maps plus the
accumulating ledger (memory bounded to one compressed and one expanded assembly). A tarball URL from packument
metadata is treated as data: it must be HTTPS on `https://registry.npmjs.org`, redirects are refused
(`redirect: 'error'`), and a release outside that policy fails with a diagnostic before any request. Entries present
in the oldest release keep unknown fields; a later first appearance sets both version fields to that release; a
later fingerprint difference sets the last-change version and npm publish time. The emitted ledger carries the
enforced fingerprint version, and `mergeSeedLedger` replaces only the `aws-cdk-lib` slice, preserving `constructs`
and alpha-module rows with their version indices remapped. The release count is an input, not a constant, so a run
can widen the window when coverage is poor. The committed seed walks all 362 stable CDK v2 releases (2.0.0 through
2.269.0), resolving 66.80% of introductions and 92.05% of last changes across 21,709 current `aws-cdk-lib` types;
entries present in 2.0.0 remain unknown (v1 history is outside the evidence window).

## Consequences

- The site build makes no `registry.npmjs.org` call, so a registry outage cannot fail it, and a build of one commit
  reproduces the same version output byte for byte (per dist in a candidate build, where the documented version
  comes from the candidate's `build.json`). The per-shard registry fetch is gone.
- Version freshness is bounded by the nightly cycle, not rebuild frequency, and every change arrives as a reviewable
  diff — a maintainer sees `2.1027.0 → 2.1028.0` in the PR. One extra commit per night only on days something
  released.
- A malformed or hostile `dist-tags.latest` fails the nightly run loudly (red workflow, no PR) rather than flowing
  to readers; any new consumer inherits the check for the cost of one import. The bot PR is `auto-approve` with
  auto-merge armed and no human-read gate — a queue-policy matter tracked separately, not a validation gap.
- `latest-<stream>` is monotonic in the documented version; a re-run or race can no longer regress it, and a skipped
  write is diagnosable from the run page alone.
- The ledger is `docgen.baseline.json`, ~3.06 MB after the v2 seed (version interning and the 12-hex hash keep it
  there; splitting per assembly is the next lever), one row per line for a readable bump diff, and must never be
  hand-edited. Both historical badge defects are gone: introduction is recorded once, so a skipped release cannot
  mislabel it, and alpha types date like any other because there is no same-version guard. Pages whose history
  predates the recorded window honestly show no `Type last changed` row and no badge.
- A future fingerprint-definition change requires an explicit re-seed/re-backfill, because the normal update refuses
  a version mismatch. Anything parsing the `docs:baseline` summary must read three counts, not two.

### Rejected alternatives

- A build-time or client-side registry fetch — puts a third-party call on the build's or reader's critical path and
  makes builds non-reproducible.
- Comparing against the deployed `versions.json` as the state store — the committed snapshot makes git the state
  store: diffable, reviewable, inspectable without a deploy.
- Committing the derived page data instead of trimmed packuments — moves tested pure logic into the nightly job.
- A nightly `schedule` on the full deploy pipeline, or `workflow_dispatch` chaining — pays a full sharded build
  every night and would need `actions: write` and the publish path proven inert; the single auto-merged PR needs
  neither.
- A semver library — out of proportion to comparing three numeric parts, and a permissive parser is the wrong
  instinct at a trust boundary where the goal is to accept less.
- Escaping the version at each interpolation site instead of validating once at the door — defends the last step
  while every earlier one still holds a non-version.
- Including `locationInModule`/line numbers or doc prose in the fingerprint — would flag most of the library on most
  releases and reduce the feature to noise.
