# Publishing and Hosting

## Status

Accepted

## Context

The built VitePress site must publish to S3 on every merge to `main`,
serve at the historical AWS CDK reference address so existing bookmarks keep
resolving, and tag the exact commit that went live. These concerns are
coupled: where the site is hosted dictates its internal URL shape, which
dictates the on-disk layout of the artifact, which dictates the publish and
tagging order. Setting any of them independently invites drift that fails at
deploy time — the one build that matters — with a site whose assets all 404.

## Decision

### Deploy-and-release workflow

A single projen-managed workflow (`deploy-and-release.yml`, authored in
`.projenrc.ts`, never by hand-editing the YAML) builds, publishes, and
releases. Job graph:

```
build ───┬─> release_docs_awscdk-docs ─> release_github
release ─┘
```

`build` and `release` run side by side (`release` only bumps the version and
writes the changelog, so it needs nothing from the build). `release_github` —
which creates the git tag and GitHub Release — runs last and needs the publish
job, so a version is tagged only once the site is published. A failed publish
leaves the version untagged; re-running the failed job publishes and then
releases.

Publishing is gated to `github.ref == 'refs/heads/main' && !inputs.dry_run`,
and skipped when the version tag already exists
(`needs.release.outputs.tag_exists != 'true'`). On a dry run the publish job
is skipped and `release_github` still runs with its release step skipped by
projen's dry-run guard. The build itself also runs on pull requests and the
merge queue, so docs-build breakage is caught before merge.

Two deviations from projen's defaults, both applied as task/workflow overrides
in `.projenrc.ts`:

- **The `release` task is `bump → unbump` only** — the full `build` spawn is
  dropped, because `gh release create` needs only the version, changelog, and
  tag metadata that `bump` produces; the site is built by `build`. The drift
  check (`git diff --exit-code`) is kept. The release job completes in seconds.
- **Projen's `latest_commit == github.sha` anti-race gate is removed** from the
  release job's artifact steps. The gate skips tagging when `main` has moved
  on, but with the build and publish jobs ahead of the release, `main` usually
  has newer commits by then, so deployed commits stopped getting tagged. It is
  redundant here: pushes to `main` serialize through a per-ref concurrency
  group (`${{ github.workflow }}-${{ github.ref }}`), so no two release jobs
  race, and each run checks out its own `github.sha` with full history, so
  version bumps always see the previous run's tag. Only the tag-already-exists
  guard remains.

Commits whose queued runs are canceled by the concurrency group get no
individual release; their changes land in the next successful run's changelog.

### S3 versioned-zip target

A projen component, `projenrc/s3-docs-publishing.ts` (`S3DocsPublishing`),
adds the publish job to the workflow, modeled on aws-cdk-cli's component.
Adding another stream later is one more instantiation.

- The `build` job packages the verified merged site into `cdk-docs-site.zip`
  (`scripts/package-site.sh`) and uploads it as the `docs-site` artifact. The
  zip name is a contract between the packaging step and the component's
  `artifactPath`; `test/publish.test.ts` pins both sides. Packaging after
  verification means S3 never receives an unverified site.
- **Two-step OIDC role chaining.** GitHub's OIDC token assumes the account role
  (`vars.AWS_ROLE_TO_ASSUME_FOR_ACCOUNT`); the publishing role
  (`vars.PUBLISH_CDK_REF_DOCS_ROLE_ARN`) trusts that account role, not the OIDC
  provider, and is assumed from it via `role-chaining`. Configuration lives on
  the `release` GitHub environment (`AWS_ROLE_TO_ASSUME_FOR_ACCOUNT`,
  `DOCS_BUCKET_NAME`, `PUBLISH_CDK_REF_DOCS_ROLE_ARN`), which the job declares
  as its `environment` — the role trust is conditioned on that environment
  claim. The job fails at credential time, not silently, if the role or bucket
  is missing.
- **The docs stream is `awscdk-docs`.** The versioned artifact key is
  `awscdk-docs/awscdk-docs-v<aws-cdk-lib version>.zip`; the pointer object is
  `latest-awscdk-docs`.
- **Versioned by the documented aws-cdk-lib, read at publish time from
  `cdk/api/versions.json` inside the zip.** The artifact is the source of
  truth, so the manifest can never disagree with the zip it describes — no
  merge-job outputs, pin files, or registry calls, and no drift window. The
  version is validated against the shared `VERSION_PARSE_PATTERN` before it
  reaches the object key. A missing endpoint, missing aws-cdk-lib entry, or
  empty timestamp fails the job rather than publishing a garbage key.
- **The `latest-awscdk-docs` marker is a v2 manifest:**

  ```
  #manifest-version:2
  artifact_path=awscdk-docs/awscdk-docs-v2.268.0.zip
  version=2.268.0
  published=2026-09-09T07:59:16Z
  rebuild_nonce=<commit sha>
  ```

  `published` dates the documented library (its full npm publish timestamp from
  the versions endpoint), not the docs build. `rebuild_nonce` is the commit SHA,
  so consumers can detect that the artifact behind an unchanged version changed.
- **Same-version uploads overwrite** (no `--if-none-match`): the site evolves
  independently of aws-cdk-lib, so the same documented version is legitimately
  republished when only the site changed, and the nonce is the signal. The
  versioned artifact always uploads; only the `latest` marker write is ordered,
  and it is never moved backward to an older version (see
  [versions and history](./2026-10-15-versions-and-history.md)). The
  duplicate-tag gate still prevents workflow re-runs from republishing.

### Hosted path mirrored in the built tree

The site serves from `https://docs.aws.amazon.com/cdk/api/`, and the published
zip must contain exactly that subtree with no loose files at its root. Both the
URL base and the on-disk layout derive from one value, `SITE_BASE = '/cdk/api/'`
in `.projenrc.ts`, passed to the build as `DOCS_BASE`:

| `DOCS_BASE` | `base` | built site |
| --- | --- | --- |
| unset | `/` | `docs/.vitepress/dist` |
| `/cdk/api/` | `/cdk/api/` | `docs/.vitepress/dist/cdk/api` |

`scripts/site-paths.cjs` is the single derivation of `base` and `outDir`
(CommonJS because its consumers — the ESM VitePress config, plain-node build
scripts, and Jest — share nothing else). It normalizes a base missing its
leading or trailing slash. `src/docgen/links.ts` keeps its own `siteBase()`
copy because it prefixes raw-HTML hrefs as a TypeScript entry point;
`test/hosting-base.test.ts` pins the two in agreement and recomputes every
workflow path from `SITE_BASE`, so moving the hosted path is a one-line change
plus `npx projen`. The deployed build sets `DOCS_BASE`; local and
e2e/a11y/Lighthouse fixture builds leave it unset, so the nesting is inert and
those specs stay valid at the root base. The build's completeness checks fail
if anything sits beside the hosted tree at the artifact root.

### Canonical URLs at the historical shape

The historical reference uses a flat, dotted URL grammar that thousands of
external links point at. **That shape is the canonical page tree** — docgen
emits real pages there, not redirects (the maintainer's explicit steer). Pages
are renamed, not duplicated, so page count and content — and the shard build's
budget — are unchanged.

- Site routes are base-relative and drop the historical `/api/` prefix; the
  hosting base supplies it. Route constants live once in a browser-safe
  `src/site-routes.ts` (`API_ROOT = '/v2/'`, `API_DOCS_ROOT = '/v2/docs/'`,
  `VERSIONS_ROUTE = '/versions'`, `VERSIONS_JSON_PATH = 'versions.json'`),
  shared by docgen (which emits links) and the theme (which parses them).
  Neither side spells a route literal again. `DEFAULT_DOCS_SITE_URL` is
  `https://docs.aws.amazon.com/cdk/api/`. Under `SITE_BASE = '/cdk/api/'` the
  hosted URLs come out byte-identical to the historical shape
  (`/cdk/api/v2/docs/…`, `/cdk/api/versions.json`).
- Docgen emits every page at `/v2/docs/<docId>[.<submodule>][.<Type>].html`
  (flat directory), package/submodule overviews at `…-readme.html`, and the
  modules index at `/v2/` (which is the API overview, and the historical
  modules-index address). `<docId>` is the npm name with `/` → `_`
  (`@aws-cdk/aws-glue-alpha` → `@aws-cdk_aws-glue-alpha`); submodules keep their
  jsii identifiers (`aws_s3`); nested types keep dotted names. The generated
  tree is `docs/api/v2/` (gitignored). Link construction is centralized in
  `src/docgen/links.ts` (`typePageLink` / `moduleReadmeLink` / `API_ROOT`).
- No client-side redirect layer for this fork's interim `/api/modules/ts/…`
  tree: it was never published, so there are no external links to answer.

### Legacy per-language URLs are redirected by the host

The historical reference published a separate site per language, each with its
own directory-based URL grammar (Python `/api/v2/python/aws_cdk.aws_s3/`, Java
`…/services/s3/package-summary.html`, .NET `…/api/Amazon.CDK.AWS.S3.Bucket.html`).
These addresses have real external links, but the site serves one canonical
page per symbol with client-side language selection, so there is no
per-language page tree — emitting one would be three more copies of a ~23k-page
tree the sharded build cannot absorb. The serving host redirects these
addresses to the canonical pages; the site itself carries no redirect layer.

## Consequences

- Every push to `main` that publishes successfully produces a git tag and a
  GitHub Release pointing at the published commit, and publishes the S3
  `awscdk-docs` stream. A failed S3 upload holds back the tag and release until
  it succeeds.
- S3 keys are meaningful to consumers (`awscdk-docs-v<cdk version>.zip`) and
  stable across site-only releases; later uploads for the same CDK version
  replace earlier ones. Marker consumers must parse the v2 manifest. Consumers
  of the `versions.json` endpoint and of the manifest see the same version by
  construction.
- The published zip contains exactly one top-level directory (`cdk/`), whose
  internal path matches the URL it is served at; the upload can point at
  whatever depth its root sits.
- Historical official deep links resolve to real pages. Legacy per-language
  deep links depend on the host's redirects.

### Rejected alternatives

- **Emit real per-language pages** (as done for the TypeScript shape, which was
  a rename). Per-language pages are duplication the sharded build cannot
  absorb; a spike measured 2,910 pages against 586 on the same fixture.
- **One redirect stub per symbol per language** — ~23k pages × 3 languages of
  tiny files.
- **A client-side redirect on the 404 page** — it answers HTTP 404 first, so
  crawlers and clients without JavaScript never see the redirect.
