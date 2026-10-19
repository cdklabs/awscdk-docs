# General review rules: the lookup

Rows are grouped by family: correctness, testing, claims, hosting contract. See the
`cdk-docs-review-principles` skill for the shared lookup convention: the BLOCKING → RECOMMENDED → OPTIONAL
sort within a family, the conditional-severity encoding, the `(doc-absent detail)` marker, and links
referencing `main`.

## Correctness

**[GEN-CORR-WRONG-ESCAPER] (BLOCKING)**: Dynamic text interpolated into generated HTML or markdown without
the helper for its context, or with the wrong one. `src/docgen/escape.ts`: "Every place that interpolates
dynamic text into generated HTML must go through one of these helpers instead of hand-rolled `.replace()`
chains." `escapeHtml` is for HTML text, `escapeVueText` for raw HTML inside VitePress markdown (adds `{`
and `}` so Vue does not compile it as interpolation), `escapeAttr` for a quoted attribute value.

- **Detection method (doc-absent detail):** for each new `${...}` in a docgen template, name its context.
  Text inside markdown that VitePress compiles needs `escapeVueText`: a jsii docstring containing `{{` breaks
  the Vue compile for the whole page, or renders a template expression. A value inside `title="..."` needs
  `escapeAttr`. A hand-rolled `.replace(/</g, ...)` chain is the finding even when it looks complete.
  Prove it with a fixture string carrying `<`, `{{` and `"`.

  ```ts
  // WRONG: text context helper inside an attribute; a `"` in the summary ends the attribute
  `<a title="${escapeHtml(summary)}">`
  // RIGHT
  `<a title="${escapeAttr(summary)}">`
  ```

**[GEN-CORR-MULTI-CHAR-STRIP] (BLOCKING)**: A single `.replace()` pass removing a multi-character pattern
(tags, comments) from untrusted text. `escape.ts`: "a single `.replace()` pass can re-form the pattern from
the surrounding text." Use `removeAll`.

**[GEN-CORR-OUTPUT-DEFECT] (BLOCKING)**: The generated page, sidebar JSON, symbol index or built asset is
wrong for a reachable input: a member missing, a link pointing at a page that is not emitted, a language
variant rendering another language's code.

- **Detection method (doc-absent detail):** run `npx projen docs:generate` (or the fixture prune) on the
  PR head and read the produced file for one affected type, not the template.

**[GEN-CORR-CODEQL-IN-TEST] (RECOMMENDED)**: New test code that CodeQL will flag (incomplete sanitization,
regex injection, an unanchored URL check). A red security scan on a test file still blocks the PR's checks
and teaches the wrong pattern. Use the `escape.ts` helpers in tests too.

## Testing

**[GEN-TEST-HOLLOW] (BLOCKING)**: A test that stays green when the production change is reverted. `AGENTS.md`
rule 6: "All code changes must include tests." A test that cannot fail does not discharge it.

- **Detection method (doc-absent detail):** revert the production hunk in a scratch checkout and run the
  one spec. Common shapes: a slice taken with `indexOf(start)` to `indexOf(end)` where `end` is `-1` and
  the slice runs to end of file; matching the first of two duplicate CSS rule sets; asserting on comment
  text the matcher did not strip; an assertion that only fails on a TypeScript compile error; `toContain`
  on a string both the old and new output share.

  ```ts
  // HOLLOW: when '.member-row' is absent, end === -1 and the slice runs to EOF
  const block = css.slice(css.indexOf('.member-line'), css.indexOf('.member-row'));
  // BOUNDED: fail loudly when either anchor is missing
  const start = css.indexOf('.member-line');
  const end = css.indexOf('.member-row', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  ```

**[GEN-TEST-MISSING-REGRESSION] (BLOCKING)**: A new behavior or branch ships with no test whose assertion
depends on it. Applied at branch granularity.

**[GEN-TEST-MISSING-E2E] (BLOCKING)**: `AGENTS.md` rule 7: an interactive theme feature (type-ahead filter,
lazy API sidebar, type tooltips, favorites, feedback widget, language switcher, Pagefind search) changed
with no `test/e2e/` spec added or extended, "because Jest unit tests never load the rendered site."

- **Conditional (doc-absent detail):** an e2e spec on the fixture that cannot see the change (the fixture
  prunes to `aws-sns` and `aws-sqs`; a spec on a service the fixture drops is hollow) is
  `GEN-TEST-HOLLOW`, not this rule.

**[GEN-TEST-ASSERTS-CONFIG] (RECOMMENDED)**: A test asserts on configuration source (`config.mts` text,
`.projenrc.ts` text) for a property that has rendered output. `AGENTS.md` rule 6: "Assert on the produced
output — rendered pages, built assets, generated files after `npx projen` — rather than on configuration
source."

- **Conditional:** not a finding when the property has no runtime output and the test states that reason
  in one line (rule 6's carve-out).

**[GEN-TEST-ASSERTS-ADR] (RECOMMENDED)**: An expectation references an ADR's existence, status, headings or
wording. `AGENTS.md` rule 6: "Never reference an ADR in an expectation." Exception: ADR-corpus suites.

**[GEN-TEST-NO-POSITIVE-CONTROL] (RECOMMENDED)**: A "must not contain" or "nothing else matches" assertion
with no check that the collection it filters is non-empty. An empty selector or a renamed class passes it
vacuously. Add one assertion that the thing being searched exists.

**[GEN-TEST-HARDCODED-BASE] (RECOMMENDED)**: A spec or test hardcodes `/cdk/api/` or a server URL instead of
deriving from `SITE_BASE` / `scripts/site-paths.cjs` and the reserved `E2E_SERVE_PORT`. The quality-gates
ADR: "No spec may fall back to a hardcoded server URL." Up-tier BLOCKING for a server URL fallback, which
can make the suite test some other server.

**[GEN-TEST-PRE-HYDRATION] (RECOMMENDED)**: An e2e assertion or retry gate that can pass before the Vue
component mounts (reading static HTML that hydration later replaces, `waitForSelector` on markup present
in SSR output). Wait on a hydration-only signal.

**[GEN-TEST-FIXTURE-FRAGILE] (RECOMMENDED)**: A spec that reds when the fixture content shifts rather than
when the feature breaks: `expect(found).not.toBeNull()` on "some method whose signature wraps at 1280px".
Pick the subject deterministically, or skip with a stated reason when the fixture has no candidate.

## Claims

**[GEN-CLAIM-MISSING-ADR] (RECOMMENDED)**: `AGENTS.md` rule 5: a non-trivial choice (library, architecture,
algorithm) with no ADR "in `docs/adr/` before or alongside the code change."

- **Conditional (doc-absent detail):** when the choice changes a decision an existing ADR records, the fix
  is to update that ADR (or mark it `Superseded` and link the replacement), not to add a second ADR that
  contradicts it. Two accepted ADRs disagreeing is `GEN-CLAIM-STALE-ADR` at BLOCKING.

**[GEN-CLAIM-STALE-ADR] (RECOMMENDED)**: An ADR the diff made false: it states a value, threshold, file
name or mechanism the code no longer has (for example a budget constant the PR retuned). Up-tier BLOCKING
when two accepted ADRs now contradict each other, because a reader cannot tell which is in force.

- **Detection method (doc-absent detail):** grep `docs/adr/` at the PR head for every identifier and
  number the diff changes.

**[GEN-CLAIM-ADR-FORMAT] (RECOMMENDED)**: A new ADR not named `docs/adr/YYYY-MM-DD-short-title.md` or
missing a Status, Context, Decision or Consequences section (`AGENTS.md` § ADR Format), or that relies on
an issue to be understood (`CONV-ISSUE-REFERENCE`).

**[GEN-CLAIM-STALE-DOCSTRING] (RECOMMENDED)**: A docstring or comment adjacent to, or describing, code the
PR changed now states the old behavior. Read it at the head commit, outside the diff hunk too: the stale
line is often a few lines above the change.

**[GEN-CLAIM-STALE-PR-BODY] (RECOMMENDED)**: The PR body describes a design a later commit replaced, or its
verification section names a test or assertion a later commit removed. Report in the summary, not inline.

**[GEN-CLAIM-OVERSTATED] (RECOMMENDED)**: A fails-first or invariant claim the evidence does not support:
"all three tests fail on main" when two do; "the version is always major.minor.patch" when a prerelease
reaches the code path. Name what you ran and what it showed.

## Hosting contract

**[GEN-HOST-URL-MOVED] (BLOCKING)**: A public page path changes shape. The publishing-and-hosting ADR keeps
canonical URLs "at the historical shape" under `https://docs.aws.amazon.com/cdk/api/`
(`/cdk/api/v2/docs/…`). Any change that renames, re-cases or re-nests an emitted page breaks external deep
links. `test/e2e/url-compat.spec.ts` is the guard; a PR that edits it to match new paths is the signal.

- **Detection method (doc-absent detail):** build the fixture at base and head and diff the sorted list of
  emitted `.html` paths. A doubled segment (`/cdk/api/api/v2/…`) means a route constant and the base both
  added the prefix.

**[GEN-HOST-CONTRACT-SHAPE] (BLOCKING)**: The shape of a published machine contract changes:
`cdk/api/versions.json` (fields, absolute URLs), `sitemap.xml`, the zip and manifest naming
(`awscdk-docs-v<cdk version>.zip`). The publishing ADR: "S3 keys are meaningful to consumers." A rename
leaves consumers silently pinned to the last old artifact.

**[GEN-HOST-ROOT-ARTIFACT] (BLOCKING)**: The 404 page, `llms.txt`, or another artifact that must sit at the
deployment root lands under a sub-path, or the reverse.

**[GEN-HOST-SIBLING-PATH] (BLOCKING)**: A path, base or directory change applied to some consumers but not
all. `scripts/site-paths.cjs` is "the single derivation of `base` and `outDir`"; check every script that
reads them (`e2e-fixture-prune.cjs`, `shard-prune.cjs`, `merge-shards.cjs`, `sitemap-merge.cjs`,
`package-site.sh`, `verify-site.sh`, the overlay) and `test/hosting-base.test.ts`.

**[GEN-HOST-GENERATED-EDIT] (BLOCKING)**: A projen-generated file (`.github/workflows/*.yml`, task bodies)
edited by hand. `npx projen` overwrites it on the next run, so the change silently reverts. Edit
`.projenrc.ts` or `projenrc/` and regenerate.

**[GEN-HOST-SHIPPED-KEY] (BLOCKING)**: A shipped localStorage key, query parameter or cookie name renamed.
Users lose stored state (favorites, collapse memory). `AGENTS.md` § Spelling keeps `cdk-docs:favourites`
for this reason.

**[GEN-HOST-DUPLICATE-OWNER] (RECOMMENDED)**: One route, constant or path defined in two places (a literal
beside the route constant in `src/site-routes.ts`). The two drift; derive one from the other.
