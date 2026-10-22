---
name: cdk-docs-review-principles
description: "Shared foundation every cdk-docs review-dimension skill applies: the harm-based severity scale (BLOCKING/RECOMMENDED/OPTIONAL), the evidence authority order and verify-by-running rule, exact file:line, the concrete-fix rule, the 3-7 comment budget, naming the reviewed commit SHA, review tone, the shared what-NOT-to-flag exclusions, the repo-wide conventions (AGENTS.md comments, American spelling, issue numbers, PR template), the finding-output contract (ruleId + reference fields), and the rules-lookup convention. Apply whenever conducting a cdk-docs PR review, rating a finding's severity, deciding whether something is a finding at all, or turning a finding into a posted comment."
---

# Review Principles

The shared base every cdk-docs review-dimension skill (`cdk-docs-general-review`, `cdk-docs-a11y-review`,
`cdk-docs-performance-review`, `cdk-docs-agent-support-review`) applies, so these rules never drift. A
dimension skill decides _what_ it flags and how to calibrate it; it never redefines anything below.

## Severity: rate by the harm it does when it triggers

Ask one question of every finding: **if this ships and a reader, an agent or the deploy reaches this path,
what breaks, and how badly?** That answer sets the tier, not the wording and not how confident you are it
triggers. Three tiers, keyed to the _kind_ of harm:

- **BLOCKING**: the harm is **damage**. Something concretely breaks: a public URL stops resolving, a page
  renders wrong or unescaped, content disappears from search, a gate goes green while the property it
  guards is gone, the deploy publishes a broken site. Must be fixed before merge.
  - _Broken links._ A PR moves the generated page path so `/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html`
    no longer exists. Every external deep link into the reference now 404s. Damage, so BLOCKING.
  - _Hollow gate._ A new test passes with the feature it covers deleted. The suite reports protection the
    repo does not have, so the next regression ships green. BLOCKING.
- **RECOMMENDED**: the harm is **decay**. Nothing breaks today, but the change leaves a latent trap, a
  stale claim, or a maintenance cost that bites a later reader.
  - _Stale docstring._ A comment still describes the layout the PR just replaced. Nothing renders wrong,
    but the next contributor reasons from a false premise. RECOMMENDED.
- **OPTIONAL**: the harm is **negligible**. Pure polish: a naming choice, a tidier grouping with
  identical effect.

A finding's `severity` field takes exactly one of these three words and there is no second vocabulary.
If a source used High/Medium/Low, Critical/Major/Minor or P0/P1/P2, map it onto these three by harm and
drop the palette.

### Calibrate the harm honestly

The tier is right only if you rate the harm honestly. Four ways it slips:

- **Confidence is not severity.** Rate by the harm _when_ the path is reached, not by how sure you are it
  is reached. A concrete failure mechanism is never demoted to OPTIONAL "to be safe."
- **Politeness is not severity.** A blocking issue raised as a gentle question still blocks.
- **No harm, no finding.** Clean code reports nothing. A change that merely _touches_ CSS, a URL or a test
  is not a finding; a concrete new harm is.
- **Only harm this PR introduces.** A pre-existing problem the PR merely moved does zero _new_ harm.
  Rate what the diff adds against the base the PR targets. When the base has moved since the PR opened
  (a gate task renamed, a file split), judge the PR at its merge result, not at its stale base.

When the finding is that the change violates a rule in `AGENTS.md`, `CONTRIBUTING.md` or an accepted ADR,
let the rule's own stated harm set the tier: a rule protecting public output (URLs, rendered content, a
gate's ability to fail) is damage, BLOCKING; a rule stated as a preference (comment style, spelling) is
decay, RECOMMENDED. Cite the rule by file and section and quote it.

## Make each finding land

Every finding carries three things:

- **An exact location**: `path/to/file.ts:L42`, or a range `path/to/file.ts:L42-L50`, on the PR's head
  commit. A finding with no code location stays in the summary as an observation.
- **Evidence**, strongest authority first: behavior you reproduced on the PR head (a build, a test run, a
  mutation that turns a test red or leaves it green, a rendered page) → the repository source at the PR
  head and at the base → `AGENTS.md` and the ADRs in `docs/adr/` → upstream documentation (VitePress,
  Pagefind, Playwright, axe-core, WCAG, schema.org) → the linked issue and PR discussion. Prefer reproduced
  behavior when sources disagree.
  **Verify before you cite.** Never post from reading the diff alone when the claim can be run. A test is
  hollow only once you have broken the code and watched the test stay green; a URL moved only once you
  have built and listed the output; a docstring is stale only once you have read it at the head commit,
  not at the diff hunk. When a finding turns on upstream behavior (a WCAG criterion, a Pagefind attribute,
  a VitePress hook), read the upstream page and cite it in `reference`.
- **A concrete fix**: a code example, or a question framing a specific alternative. Always offer a way
  out; never only point at the problem.

Write in a reviewer's voice: prefer "we" and "consider" over "you should"; frame suggestions as questions
where you can; stay direct but not harsh on blocking issues; acknowledge good work; drop "obviously" and
"simply".

## Keep the review to a tight, high-harm set

Target **3-7 comments per review**. Keep every `BLOCKING` finding; then the highest-harm `RECOMMENDED`
findings; add `OPTIONAL` ones only if the total stays within budget.

A finding becomes a posted inline comment only when it is (1) tied to a specific line, (2) actionable and
(3) significant enough to stand alone. Keep observations, positive notes and clusters of nits in the
review summary.

**The summary always names the reviewed commit** by its short SHA (`Reviewed at 27403917.`), so a reader
can tell whether a later push has already answered it. A PR that moves after review gets a fresh review
at the new head; it does not inherit the old verdict. When a bot or a person edits a comment in place,
re-read it at the current revision rather than relying on the version you first saw.

See [`references/pr-comment-format.md`](references/pr-comment-format.md) for the structured finding
fields and how to write each one before you generate findings.

## Repository conventions every dimension enforces

These rules from `AGENTS.md` apply to any file a PR touches, so each dimension checks them on its own
surface rather than one dimension owning them. Each is a single `CONV-*` rule; cite it by that id.

- **[CONV-COMMENT-DENSITY] (RECOMMENDED)**: `AGENTS.md` rule 8: "Prefer self-documenting code; only
  comment when the code alone doesn't explain what or why ... not a history of how it got there ... Keep
  comments to 120 characters or fewer per line." Flag a new comment that narrates history, alternatives
  or a PR's journey, and a new `describe`/`it` name written as change history. One finding per PR, listing
  the lines.
- **[CONV-ISSUE-REFERENCE] (RECOMMENDED)**: `AGENTS.md` rule 10: "Never cite an issue number in code,
  comments, tests, or ADRs." Up-tier BLOCKING when an ADR depends on the issue to be understood (rule 10:
  "ADRs must be self-contained").
- **[CONV-AMERICAN-SPELLING] (RECOMMENDED)**: `AGENTS.md` § Spelling. Applies to everything the repo
  authors. Never flag upstream jsii docstrings or README text, or shipped values such as the
  `cdk-docs:favourites` localStorage key: renaming those breaks data.
- **[CONV-SCREENSHOT-COMMITTED] (BLOCKING)**: `AGENTS.md` rule 9: "Never commit screenshots." Evidence
  goes in the PR description via `user-attachments` URLs. Evidence hosted on a private fork branch does not
  render for upstream readers; say so in the summary.
- **[CONV-PR-TEMPLATE] (RECOMMENDED)**: the PR body keeps the template's `Fixes #N` line, qualified as
  `owner/repo#N` when the issue lives in another repository, and the contributor statement verbatim. Flag
  it once, in the summary, not inline.
- **[CONV-ADR-FOR-DEPENDENCY] (RECOMMENDED)**: `AGENTS.md` § Constraints: "Do not add dependencies
  without recording the rationale in an ADR." Up-tier BLOCKING for a dependency that ships in the built
  site.

## What NOT to flag: the shared exclusions

Every dimension skill applies these five exclusions on top of its own carve-outs. None is a finding, at
any severity:

- **Pre-existing / not introduced by this PR**: if the diff did not add or change it, it is not this PR's.
- **Cosmetics**: typos, whitespace, formatting, naming preferences, idiom choices. The `CONV-*` rules
  above are the only exceptions, because `AGENTS.md` makes them rules.
- **Outside this dimension's scope**: leave a defect that belongs to another dimension; each reviews
  independently.
- **No nit quota**: when the changed surface is clean, report nothing.
- **Generated and upstream content**: projen-managed files (`.github/workflows/*.yml`, `package.json`
  task bodies, anything carrying the projen marker) are judged through `.projenrc.ts` and `projenrc/`,
  never line by line; jsii docstrings and README text from documented packages render as authored.

Each dimension skill's own `## What NOT to flag` lists only its dimension-specific carve-outs.

## Rules-lookup convention

Each dimension skill keeps its detailed rules in a `references/*-rules.md` lookup. Every lookup shares one
shape: rows grouped by family, sorted BLOCKING → RECOMMENDED → OPTIONAL within each family, `[id]`s
stable. A conditional severity is ONE rule: the row header carries the primary severity, the body states
when it up- or down-tiers. A row marked `(doc-absent detail)` carries reviewer calibration the repo's own
docs do not state, kept in full. All cdklabs/awscdk-docs links reference `main`.

## Sources

- [`AGENTS.md`](https://github.com/cdklabs/awscdk-docs/blob/main/AGENTS.md): workflow rules 1-10, ADR
  format, spelling, constraints.
- [`docs/adr/`](https://github.com/cdklabs/awscdk-docs/tree/main/docs/adr): accepted decisions, in
  particular quality gates, publishing and hosting, SEO and agent discoverability.
- [`.github/pull_request_template.md`](https://github.com/cdklabs/awscdk-docs/blob/main/.github/pull_request_template.md).
