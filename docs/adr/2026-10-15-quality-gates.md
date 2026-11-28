# Quality Gates: Browser E2E, Accessibility, Performance, and Dependency Licenses

## Status

Accepted

## Context

The Jest unit suite (`test/*.test.ts`) tests the docgen/build pipeline and never
loads the rendered site, so the interactive Vue theme features — the type-ahead
symbol filter, language switcher, favorites, feedback widget, type hover
tooltips, Pagefind search, and the lazy API sidebar — can break with no test
failure. Accessibility work also happens in the browser: the navbar filter,
language toggle, lazy sidebar, and tooltips mount client-side, so their DOM and
any ARIA mistake in it only exist after hydration; a checker reading generated
markup audits a tree those components have not touched. Separately, the project
needs an automated control over the licenses its dependency tree pulls in. Jest also measured only
files a test imports, so untested files dropped out of the report, and no coverage number
failed the build.

Three environment constraints shape the browser gates: the full site is tens of
thousands of pages built in memory-hungry shards and cannot be audited whole or rebuilt per
run; CI runners have no system Chrome; and this is a projen project, so tasks,
dependencies, and workflows are declared in `.projenrc.ts`, never hand-written.

## Decision

### Browser e2e suite (`docs:e2e`)

[Playwright](https://playwright.dev) (`@playwright/test`) drives the built site
in Chromium. It bundles and installs its own browser
(`npx playwright install --with-deps chromium`), sidestepping the no-system-Chrome
constraint. Its auto-waiting assertions suit a hydrated SPA where favorites, the
footer links, and the API sidebar render in `onMounted`.

Specs live in `test/e2e/` with their own Playwright config. The Jest suite ignores
that directory (`project.jest.addIgnorePattern('/test/e2e/')`) so `npx projen test`
and `npx projen docs:e2e` never collide. `docs:e2e` is NOT part of the default
`build` task — a browser suite is too slow and heavy for every local build.

**Fixture, not the full site.** `docs:e2e` runs the normal `docs:generate` (cheap),
then `scripts/e2e-fixture-prune.cjs` prunes to a few representative aws-cdk-lib
services (default `aws-sns`, `aws-sqs` and `region-info` via `E2E_FIXTURE_SERVICES`;
the `constructs` and `aws-cdk-aws-codestar-alpha` modules via `E2E_FIXTURE_MODULES`,
plus the hand-written pages), then a single-shot `vitepress build`
with Pagefind indexing, then overlays the agent-Markdown twins. The complete
client-side assets (`sidebar.json`, `symbols.json`, `type-summaries.json`,
`api-sidebar/<lang>.json`) are left intact, so the features under test consume
production-identical data. `region-info` and `aws-cdk-aws-codestar-alpha` each earn
their place with one page the other services cannot supply: `region_info.Default` is
a type whose own stability is `deprecated`, and the alpha package is what renders the
experimental banner and the Experimental stability chip, the only link in the chip
row. Both are small. `scripts/e2e-fixture-prune.cjs` prints the number of pages it
keeps on every run, 88 with these defaults, and the build of that many pages
needs no special memory settings.

**The suite owns its server; never reuses one.** Playwright boots
`scripts/e2e-serve.cjs`, a plain localhost static server over the built `dist`, and
tears it down with the run. We deliberately do not use `vitepress preview`: its
on-the-fly brotli compression takes ~5s per multi-MB JSON asset, starving the
fetch-driven features under test. Production serves these precompressed, so that
cost is a preview-server artifact; `e2e-serve.cjs` streams uncompressed.

`reuseExistingServer` is `false` unconditionally (CI and local). Playwright's
`webServer.url` is only a liveness probe — it adopts any listener that answers, with
no check of version or served directory — so a leftover `vitepress preview` or
another worktree's server could silently satisfy the probe and let a green suite
say nothing about the build under test. The port is reserved in the config: it asks
the OS for a free port, then hands that number to the server, because Playwright
needs `webServer.url` before the server starts and cannot learn a port the server
chose. The reserved port is carried in `E2E_SERVE_PORT` because Playwright
re-evaluates the config in every worker; reserving per load made workers address
different ports (`ERR_CONNECTION_REFUSED`). No spec may fall back to a hardcoded
server URL — a fallback would resolve against some other server instead of failing.
The load-bearing config fields (port strategy, reuse flag, agreement between
reserved port and server command, absence of hardcoded spec URLs, determinism
settings, CI worker count) are pinned by a unit test, each mutation-proved to fail when flipped.
`e2e-serve.cjs` keeps a `4173` default for bare manual invocation; the suite always
passes an explicit port.

**Spec files run in parallel; tests within a file run in order.** Every test gets its
own browser context, so localStorage and other page state never cross tests, and the
one static server answers parallel workers without shared state. `fullyParallel` stays
off so tests in one file keep their order. The `docs:a11y` gate shares the config and
runs the same way. On CI the worker count is a fixed number rather than a share of
`os.cpus()`, which on the CodeBuild runner reports the host's cores, not the runner's.
The number leaves each worker CPU headroom: some specs race a deliberately delayed
fetch against a fixed assertion timeout and fail when workers starve each other of
CPU. Locally Playwright's default worker count applies.

### Accessibility audit gate (`docs:a11y`)

`@axe-core/playwright` audits the hydrated site in Chromium, reusing the e2e fixture
build. Both suites live in `test/e2e/` and share one fixture, but are separate gates
split by tag so a red check names which broke: `docs:e2e` runs `--grep-invert @a11y`,
`docs:a11y` runs `--grep @a11y`. The audit sets a 5-minute per-test budget (a real API
page carries thousands of nodes and far exceeds the suite's 30s default).

- **Fail on `critical` and `serious`; report `moderate` and `minor`.** Severities are
  exported as `FAILING_IMPACTS` from the playwright-free fixture module, alongside
  `REPRESENTATIVE_PAGES`, so the Lighthouse gate imports the same page set rather than
  keeping a copy that could drift.
- **`color-contrast` is exempt only inside `pre code`**, node by node — three failing
  colors are the vendored `github-light` Shiki theme's own tokens (`#d73a49`,
  `#e36209`, `#6a737d`), third-party content on its own cadence. The exemption drops
  individual nodes, so a violation that also hits an element outside a code block still
  fails. Accepted gap: an unreadable syntax theme is not caught.
- **Repo-owned contrast failures are fixed at the resolving mechanism and pinned by
  computed ratio, not hex literal**, so a later lightening fails a test. Three are
  non-obvious: `.vp-doc a > code` resolves `--vp-code-link-color`; the fenced-block
  language label falls back to the framework default because `html[data-code-theme]`
  is absent until a reader picks a code theme; `--vp-badge-tip-text` reaches brand-1
  through the `tip` ramp, coloring the kind badge. Verify any future contrast fix
  against a built page, never the stylesheet (see
  [brand, theme, and icons](./2026-10-15-brand-theme-and-icons.md)).
- **Rules axe ships disabled are a category.** Such a rule is invisible to the default
  set regardless of threshold or page list, so reaching for one is the normal way to
  gate a criterion Lighthouse flags and the default audit does not. New rules belong in
  the main audit (`a11y-audit.spec.ts`) through a guarded `.options()` call that enables
  by name — e.g. `label-content-name-mismatch` (WCAG 2.5.3). `target-size` (WCAG 2.5.8)
  currently lives in its own tagged spec (`a11y-target-size.spec.ts`); folding it into
  the audit is worth doing so a reader of the audit sees every gated rule.
- **The gate's configuration is guarded by unit tests** (`test/a11y-gate.test.ts`),
  because the failure mode is silent weakening, not a red check: narrowing the threshold
  to critical-only, shrinking the page set, dropping the tag split, or using one of
  `AxeBuilder`'s narrowing verbs would leave the gate passing while covering less. The
  guard admits `.options()` only when every rule entry inside it is `enabled: true` — an
  enabling call cannot smuggle a rule off.

### Performance gate (`docs:lighthouse`)

Two thresholds, maintainer-confirmed, from a single Lighthouse run: a Performance score
of **90** (`minScore: 0.9`) and a **combined 400KB gzipped JS+CSS** budget per page.

- **Depend on `lighthouse` directly** (`^13.4.0`), not `@lhci/cli`. lhci pins Lighthouse
  to an exact stale version (12.x) with no override escape, and the gate already
  re-implemented almost everything lhci offered. Lighthouse upgrades are now ordinary
  dependency bumps. Lighthouse 13 requires Node `>= 22.19`; CI pins `node-version: 22`.
  Scores are not comparable across the 12→13 boundary.
- **Audit the e2e fixture, not the full site.** The budget under test is the shared theme
  JS/CSS every page loads identically, so a representative handful measures the same
  bundles: the homepage, one module overview (`aws-cdk-lib.aws_sqs-readme.html`), and one
  construct detail page (`aws-cdk-lib.aws_sns.Topic.html`), listed in
  `lighthouse.config.json` with `numberOfRuns: 3` and `minScore: 0.9`.
- **Serve gzipped for the audit only.** `scripts/lighthouse-run.cjs` sets
  `E2E_SERVE_GZIP=1`; Lighthouse measures transfer size, so without compression it would
  compare uncompressed bytes to a compressed budget and pass bundles ~3× over. The e2e
  suite keeps its uncompressed default. The server also sends `Cache-Control` in gate mode
  so Lighthouse does not mark assets uncacheable; this makes the measurement faithful to
  production, not better. Gate-mode encoding, transfer size, and cache behavior are
  covered by behavioral tests that boot the server against a fixture.
- **Score in the runner, budget in a script.** The score is the median of three runs per
  page (desktop preset, performance category only); a `null` score fails loudly. The
  combined budget is asserted by `scripts/lighthouse-budget.cjs`, which sums the `script`
  and `stylesheet` rows of the `resource-summary` audit in reports already written —
  Lighthouse's own budget mechanism caps each type separately and cannot express a
  combined ceiling. The score assertion runs first, so a score failure masks a budget
  failure until fixed.
- **The runner owns the server on an OS-assigned port** (port `0`), reads the bound port
  off the ready line, and substitutes it into the configured URLs. Only the port is
  substituted, never the path list — a substituted list replaces the configured one, so a
  subset would quietly shrink the audit; a test pins the substituted list to the
  configured one. The `127.0.0.1:4173` URLs in `lighthouse.config.json` are placeholders:
  `urlsForPort()` rewrites every port, so the number is never a claim on the port.
- **Three ways to pass while measuring nothing, all closed:** the runner preflights every
  URL for HTTP 200 (with `onlyCategories: ["performance"]` Lighthouse skips
  `http-status-code`, so a small fast 404 page would otherwise score and pass); it clears
  `.lighthouseci/` before each run (stale reports keyed on the ephemeral port do not
  collapse, so a page once over budget would fail forever and a second local run would
  report six pages); and `lighthouse-budget.cjs` throws, naming the URL, when the hidden
  `resource-summary` audit's `items` is not an array (a Lighthouse bump could rename or
  drop it, and a lenient fallback would measure every page as 0.0KB).
- `.lighthouseci/` is gitignored and uploaded as a build artifact. The number that moves
  this gate is DOM size and the blocking time it causes, not paint; treat a single
  borderline run as runner noise and a sustained drop as real.

### Dependency license gate

Only dependencies under one of these licenses may enter the tree, in development and
production alike:

MIT, ISC, Apache-2.0, Python-2.0, 0BSD, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0,
CC0-1.0, CC-BY-4.0, CC-BY-3.0, MPL-2.0.

The list is permissive plus weak copyleft: everything on it allows redistribution without
imposing license terms on this project's own code (MPL-2.0's copyleft is file-scoped and no
dependency source is modified here). Strong-copyleft (GPL family) and unlicensed packages
are excluded. Two enforcement points check the same list:

- **`check-licenses` task**, spawned by `build`: runs `license-checker-rseidelsohn --summary
  --onlyAllow <list> --excludePrivatePackages` over the installed tree, failing every build.
  `--excludePrivatePackages` keeps the project's own private, UNLICENSED-reading package from
  failing the gate.
- **`dependency-review` workflow** (`allow-licenses` with the same list): checks a pull
  request's dependency diff at review time, before install, and re-runs on `merge_group`.

The list has a single source in `.projenrc.ts` (`checkLicenses.allow`), which generates both
enforcement points, so they cannot drift. Adopting a new license means editing it there and
recording why in an ADR, per repository convention
([repository conventions](./2026-10-15-repository-conventions.md)).

### Unit coverage floor

The Jest suite measures coverage over every source file, not only the files a test
imports, so an untested file counts as 0% instead of dropping out of the total. Under V8, a
file no test imports adds one uncovered function and one uncovered branch, so the lines floor is
the one that catches new untested files. `collectCoverageFrom` in `.projenrc.ts` lists `src/`, `scripts/`, `projenrc/`,
`docs/*.data.ts`, and the TypeScript under `docs/.vitepress/`.

Two groups stay out, on purpose:

- **Vue components** (`docs/.vitepress/theme/*.vue`). Jest has no single-file-component
  transformer here, and adding one means a new dependency plus a DOM test environment the
  suite does not otherwise need. The browser e2e suite exercises these components.
- **`.projenrc.ts`**. Projen runs it, not Jest; its output is checked by the tests that
  read generated files.

The test task passes `--coverageThreshold` to Jest with a floor for lines, statements,
branches, and functions, so `npx projen test` (and the CI build that runs it) fails when
coverage drops. The floor is the lower of the CI and local numbers rounded down, minus one more
point on every metric, because the numbers move between environments. V8 counts functions
differently across Node versions, so the CI runner's current Node reads functions over a point lower
than an older local Node does. V8 records one statement per line, so statements equal lines and share the
lines floor. Re-derive the floor by the same rule when the `build` workflow's Node major version changes. It lives on the task rather than in the Jest config, so a bare
`npx jest path/to/file` stays a quick local run that is not held to a whole-tree floor. Any
`projen test` run is held to it, including one narrowed with a path. Raise the floor when tests raise the numbers. Scripts that tests run as child processes
(for example `e2e-serve.cjs`) read as 0%, because Jest's V8 coverage only sees its own
workers. A unit test pins that every tracked source file is either measured or in one of
the two groups above, so a new source directory cannot fall outside the scope unnoticed.

### Workflows

Each browser gate has its own projen-generated workflow — `docs-e2e`, `docs-a11y`,
`docs-lighthouse` — on `pull_request`, `merge_group`, and `workflow_dispatch`; the first two
install their own Chromium. `docs-agent-readiness` runs on the same triggers. These four
share `docs-build`'s concurrency setting: one group per workflow and ref, canceled in progress
only for `pull_request` runs, so a new push to a pull request stops the run for its previous
commit while merge queue and manual runs keep queueing. `dependency-review` runs on
`pull_request` and `merge_group`. None is a required check unless the team opts in via branch
protection.

## Consequences

- Interactive theme regressions and accessibility, performance, and license regressions
  fail a PR check instead of reaching production.
- A stray listener on `4173` cannot affect the e2e suite, parallel worktrees no longer
  contend for a port, and a failure to reserve or bind is a loud error rather than a silent
  substitution — a deliberate trade: a blocked run is recoverable, a green run against the
  wrong build is not. The suite starts a server every run, including locally.
- The browser gates measure the fixture, not production: a regression confined to pages
  outside the fixture, or in the sharded build path, is not caught. Widening coverage means
  extending the fixture, which raises the build cost the fixture exists to avoid.
- The e2e fixture exercises only the `ts` language tree (the one currently generated), so
  language-switcher tests assert the navigation contract (URL rewrite + localStorage
  persistence) rather than other trees' content; the prune script already handles every
  generated language directory (see [multi-language](./2026-10-15-multi-language.md)).
- Playwright's Chromium download (~130MB) adds ~30s to each browser CI job.
- The axe gate spans two files that enable disabled rules by different mechanisms, so a
  reader of the audit alone will not see every gated rule until the separate spec is folded
  in.
- Median-of-three smooths Lighthouse runner noise but triples audit time per page; three
  pages keeps the job inside a normal PR budget.
- A dependency under any other license fails the build and the review gate, so adopting one
  is a deliberate decision.
- Unit coverage cannot quietly drop, and an untested file shows up in the report. A single
  `npx jest path` run is not held to the floor; any `projen test` run is, including one narrowed with a path.

### Rejected alternatives

- **Reuse `vitepress preview` as the e2e server.** Its on-the-fly brotli starves the
  fetch-driven features and resolves paths differently under a non-root base.
- **Keep port `4173` with `reuseExistingServer: false`.** Better, but leaves components
  contending for one number and lets a stray preview block the suite.
- **Verify server identity in the readiness probe.** Makes reuse safe rather than removing
  the shared resource, and needs a build marker the probe must understand.
- **Use Lighthouse's native per-type budget.** Cannot express a combined JS+CSS ceiling.
- **Weaken the Lighthouse score assertion to `warn`.** Withdrawn; the threshold held once the
  API sidebar stopped rendering collapsed subtrees
  ([sidebar navigation](./2026-10-15-sidebar-navigation.md)).
