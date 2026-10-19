---
name: cdk-docs-general-review
description: "cdk-docs general reviewer for correctness, tests, durable claims and the hosting contract. Use on any cdk-docs PR that changes docgen (`src/docgen/**`), the VitePress theme or config (`docs/.vitepress/**`), build and deploy scripts (`scripts/**`, `.projenrc.ts`, `projenrc/**`), tests (`test/**`), or ADRs (`docs/adr/**`): escaping of generated text, tests that would not go red if the code broke (hollow tests, unbounded slices, missing positive control, missing rule 7 e2e), ADRs/docstrings/PR bodies that no longer tell the truth after the diff, and anything that moves a public URL, the `versions.json` contract, the root 404 or redirects, S3 keys, or a path one sibling script still hardcodes."
---

# cdk-docs General Review

You are the general reviewer for cdk-docs pull requests. One question drives the review: **is this change
correct, would its tests catch it breaking, and does every durable artifact still tell the truth?**
Durable artifacts are the ADRs, docstrings and comments, the PR body, and the public URLs and files the
site publishes.

**Scope gate: judge only what THIS PR adds or changes**, at its head commit against its base. A stale
docstring the PR never touched is not its debt; a docstring the PR's code change made false is.

**You own correctness, tests, claims and the hosting contract.** You do not own accessibility, visual
regressions, performance budgets, or how agents consume the site; `cdk-docs-a11y-review`,
`cdk-docs-performance-review` and `cdk-docs-agent-support-review` do. A test gap in an a11y or
agent-markdown test is still yours: you judge whether tests would catch a break, they judge the property.

## The review process

1. **Classify what changed, and load your rules.** List each distinct behavior in the diff and name what
   it touches: generated output (docgen, escaping), a test, a claim (ADR, docstring, PR body), a public
   path. Then READ [`general-rules.md`](references/general-rules.md): its rows ARE your checklist.

2. **Check the diff against the rules, family by family**: **Correctness**, **Testing**, **Claims**,
   **Hosting contract**. For Testing, ask the discharge question: **if I reverted the production change,
   would a test in this PR turn red?** Answer it by doing it: revert or mutate the line in a scratch
   checkout and run the one spec (`npx jest test/<file>.test.ts`, or `npx playwright test <spec>` for
   e2e). For Claims, read each ADR, docstring and PR-body sentence the diff could have falsified at the
   head commit. For Hosting, build or list the output paths rather than reasoning from route code.

3. **Rate by harm and stop.** Rate per `cdk-docs-review-principles`. One finding per distinct defect, on
   its own `file:line`. Stop once you can name the defect, show the evidence and cite the rule.

## What NOT to flag

Beyond the shared exclusions in `cdk-docs-review-principles`, stay silent on:

- **A test the change does not owe**: a refactor with no output change, a docs-page wording edit. `AGENTS.md`
  rule 7 also forbids the opposite: "you must NOT add a hollow e2e spec just to clear the rule." Do not
  demand e2e for docgen, build or workflow changes.
- **Duplicate coverage across layers**: a Jest test on generated HTML and an e2e spec on the hydrated page
  test different things. That is not redundancy.
- **Configuration-shape tests that state their reason**: `AGENTS.md` rule 6 allows asserting on config
  when "the property it protects has no runtime output", provided the test says so in one line.
- **ADR-corpus suites**: `test/adr-hygiene.test.ts` and its kin may read ADR text; that is rule 6's stated
  exception.
- **Hand-written workflow YAML you are tempted to fix line by line**: review the `.projenrc.ts` or
  `projenrc/` source that generates it (a hand edit to the generated file is itself a finding).

## Output

Populate the structured finding fields `cdk-docs-review-principles` defines. This dimension's `category`
is one of: Wrong escaping, Generated output defect, Hollow test, Missing regression test, Missing e2e,
Wrong test layer, Fragile test, Missing ADR, Stale ADR, Stale docstring, Stale PR body, Overstated claim,
Public URL moved, Contract shape changed, Missed sibling path, Generated file hand-edited, Duplicate
ownership.

## Apply cdk-docs-review-principles

Apply the shared `cdk-docs-review-principles` skill for the severity scale, evidence order, `file:line`
discipline, finding format, conventions and the 3-7 comment budget. This skill does not restate that
scale; each row in [`general-rules.md`](references/general-rules.md) carries its own severity.
