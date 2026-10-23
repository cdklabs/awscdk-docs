# Docgen Sources and Modules

## Status

Accepted

## Context

The API reference is generated from jsii assemblies. jsii modules ship a
machine-readable assembly (`.jsii`, possibly compressed as `.jsii.gz`)
describing every public type, and a rosetta tablet (`.jsii.tabl.json.gz`)
holding translated examples. The documentation must cover the whole in-support
AWS CDK ecosystem — `aws-cdk-lib`, `constructs`, the published CloudFormation
property mixins, and every in-support `@aws-cdk/*-alpha` module — without
committing thousands of generated pages to git, and must be buildable both from
npm (the normal path) and from a release candidate's own build output before it
reaches npm (the release-pipeline path).

## Decision

### In-house generator from jsii assemblies

A small generator in `src/docgen/` builds on `@jsii/spec` (the official library
for loading and typing jsii assemblies; it transparently handles compressed
`.jsii.gz`). Heavier tools like `jsii-docgen` are deliberately avoided to keep
full control over VitePress page layout.

Generated markdown is written to `docs/api/modules/`, which is gitignored —
generated pages are build artifacts, always fresh, never stale in git.
Generation runs via the projen task `docs:generate`, prepended to `docs:build`
and `docs:dev`. A generated `sidebar.json` populates the API sidebar; see
[sidebar navigation](./2026-10-15-sidebar-navigation.md).

### Configured module set

The documented modules are declared in `docgen.config.json` under `modules`.
`.projenrc.ts` derives the exact-pinned devDependencies from that file (docgen
loads each assembly from `node_modules/<moduleName>`), and a test asserts the
generated `package.json` matches the config, so adding a module is a one-line
config change plus `npx projen`.

The set documents `aws-cdk-lib`, `constructs`, `@aws-cdk/cfn-property-mixins`,
`@aws-cdk/mixins-preview`, and every in-support alpha module published in
lockstep with the pinned core version (`<cdk-version>-alpha.0`). Excluded with reason: out-of-support alphas
pinned to older CDK lines (they would advertise stale APIs); `cli-lib-alpha`
(deprecated for `toolkit-lib`); `toolkit-lib` (ships no jsii assembly — the
`/versions` page links its external docs); and `cx-api`, `region-info`,
`cloud-assembly-schema` (re-exported as `aws-cdk-lib` submodules, so documenting
the standalone packages would duplicate pages).

A standalone package's root types group under an owner derived from the package
name (`assemblyOwner`): `aws-lambda-python-alpha` folds into the Lambda section
beside `aws_lambda`, while non-service packages (`integ-tests-alpha`) become
their own Framework sections. Every non-`aws-cdk-lib` module page opens with a
`Separate package` install container (npm + pip commands from the assembly's
python target); experimental modules use the warning variant and state the
alpha stability caveat.

### Per-module overview pages

Every documented module — package root or submodule — owns one overview page at
its canonical `…-readme` URL. The content is config, not a renderer special
case: `docgen.config.json` `overviews` is keyed by module id (`<assemblyName>`
for a root, `<assemblyName>.<submodule>` for a submodule) with kinds `readme`
(default), `none`, `copy` (another module's README body verbatim), and
`generated` (an artificial index page; package roots only). Config is validated
in two passes — shape at parse time, then against the loaded module ids — so a
typo throws rather than producing wrong pages.

By default an overview renders the module's own README from the jsii assembly
metadata, followed by the interactive preview list of the module's types under
a `## Types` heading. A README's leading `# <Title>` heading becomes the page
title; a `# <fqn>` fallback is added only when a README lacks one. Modules
without a README render the type list alone.

README prose is embedded safely for VitePress: the body is wrapped in a
`<div v-pre>` container (with surrounding blank lines so markdown-it still
parses the inner markdown) to disable Vue template compilation, because
mustache `{{ … }}` and `${…}` template literals survive escaping and otherwise
crash the Vue compiler even inside code spans. The leading title heading is
emitted outside the container so VitePress still extracts title and outline.
HTML comments are stripped outside code. Repo-relative image and link targets
are flattened (images to alt text, links to label) because Vite tries to bundle
a relative markdown image at build time and hard-fails when the source lives in
the CDK repo rather than the docs tree — an error `ignoreDeadLinks` does not
catch. Absolute URLs, root-absolute paths, and anchors are left untouched.

### CloudFormation property mixins

`@aws-cdk/cfn-property-mixins` is documented at the `aws-cdk-lib` version pin
through the existing assembly-loading and mixin-classification paths — no
package-specific renderer or rule. Two generic config knobs tune it:

- `includeKinds` selects which classifications a module emits dedicated pages,
  links, sidebar entries, search entries, and history rows for. Classification
  still uses the complete cross-module type index. This package is configured
  to emit only `Mixin`, so its supporting datatype interfaces remain available
  to classification and signatures but get no pages.
- `emitExamples` suppresses type-level example sections. This package is
  configured without examples, because its generated five-language examples
  account for most of its page bytes while adding no classification, signature,
  hierarchy, or navigation information.

With both knobs the package contributes about 2,056 pages (~15 MB) rather than
13,257 pages (~127 MB). Other modules emit every classified type with examples
unless they opt in.

### Mixins preview

`@aws-cdk/mixins-preview` ships in lockstep with the alpha modules at the alpha
pin (`<cdk-version>-alpha.0`) but is not named `*-alpha`, so the alpha module
pattern does not catch it; `.projenrc.ts` pins it by name at `cdkAlpha`
(`CDK_ALPHA_PACKAGES`), and `docgen.config.json` lists it among the fixed
modules the nightly module sync leaves in place. It documents with the default
kinds and examples: its per-service `mixins` submodules follow the mixin rules
below, and its per-service `events` submodules fold into their service per
[fold events submodules](./2026-10-22-fold-events-submodules.md). At
2.274.0-alpha.0 it contributes about 2,100 pages, roughly 3.6% of the site.

### Mixin classification by the `IMixin` marker

A mixin is identified by the CDK's first-class `IMixin` marker interface, not a
heuristic. The marker's FQN (`IMixin`, currently `constructs.IMixin`) is
resolved from the loaded assemblies at build time so the rule follows the marker
if it moves. If no `IMixin` interface is found, docgen logs a warning and
classifies nothing as a mixin — degrading visibly, not silently.

Two coexisting rules classify a type as a mixin:

- **Interface rule.** A non-datatype interface whose interface closure contains
  the `IMixin` marker (directly or transitively) and that is implemented by at
  least one class (directly, through interface inheritance, or along a class's
  base-class chain). `MixinIndex` maps such an interface to its implementing
  classes, which the mixin page renders as its "Implemented by" row.
- **Class rule.** A class whose base-class chain reaches a type carrying the
  marker. Starting at the base, not the class itself, excludes the abstract
  `aws-cdk-lib.Mixin` base (the mechanism, not a mixin a user applies) and makes
  depth irrelevant. The six concrete mixins that ship today (`aws_s3.mixins.*`,
  `aws_ecr.mixins.RepositoryAutoDeleteImages`, `aws_ecs.mixins.ClusterSettings`)
  are class-based; they keep the class page template since they have
  constructors, methods, and properties, while classification drives their
  `Mixin` badge and sidebar group.

Ordinary behavioral interfaces (`IBucket`, `IRole`, `IGrantable`) render as
plain `Interface` pages. The shape that ships today is pinned against the real
assembly by test, so a change in the library's mixin shape fails the build
rather than silently reclassifying pages.

### Dist mode: building from a release candidate

Normal builds install the pinned module tree from npm. The release pipeline
publishes this site as part of a release, before the version is on npm, so it
builds from the candidate's own output. Dist mode is opt-in through the single
absolute-path environment variable `CDK_DIST_DIR`; every added code path is
behind that check, leaving the npm path (owned by
[versions and history](./2026-10-15-versions-and-history.md)) untouched. The
variable must be absolute — it is read once at the repo root during install and
again from inside each per-shard workspace during the build, so a relative value
would resolve to different places; refusing it fails at the install command
rather than mid-build.

The dist root holds `build.json` (naming the candidate version and commit) and
`js/*.tgz` (the `npm pack` tarballs). The release invocation is
`CDK_DIST_DIR=… npx projen docs:dist:install` followed by the existing
`docs:build:sharded` (see
[site generator and build](./2026-10-15-site-generator-and-build.md)), with
`CDK_DIST_DIR` flowing to the build through the environment.

- **Install with `npm install --no-save --legacy-peer-deps` over the pinned
  tree.** Rewriting pins or adding overrides would dirty generated, committed
  files that `npm ci` could no longer reproduce. `--no-save` leaves
  `package.json` and the lockfile byte-identical. Candidate alpha tarballs have
  peer ranges for the candidate core version while the committed manifest still
  names the prior release, so resolving peers against that stale graph produces
  `ERESOLVE`. Ignoring the stale peer graph is safe here because every requested
  tarball is explicit and the post-install check requires every installed module
  to match the candidate release.
- **Match tarballs by the package name inside the archive**, read from
  `package/package.json`, not by file name — `npm pack` mangles scopes
  (`@aws-cdk/aws-msk-alpha` → `aws-cdk-aws-msk-alpha-<version>.tgz`), which an
  unscoped package of that name would also produce.
- **Configured stable CDK modules are required in the dist.** A configured
  stable module with no tarball fails before install, naming every missing one
  at once, so an incomplete candidate cannot silently fall back to a stale npm
  pin while still reporting the candidate version. A configured alpha module
  with no tarball is dropped from the install and documentation plan and named
  in the install output, because alpha tarballs may disappear from a dist.
- **The dist is authoritative for additions.** Every tarball containing a
  `package/.jsii` assembly is a documentation candidate; a jsii module present
  in the dist but absent from `docgen.config.json` is installed and appended to
  docgen's in-memory module list for that build only — the tracked file is not
  rewritten, and non-jsii release artifacts are ignored. A candidate can thus
  introduce and document a new jsii package in the same build.
- **`constructs` is excluded from dist sourcing** — it releases independently of
  aws-cdk, so the candidate says nothing about which version to document; it
  keeps coming from npm at its range.
- **Verify after install, per module and per build.** Each installed module must
  carry `.jsii`, the rosetta tablet (`loadTablet` degrades silently to empty, so
  a missing tablet would publish a complete-looking site with every example
  untranslated), and a version whose release parts match the candidate.
- **The documented version is taken from `build.json`** and overlaid onto the
  version snapshot as a build-time view (a new snapshot, never a write), with no
  synthesized publish date — a candidate has none, and both builders render a
  missing timestamp as an empty date. Only the documented package is overlaid.
  The candidate's prerelease suffix is kept intact because it identifies the
  build and the pipeline derives its S3 key from `/versions.json`.

### Alpha module sync: the release tag is the source of truth

The alpha module list is maintained automatically. The source of truth is the
`packages/@aws-cdk/*-alpha` directory listing of `aws/aws-cdk` at the release
tag matching the pinned core version (`v<awsCdkLib>`), read with one
authenticated GitHub contents API call using the job's own `GITHUB_TOKEN`.
Reading the tag, not `main`, keeps the module list describing the same release
as the version pins; `main` carries unreleased modules that could not be
installed.

- **Every addition is cross-checked against npm.** A module the tag ships but
  that has not published the pinned alpha version is held and named in the log
  and PR body, not added — installing a version a module lacks fails the tree.
- **One committed source.** The list lives only in `docgen.config.json`;
  `.projenrc.ts` derives alpha devDependencies from its `-alpha` entries.
- **Not auto-approved.** The version-bump PR is auto-approved as a mechanical
  pin move, but a module-list change adds or deletes a whole module's pages and
  inbound links, so its PR is opened on its own branch for a human to merge; a
  removal PR states the page count it deletes, per module and total.
- **An unreadable or implausible listing fails the run.** A non-200 response, a
  non-array body, an empty array, and an array with no alpha directories all
  throw, since each would otherwise plan removal of every documented module.

## Consequences

- Adding or documenting a module is a config entry plus `npx projen`, guarded by
  the config/devDeps sync test; alpha types appear beside their stable service,
  marked experimental, and gain `module:` search filters automatically.
- Generated pages are always fresh and never stale in git, but not browsable
  directly in the repository. `aws-cdk-lib` is a large (~200 MB installed)
  devDependency — the cost of documenting it from its assembly.
- New alpha modules appear within a day of the release that ships them once a
  reviewer merges the bot's PR; graduated or dropped modules are proposed for
  removal the same way, with the page count in view.
- A candidate build renders types the version-history ledger has not recorded
  with no history and no "Added in" badge — the correct answer for a version
  that has not shipped; see
  [versions and history](./2026-10-15-versions-and-history.md). The ledger is
  not updated by the alpha-sync job either, so a newly documented module shows
  no history until the next core release moves the pin.
- A dist build leaves `node_modules` holding candidate versions the lockfile
  does not describe — correct for a throwaway pipeline container, recovered by
  `npm ci` in a developer checkout; nothing reinstalls automatically, since
  silently rewriting someone's tree is worse than leaving it as asked.
- A candidate's `/versions` row shows an empty release date and links a
  `releases/tag/v<candidate>` tag that is never cut; that output is not
  published, and the alternative was a fabricated date.

### Rejected alternatives

- **Heuristic mixin detection** (any non-datatype behavioral interface
  implemented by a class) over-classified ordinary interfaces like `IBucket`;
  the explicit `IMixin` marker replaces it.
- **npm registry search** over the `@aws-cdk` scope for the alpha list: it is
  paginated and eventually consistent, returns deprecated and graduated packages,
  and cannot say which modules belong to a release — only that they exist.
- **A published aws-cdk package manifest**: none exists;
  `aws-cdk-lib` metadata names nothing outside itself.
