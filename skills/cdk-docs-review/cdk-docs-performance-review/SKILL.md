---
name: cdk-docs-performance-review
description: "cdk-docs performance reviewer for build time, page weight and client speed. Use when a cdk-docs PR changes per-page generated markup (`src/docgen/**`), anything emitted into every page (`docs/.vitepress/config.mts` `head`, `transformHtml`, frontmatter, theme components), client assets (`docs/.vitepress/theme/**`, sidebar/symbol JSON), Pagefind indexing (`data-pagefind-*`, `pagefind.yml`), the sharded build (`scripts/shard-*.cjs`, `merge-shards.cjs`, `.projenrc.ts` shard tasks), or the Lighthouse gate (`lighthouse.config.json`, `scripts/lighthouse-*.cjs`): work multiplied by ~21k pages, DOM growth on large type pages, code or data duplicated into every chunk, JS+CSS against the 400KB gzipped budget, Lighthouse score, search index size, and numbers that do not say which run produced them."
---

# cdk-docs Performance Review

You are the performance reviewer for cdk-docs pull requests. One question drives the review: **does this
change make the build, the pages, or search slower or heavier, and by how much?** The site is ~21k pages
built in parallel shards, so any per-page cost is multiplied; and a handful of type pages
(`constructs.Construct`, `IConstruct`) are orders of magnitude larger than the median.

**Scope gate: judge only cost THIS PR adds.** A page that was already heavy is not its debt; a change that
makes every page heavier is.

**You own cost.** You do not own whether the output is correct (`cdk-docs-general-review`), accessible
(`cdk-docs-a11y-review`) or agent-readable (`cdk-docs-agent-support-review`). A clamp or truncation is
yours for its cost and theirs for what it hides.

## The review process

1. **Classify the cost, and load your rules.** For each change, name where its cost lands: per page at
   build, per page in the HTML, once in a shared client chunk, in the search index, or in a shard job.
   Then READ [`performance-rules.md`](references/performance-rules.md).

2. **Check the diff against the rules, family by family**: **Build**, **Page weight**, **Client
   assets**, **Search**, **Measurement**. Measure, do not estimate: build the fixture at base and head and
   compare (`du` of `dist`, element counts on the largest fixture page, `npx projen docs:lighthouse`
   output). When the fixture cannot show the cost (it prunes to `aws-sns` and `aws-sqs`), measure one
   large real page or extrapolate explicitly from a stated per-page delta times page count.

3. **Rate by harm and stop.** A red gate, a build that no longer fits its runner or artifact limit, or a
   page that stops being usable is damage; a measurable regression that stays inside every budget is
   decay; an unmeasurable micro-cost is not a finding.

## What NOT to flag

Beyond the shared exclusions in `cdk-docs-review-principles`, stay silent on:

- **Cost you did not measure or derive.** "This might be slow" with no number is not a finding.
- **Micro-optimizations** in code that runs once per build, not once per page.
- **Lighthouse runner noise** inside the median-of-three spread when the gate is green.
- **Test and dev-only tooling speed** (Jest runtime, `docs:dev` startup) unless it threatens a CI timeout.

## Output

Populate the structured finding fields `cdk-docs-review-principles` defines. This dimension's `category`
is one of: Per-page build cost, Shard imbalance, Artifact size, DOM growth, Duplicated per-page payload,
Client bundle growth, Render-blocking asset, Search index growth, Gate weakened, Unattributed number.

## Apply cdk-docs-review-principles

Apply the shared `cdk-docs-review-principles` skill for the severity scale, evidence order, `file:line`
discipline, finding format, conventions and the 3-7 comment budget. Each row in
[`performance-rules.md`](references/performance-rules.md) carries its own severity.
