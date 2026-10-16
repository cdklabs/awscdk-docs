# Build the Site on One CodeBuild Runner

## Status

Accepted

## Context

The full site cannot be built by one VitePress process: Rollup's chunk graph for ~21k pages needs ~30 GB, so the
build is split into page-balanced shards and merged afterwards
([site generator and build](./2026-10-15-site-generator-and-build.md)). GitHub-hosted runners carry 16 GB, which
forces one runner per shard: a 52-leg matrix where every leg checks out, installs and generates the docs only to
discard most of the output, ships its slice to a merge job as an artifact, and reports its own check. A matrix cannot
be a single required status check, and a job downstream of a failed leg is skipped rather than failed, which branch
protection treats as passing.

`docs:build:sharded` already does the whole build on one machine: it generates once, builds every shard in an
isolated workspace in parallel, then merges, indexes and verifies the site. It only needs a machine large enough to
run several shards at once.

## Decision

Build the site in a single `build` job of `deploy-and-release.yml` on a self-hosted AWS CodeBuild runner.

### Runner and parameters

- **Label.** `codebuild-awscdk-docs-github-actions-runner-${{ github.run_id }}-${{ github.run_attempt }}` routes the
  job to the CodeBuild project; the run ID and attempt make the label unique to the job.
- **Machine.** `BUILD_GENERAL1_2XLARGE` (72 vCPU, 145 GB). A shard is roughly single-core bound, so memory limits
  concurrency: the heaviest shard peaks at ~7.5 GB RSS and fails under a 6 GB heap.
- **Build.** `docs:build:sharded` with 52 shards, an 8192 MB heap and a concurrency of 16, which stays well inside
  memory while using ~20 cores. Every shard carries a fixed ~30 s cost, so more shards lower the per-shard peak but
  lengthen the build.
- **One job, end to end.** The job generates the docs once, builds and merges every shard, indexes the site with
  Pagefind, verifies it and packages the site as the versioned S3 zip with `scripts/package-site.sh`. Packaging
  fails when the zip exceeds 900 MB. The publish job depends on `build` directly
  ([publishing and hosting](./2026-10-15-publishing-and-hosting.md)).
- **Required check.** `build` is the required status check, so a failed shard fails it directly with the shard's
  log tail and nothing downstream can be skipped into a pass.

### Trust model

The same job builds pull requests, merge-queue entries and pushes to `main`, and only the `main` run is published.
Builds stay isolated from each other, so a pull request build cannot affect what gets published.

- **Who can start a build.** The repository is private and forking is disabled, so pull requests come from branches
  pushed by people with write access. Fork pull request workflows would additionally need approval and receive no
  write token, secrets or variables.
- **CodeBuild webhook.** One filter group, `EVENT` = `WORKFLOW_JOB_QUEUED`, for this repository. If the repository
  becomes public or accepts forks, add an anchored allowlist (`^(id1|id2|...)$`) on the webhook actor.
- **A fresh environment per job.** CodeBuild starts one build per workflow job and terminates it when the job
  completes ([CodeBuild-hosted GitHub Actions runner](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner.html)),
  and on-demand compute discards the machine afterwards
  ([CodeBuild compute fleets](https://docs.aws.amazon.com/codebuild/latest/userguide/fleets.html)). The project uses
  on-demand compute and no project cache (`NO_CACHE`), so no state carries over between builds.
- **Dependency cache.** Entries a `pull_request` run saves to the GitHub Actions cache are scoped to its merge ref,
  not the default branch
  ([GitHub dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)),
  and `npm ci` verifies every package against the lockfile.
- **Credentials.** The job asks only for `contents: read`; publishing credentials belong to the publish job. The
  CodeBuild service role carries only what the build needs to run and write its logs.

To review the project configuration:
`aws codebuild batch-get-projects --names cdk-docs-github-actions-runner --query 'projects[0].{webhook:webhook,cache:cache,fleet:environment.fleet,role:serviceRole}'`.

## Consequences

- One job, one log and one check. `docs:generate` and `npm ci` run once per build, the site never leaves the machine
  between building and packaging, and CI runs exactly the path a developer runs locally.
- Wall-clock time is bounded by the shards running 16 at a time; the heaviest wave sets the critical path. Raising
  the shard count lengthens the build instead of adding runners, and changing the compute type or a content change
  that raises the per-shard peak means revisiting the concurrency.
- The build depends on infrastructure outside this repository: the CodeBuild project, its GitHub connection and the
  AWS account that pays for it. A missing or misconfigured project leaves the job queued with no runner.
- Parts of the trust model are configured outside this repository (repository visibility and forking, the
  CodeBuild webhook, compute, cache and service role); changing them means revisiting this ADR.
