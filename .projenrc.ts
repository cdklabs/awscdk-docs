import { CdkTypeScriptProject } from 'cdklabs-projen-project-types';
import { github, javascript, typescript } from 'projen';
import DOCGEN_CONFIG from './docgen.config.json' with { type: 'json' };
import CDK_PINS from './projenrc/cdk-versions.json' with { type: 'json' };
import { S3DocsPublishing } from './projenrc/s3-docs-publishing.js';
import { alphaModulesOf } from './src/docgen/module-sync.js';
import { alphaVersionForModule } from './src/docgen/pins.js';
import { VERSIONS_JSON_PATH } from './src/docgen/versions.js';

const PROJEN_GITHUB_TOKEN = github.GithubCredentials.fromPersonalAccessToken({
  environment: 'automation',
});

// Self-hosted CodeBuild GitHub Actions runner label. The run_id/run_attempt suffix makes each job claim its own
// ephemeral runner instance. Used by the deploy build job and the PR docs gates (build, docs-e2e, docs-a11y,
// docs-lighthouse, docs-agent-readiness) so they all run on CodeBuild instead of the GitHub-hosted ubuntu image.
const CODEBUILD_RUNNER =
  'codebuild-awscdk-docs-github-actions-runner-${{ github.run_id }}-${{ github.run_attempt }}';

// ---------------------------------------------------------------------------
// Documented CDK ecosystem packages.
//
// Every package here is installed as a devDependency so docgen can load its jsii assembly from node_modules. The
// list of alpha modules is read from docgen.config.json, the one committed source of what the site documents, so
// the nightly cdk-version-check bot adds and removes modules by editing that file and re-running projen.
//
// In-support alpha modules ship in lockstep with the core library: the same CDK release version with an
// `-alpha.0` suffix. Both pins live in projenrc/cdk-versions.json so the same bot rewrites structured data
// instead of running a regex over this file. Out-of-support alphas (superseded or graduated into the core
// library) are absent because the release they are compared against no longer ships them.
const CDK_ALPHA_VERSION = CDK_PINS.cdkAlpha;
const DOCUMENTED_ALPHA_MODULES = alphaModulesOf(DOCGEN_CONFIG.modules);
// Released in lockstep with aws-cdk-lib, so they take its pin.
const CDK_LIB_PACKAGES = ['@aws-cdk/cfn-property-mixins', 'aws-cdk-lib'];
// Released in lockstep with the alpha modules (`<cdk-version>-alpha.0`) but not named `*-alpha`, so the alpha
// module pattern does not catch them and they take the alpha pin by name here.
const CDK_ALPHA_PACKAGES = ['@aws-cdk/mixins-preview'];

// @aws-cdk/toolkit-lib ships no jsii assembly and has its own external docs site.
// @aws-cdk/cloud-assembly-schema is re-exported as the aws-cdk-lib `cloud_assembly_schema` submodule, so
// documenting the standalone package would duplicate its pages.

const project = new CdkTypeScriptProject({
  name: '@cdklabs/awscdk-docs',
  private: true,
  description: 'The AWS CDK API Reference Documentation',
  license: 'Apache-2.0',
  defaultReleaseBranch: 'main',
  packageManager: javascript.NodePackageManager.NPM,
  projenrcTs: true,
  runner: typescript.TypeScriptRunner.tsx(),

  // Combined deploy + release workflow: the GitHub release is only created after the site has been published,
  // so a version tag can never point at unpublished docs. The docs build and publish jobs are added below.
  releaseWorkflowName: 'deploy-and-release',
  minMajorVersion: 1,

  githubOptions: {
    projenCredentials: PROJEN_GITHUB_TOKEN,
    pullRequestLintOptions: {
      contributorStatement:
        'By submitting this pull request, I confirm that my contribution is made under the terms of the Apache 2.0 license.',
      contributorStatementOptions: {
        exemptUsers: ['cdklabs-automation', 'dependabot[bot]'],
      },
      semanticTitleOptions: {
        types: ['fix', 'feat', 'chore', 'docs', 'perf', 'refactor', 'revert'],
      },
    },
  },

  enablePRAutoMerge: true,
  ghAutoMergeOptions: {
    projenCredentials: PROJEN_GITHUB_TOKEN,
  },

  checkLicenses: {
    development: true,
    production: true,
    allow: [
      'MIT',
      'ISC',
      'Apache-2.0',
      'Python-2.0',
      '0BSD',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'BlueOak-1.0.0',
      'CC0-1.0',
      'CC-BY-4.0',
      'CC-BY-3.0',
      'MPL-2.0',
    ],
  },

  // Auto-approve projen's recurring upgrade-main deps PR using projen's built-in label option — the PR only
  // touches the lockfile and .projen bookkeeping, matching the 'auto-approve' label's trust boundary. Approval
  // only grants a review; merge stays gated by the required build check that GitHub auto-merge waits on.
  depsUpgradeOptions: {
    workflowOptions: {
      labels: ['auto-approve'],
    },
  },

  bumpPackage: 'commit-and-tag-version@^13',

  // The package is private and never published, so npm attaches no meaning to the prod/dev split. This repo
  // gives it one: `deps` holds packages whose code or assets ship in the built site or that render its HTML,
  // so `license-checker --production` (and anyone reading package.json) sees exactly what the site is made of.
  // Everything that only generates content, tests, or automates the repo is a devDep.
  deps: [
    // Static site generator: renders every page and ships its client theme runtime in the output.
    'vitepress',
    // Client framework: bundled into the site's JS.
    'vue',
    // Three-state theme picker shares VitePress's appearance state via useColorMode on the same storage key.
    // Bundled into the theme client code.
    '@vueuse/core',
    // Renders every code block's highlighted HTML; declared explicitly because config.mts imports it directly
    // to build a JS-regex-engine highlighter. Pinned to the same major VitePress resolves so both share one
    // shiki instance.
    'shiki@^2.1.0',
    '@shikijs/engine-javascript@^2.1.0',
    // Renders GitHub ```math fences in jsii READMEs into the pages' markup.
    'markdown-it-mathjax3@^4',
    // Static local search: the index and the pagefind.js runtime ship in the output.
    'pagefind',
    'vitepress-plugin-pagefind',
    // Generic UI glyphs for the home page feature cards: concept icons no brand set covers. SVGs are inlined
    // into the rendered pages.
    'lucide-static@^0.542.0',
  ],

  devDeps: [
    // Documented CDK packages: their prose is the site's content, but none of their code ships.
    ...DOCUMENTED_ALPHA_MODULES.map((name) => `${name}@${alphaVersionForModule(CDK_PINS, name)}`),
    ...CDK_ALPHA_PACKAGES.map((name) => `${name}@${CDK_ALPHA_VERSION}`),
    ...CDK_LIB_PACKAGES.map((name) => `${name}@${CDK_PINS.awsCdkLib}`),
    // Docgen reads the documented packages' jsii assemblies to generate the markdown source.
    '@jsii/spec',
    // Agent-oriented Markdown twins: the generated pages carry their member lists and type hierarchy as inline
    // HTML, which a regex cannot walk safely, so the twin renderer parses it (src/docgen/agent-markdown.ts).
    'htmlparser2@^12.0.0',
    // Under ESM the `jest` object is not a global, so the one suite that stubs a module imports it.
    '@jest/globals@^30.5.1',
    // Browser e2e suite for the interactive theme features.
    '@playwright/test',
    // Automated accessibility audit gate.
    '@axe-core/playwright',
    // Lighthouse performance gate.
    'lighthouse@^13.4.0',
    // Agent-readiness gate
    'botvisibility@^3.0.0',
  ],
});

// The upgrade tasks hold every dependency to a 3-day release cooldown, but the documented CDK packages must track the
// newest release, which the nightly cdk-version-check workflow pins. Keep the upgrade tasks off those packages, so a
// cooldown-bound upgrade cannot roll a pin back. The option is construction-only and cdklabs-projen-project-types
// does not forward it, so it is set on the components here; the task steps read it lazily at synth.
const CDK_PINNED_PACKAGES = [...DOCUMENTED_ALPHA_MODULES, ...CDK_ALPHA_PACKAGES, ...CDK_LIB_PACKAGES];
for (const upgrade of project.components.filter((c) => c instanceof javascript.UpgradeDependencies)) {
  const options = (upgrade as unknown as { options: javascript.UpgradeDependenciesOptions }).options;
  (upgrade as unknown as { options: javascript.UpgradeDependenciesOptions }).options = {
    ...options,
    exclude: [...(options.exclude ?? []), ...CDK_PINNED_PACKAGES],
  };
}

// The default no-extraneous-dependencies setup assumes prod deps are "what src/ imports at runtime", which is
// meaningless for an unpublished static-site repo. Docgen (src/) may import devDeps: it runs at build time and
// nothing it imports ships in the site.
project.eslint?.allowDevDeps('src/**');

// GitHub Actions version pins

// Generate API docs markdown from jsii assemblies (module list in docgen.config.json).
const docsGenerate = project.addTask('docs:generate', {
  description: 'Generate API docs from jsii assemblies',
  exec: 'tsx src/docgen/cli.ts',
});

// Bring the version-history ledger up to the installed assemblies. The only writer of docgen.baseline.json: the docs
// build reads it and never writes it, so builds stay reproducible and parallel shards never race one file.
project.addTask('docs:baseline', {
  description: 'Update the version-history ledger from the installed jsii assemblies',
  exec: 'tsx src/docgen/cli.ts --update-ledger',
});

// Attribution for the production dependency tree, committed at the repo root and linked from the site footer.
// Runs inside build so a dependency change regenerates it and the build's self-mutation step commits the result.
const thirdPartyLicenses = project.addTask('third-party-licenses', {
  description: 'Regenerate THIRD_PARTY_LICENSES from the production dependency tree',
  exec: 'tsx src/docgen/cli.ts --third-party-licenses',
});
project.postCompileTask.spawn(thirdPartyLicenses);
project.tasks.tryFind('post-upgrade')?.spawn(thirdPartyLicenses);

// Install the documented modules from a release candidate's dist, so the release pipeline can build the site before
// the candidate is on npm. Exits non-zero without CDK_DIST_DIR, since the task has nothing else to do.
project.addTask('docs:dist:install', {
  description: 'Install the documented CDK modules from $CDK_DIST_DIR instead of the registry pins',
  exec: 'tsx src/docgen/dist-install-cli.ts',
});

// Structured edit of the CDK version pins, used by the nightly cdk-version-check workflow:
// `npx projen cdk:pin awsCdkLib 2.269.0`.
project.addTask('cdk:pin', {
  description: 'Set a CDK version pin in projenrc/cdk-versions.json',
  exec: 'tsx src/docgen/pins-cli.ts',
  receiveArgs: true,
});

// Nightly version refresh in two phases: plan (queries the registry) runs first, then apply (offline), then the
// version-history ledger is updated from the newly installed release.
project.addTask('versions:plan', {
  description: 'Resolve released CDK versions and record what the nightly refresh would change',
  exec: 'tsx src/docgen/version-refresh-cli.ts --plan',
});
project.addTask('versions:apply', {
  description: 'Apply the planned version refresh to the pins and the committed snapshot',
  exec: 'tsx src/docgen/version-refresh-cli.ts --apply',
});
project.addTask('versions:pr-body', {
  description: 'Render the nightly version refresh PR body from the recorded plan',
  exec: 'tsx src/docgen/version-refresh-cli.ts --pr-body',
});

// Nightly module-list sync, the same two phases: plan (reads the aws-cdk release tag and the registry), then
// apply (offline) rewrites docgen.config.json, then projen regenerates package.json from it.
project.addTask('modules:plan', {
  description: 'Diff the documented alpha modules against the aws-cdk release the pins name',
  exec: 'tsx src/docgen/module-sync-cli.ts --plan',
});
project.addTask('modules:apply', {
  description: 'Apply the planned module-list sync to docgen.config.json',
  exec: 'tsx src/docgen/module-sync-cli.ts --apply',
});
project.addTask('modules:pr-body', {
  description: 'Render the nightly module-list sync PR body from the recorded plan',
  exec: 'tsx src/docgen/module-sync-cli.ts --pr-body',
});

// Scratch files the plan phases hand to the apply phases within one run.
project.gitignore.addPatterns('.version-plan.json', '.module-plan.json');

// VitePress docs tasks. No explicit heap flags: Node sizes the heap from machine memory. The CI shard build is
// the one deliberate exception and passes --heap explicitly (see addDocsBuildJob).
const docsDev = project.addTask('docs:dev', {
  description: 'Start VitePress dev server',
  exec: 'vitepress dev docs',
});
docsDev.prependSpawn(docsGenerate);

const docsBuild = project.addTask('docs:build', {
  description: 'Build VitePress site for production',
  exec: 'vitepress build docs',
});
docsBuild.prependSpawn(docsGenerate);

// Vite transpiles docs/.vitepress with esbuild, which strips types without checking them, and the main
// tsconfig covers only src/**/*.ts — so this directory needs a pass of its own. `.vue` bodies stay unchecked:
// that needs vue-tsc, and the ambient `*.vue` shim keeps their imports resolvable here.
new javascript.TypescriptConfig(project, {
  fileName: 'tsconfig.vitepress.json',
  include: ['docs/.vitepress/**/*.ts', 'docs/.vitepress/**/*.mts'],
  compilerOptions: {
    noEmit: true,
    strict: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: javascript.TypeScriptModuleResolution.BUNDLER,
    lib: ['es2022', 'dom', 'dom.iterable'],
    types: ['node', 'vite/client'],
    // scripts/site-paths.cjs is imported by config.mts and has no declarations.
    allowJs: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
  },
});

const docsTypecheck = project.addTask('docs:typecheck', {
  description: 'Type-check the VitePress config and theme sources',
  exec: 'tsc --noEmit -p tsconfig.vitepress.json',
});
project.testTask.spawn(docsTypecheck);

project.addTask('docs:merge', {
  description: 'Merge per-shard dist trees into the built site directory (args: <shardDist...>)',
  // The site directory follows DOCS_BASE, so derive it rather than
  // hardcoding the flat dist: set, this merges into
  // docs/.vitepress/dist/cdk/api; unset (local), the flat dist.
  exec: 'node scripts/merge-shards.cjs "$(node -p "require(\'./scripts/site-paths.cjs\').distDir()")"',
  receiveArgs: true,
});

// The production build, locally and in CI: docs:generate once, then prune+build every shard in an isolated
// workspace in parallel, merge, index and verify. See scripts/local-shard-build.sh --help for the knobs.
project.addTask('docs:build:sharded', {
  description: 'Sharded parallel production build on this machine (args: see --help)',
  exec: 'bash scripts/local-shard-build.sh',
  receiveArgs: true,
});

project.addTask('docs:preview', {
  description: 'Preview VitePress production build',
  exec: 'vitepress preview docs',
});

// Browser e2e suite. Playwright drives the built site in a real Chromium, covering the interactive theme
// features the Jest unit suite cannot reach (type-ahead filter, language switcher, favorites, feedback widget,
// hover tooltips, Pagefind search, lazy API sidebar). The full site is too heavy to rebuild per run, so the
// task builds a small fixture: full docs:generate, pruned to a couple of services, then a single-shot VitePress
// build with Pagefind indexing. Not part of the default `build` task — too slow/heavy, runs in its own workflow.
// The fixture site carries the agent Markdown twins like the deployed site does, so the footer link and its
// alternate-link head tag point at files that resolve under test.
const OVERLAY_AGENT_MARKDOWN =
  'node scripts/agent-markdown-overlay.cjs dist-agent-markdown "$(node -p "require(\'./scripts/site-paths.cjs\').distDir()")"';
const docsE2e = project.addTask('docs:e2e', {
  description: 'Build the e2e fixture site and run the Playwright browser suite',
});
docsE2e.spawn(docsGenerate);
docsE2e.exec('node scripts/e2e-fixture-prune.cjs');
docsE2e.exec('vitepress build docs');
docsE2e.exec(OVERLAY_AGENT_MARKDOWN);
docsE2e.exec('playwright test --config test/e2e/playwright.config.ts --grep-invert @a11y', { receiveArgs: true });

// Accessibility audit gate. Same fixture build as docs:e2e, then axe-core in a real browser. A separate task
// and workflow, split by the @a11y tag, so an accessibility regression and a broken interactive feature are
// never the same failure. Not in `build`: it needs a built site and a browser.
const docsA11y = project.addTask('docs:a11y', {
  description: 'Build the e2e fixture site and run the axe-core accessibility audit',
});
docsA11y.spawn(docsGenerate);
docsA11y.exec('node scripts/e2e-fixture-prune.cjs');
docsA11y.exec('vitepress build docs');
docsA11y.exec(OVERLAY_AGENT_MARKDOWN);
docsA11y.exec('playwright test --config test/e2e/playwright.config.ts --grep @a11y', { receiveArgs: true });

// Keep the Playwright specs out of the Jest unit suite: both live under test/, but jest would fail parsing
// @playwright/test's test.describe blocks (and the e2e suite needs a built site + browser anyway).
project.jest!.addIgnorePattern('/test/e2e/');

// Playwright run artifacts (report + traces on failure)
project.gitignore.addPatterns(
  'test/e2e/playwright-report/',
  'test/e2e/test-results/',
);

// PR before/after evidence goes in the PR body via GitHub's upload, never the repo tree (AGENTS.md rule 9).
project.gitignore.addPatterns('screenshots/');

// Dedicated e2e workflow (projen-generated), separate from the sharded docs build. Playwright installs its own
// Chromium (--with-deps), so no system browser is needed on the runner. Not a required check unless the team
// opts in via branch protection.
const docsE2eWorkflow = project.github!.addWorkflow('docs-e2e');
docsE2eWorkflow.on({ pullRequest: {}, mergeGroup: {}, workflowDispatch: {} });
docsE2eWorkflow.addJob('e2e', {
  runsOn: [CODEBUILD_RUNNER],
  permissions: {
    contents: github.workflows.JobPermission.READ,
  },
  steps: [
    { uses: github.ActionRefs.ACTIONS_CHECKOUT },
    {
      uses: github.ActionRefs.ACTIONS_SETUP_NODE,
      with: {
        'node-version': '22',
        'cache': 'npm',
      },
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
    {
      name: 'Install Playwright Chromium',
      run: 'npx playwright install --with-deps chromium',
    },
    {
      name: 'Run browser e2e suite',
      run: 'npx projen docs:e2e',
    },
    {
      name: 'Upload Playwright report',
      if: 'failure()',
      uses: github.ActionRefs.ACTIONS_UPLOAD_ARTIFACT,
      with: {
        'name': 'playwright-report',
        'path': 'test/e2e/playwright-report',
        'retention-days': 7,
      },
    },
  ],
});

// Dedicated accessibility audit workflow (projen-generated). Mirrors docs-e2e: Playwright brings its own
// Chromium so no system browser is needed on the runner. Separate from docs-e2e so a red a11y gate is legible
// on its own in the checks list.
const docsA11yWorkflow = project.github!.addWorkflow('docs-a11y');
docsA11yWorkflow.on({ pullRequest: {}, mergeGroup: {}, workflowDispatch: {} });
docsA11yWorkflow.addJob('a11y', {
  runsOn: [CODEBUILD_RUNNER],
  permissions: {
    contents: github.workflows.JobPermission.READ,
  },
  steps: [
    { uses: github.ActionRefs.ACTIONS_CHECKOUT },
    {
      uses: github.ActionRefs.ACTIONS_SETUP_NODE,
      with: {
        'node-version': '22',
        'cache': 'npm',
      },
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
    {
      name: 'Install Playwright Chromium',
      run: 'npx playwright install --with-deps chromium',
    },
    {
      name: 'Run accessibility audit',
      run: 'npx projen docs:a11y',
    },
    {
      name: 'Upload Playwright report',
      if: 'failure()',
      uses: github.ActionRefs.ACTIONS_UPLOAD_ARTIFACT,
      with: {
        'name': 'a11y-report',
        'path': 'test/e2e/playwright-report',
        'retention-days': 7,
      },
    },
  ],
});

// Lighthouse performance gate. Audits the small e2e fixture
// site — the budget under test is the shared theme JS/CSS every page loads
// identically, so a representative handful is enough. Two gates: the median
// performance score (scripts/lighthouse-run.cjs) and the combined gzipped
// JS+CSS budget (scripts/lighthouse-budget.cjs).
const docsLighthouse = project.addTask('docs:lighthouse', {
  description: 'Build the fixture site and run the Lighthouse performance gate',
});
docsLighthouse.spawn(docsGenerate);
docsLighthouse.exec('node scripts/e2e-fixture-prune.cjs');
docsLighthouse.exec('vitepress build docs');
docsLighthouse.exec('node scripts/lighthouse-run.cjs');
docsLighthouse.exec('node scripts/lighthouse-budget.cjs');

// Lighthouse run artifacts
project.gitignore.addPatterns('.lighthouseci/');

// Dedicated workflow, separate from the sharded docs build and the accessibility gate, so a red performance
// gate is legible on its own in the checks list. Chrome ships on the runner image, so no browser install
// step is needed. Not a required check unless the team opts in via branch protection.
const lighthouseWorkflow = project.github!.addWorkflow('docs-lighthouse');
lighthouseWorkflow.on({ pullRequest: {}, mergeGroup: {}, workflowDispatch: {} });
lighthouseWorkflow.addJob('lighthouse', {
  runsOn: [CODEBUILD_RUNNER],
  permissions: {
    contents: github.workflows.JobPermission.READ,
  },
  steps: [
    { uses: github.ActionRefs.ACTIONS_CHECKOUT },
    {
      uses: github.ActionRefs.ACTIONS_SETUP_NODE,
      with: {
        'node-version': '22',
        'cache': 'npm',
      },
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
    {
      name: 'Run Lighthouse performance gate',
      run: 'npx projen docs:lighthouse',
    },
    {
      name: 'Upload Lighthouse reports',
      if: 'always()',
      uses: github.ActionRefs.ACTIONS_UPLOAD_ARTIFACT,
      with: {
        'name': 'lighthouse-reports',
        'path': '.lighthouseci',
        'retention-days': 7,
      },
    },
  ],
});

// Agent-readiness gate. Scans the built fixture site
// with the botvisibility CLI and asserts the reported readiness level against
// the floor in agent-readiness.config.json. The CLI exits 0 whether its checks
// pass or fail, so scripts/agent-readiness-run.cjs derives the verdict from the
// parsed report instead of the exit status.
const docsAgentReadiness = project.addTask('docs:agent-readiness', {
  description: 'Build the fixture site and run the agent-readiness gate',
});
docsAgentReadiness.spawn(docsGenerate);
docsAgentReadiness.exec('node scripts/e2e-fixture-prune.cjs');
docsAgentReadiness.exec('vitepress build docs');
docsAgentReadiness.exec('node scripts/agent-readiness-run.cjs');

// Agent-readiness run artifacts
project.gitignore.addPatterns('.agent-readiness/');

// Its own workflow, for the same reason the Lighthouse gate has one: a red
// readiness gate should be legible on its own in the checks list. The scan is
// plain HTTP against the local server, so no browser install step is needed.
const agentReadinessWorkflow = project.github!.addWorkflow('docs-agent-readiness');
agentReadinessWorkflow.on({ pullRequest: {}, mergeGroup: {}, workflowDispatch: {} });
agentReadinessWorkflow.addJob('agent-readiness', {
  runsOn: [CODEBUILD_RUNNER],
  permissions: {
    contents: github.workflows.JobPermission.READ,
  },
  steps: [
    { uses: github.ActionRefs.ACTIONS_CHECKOUT },
    {
      uses: github.ActionRefs.ACTIONS_SETUP_NODE,
      with: {
        'node-version': '22',
        'cache': 'npm',
      },
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
    {
      name: 'Run agent-readiness gate',
      run: 'npx projen docs:agent-readiness',
    },
    {
      name: 'Upload agent-readiness report',
      if: 'always()',
      uses: github.ActionRefs.ACTIONS_UPLOAD_ARTIFACT,
      with: {
        'name': 'agent-readiness-report',
        'path': '.agent-readiness',
        'retention-days': 7,
      },
    },
  ],
});

// Exclude VitePress build artifacts and generated API docs from git
project.gitignore.addPatterns(
  'docs/.vitepress/dist/',
  'docs/.vitepress/cache/',
  'docs/.vitepress/.temp/',
  // Generated API tree, including the /v2/ overview page from the aws-cdk-lib root README
  'docs/v2/',
  // Agent-oriented Markdown twins of the generated pages, overlaid onto the built site by the shard merge
  'dist-agent-markdown/',
  // Symbol index for the navbar type-ahead filter
  'docs/public/symbols.json',
  // Lazy-loaded API sidebar tree, symbol index and type-summary lookup, all content-hashed
  'docs/public/api-sidebar/',
  // Machine-readable versions endpoint, emitted at build time
  'docs/public/versions.json',
);

// The docs site is built by one job definition (addDocsBuildJob below) rendered into two workflows:
//
// - `docs-build` runs it on pull requests and in the merge queue, so docs-build breakage is caught before merge.
//   It only builds: no release, publish or tag job, no environment and no secrets.
// - `deploy-and-release` (projen-managed release workflow) runs it on pushes to main and on manual dispatch, then
//   publishes and releases. Job graph:
//
//     build ───┬─> release_docs_<stream> ─> release_github
//     release ─┘
//
// Projen's Release component generates `release` (version bump and changelog) and `release_github` (the GitHub
// release, which also creates the tag); the build and publish jobs are folded in here. `release` needs nothing
// from the build, so the two run side by side. The GitHub release comes last and needs every publish job, so a
// version is only tagged once the site is published.
//
// Keeping the two apart lets maintainers disable `deploy-and-release` to stop releases and publishing without
// removing the required `build-docs` check from pull requests and the merge queue.
const combined = project.github!.tryFindWorkflow('deploy-and-release')!;
const docsBuildWorkflow = project.github!.addWorkflow('docs-build');
docsBuildWorkflow.on({ pullRequest: {}, mergeGroup: {} });

// Number of parallel build shards. Rollup's chunk-graph memory is superlinear in per-shard content, so the
// heaviest page-balanced slice can OOM-kill the 16 GB runner. The prune plan balances page count while the
// bundle peak tracks per-page content, so denser markup forces a higher shard count; 52 caps the heaviest
// slice below every shard size that has failed. The peak is not monotonic in the count (48 packs worse than
// 40), so verify the byte peak when moving it. The plan is a pure function of SHARD_TOTAL and docs:merge
// unions every shard, so the count is safe to raise.
const DOCS_BUILD_SHARDS = 52;

// Hosted path of the deployed site. The publishing target takes no loose files at the artifact root, so the
// built tree MIRRORS the URL: `DOCS_BASE` drives both the VitePress `base` and its `outDir`
// (scripts/site-paths.cjs), and the artifact root holds one directory (`cdk/`). Site routes are base-relative
// (`/v2/…`, `/versions.json`), so this base completes the historical public URLs (`/cdk/api/v2/docs/…`).
// The literal exists for GitHub Actions fields that take no shell; test/hosting-base.test.ts pins it against
// the same derivation.
const SITE_BASE = '/cdk/api/';
const DIST_ROOT = 'docs/.vitepress/dist';
// Publish jobs also skip a version that is already tagged, as the GitHub release does.
const NOT_YET_RELEASED = "needs.release.outputs.tag_exists != 'true'";
// The S3 docs stream; S3DocsPublishing names its job after it.
const DOCS_STREAM = 'awscdk-docs';

// Single build job on a self-hosted CodeBuild runner: builds every shard in parallel on one large machine, then
// merges, indexes with Pagefind and verifies, all inside docs:build:sharded. This is the required `build-docs`
// check; the name keeps it apart from the `build` check of projen's build workflow, which is also required.
// Required checks match the job's check name, not the workflow, so both workflows report `build-docs`. Defined
// once and added to both workflows, so the PR build and the release build cannot drift apart
// (test/publish.test.ts compares the two rendered jobs).
const addDocsBuildJob = (workflow: github.GithubWorkflow) => workflow.addJob('build', {
  name: 'build-docs',
  runsOn: [CODEBUILD_RUNNER],
  permissions: {
    contents: github.workflows.JobPermission.READ,
  },
  steps: [
    {
      uses: github.ActionRefs.ACTIONS_CHECKOUT,
      with: {
        // Full history needed for VitePress git-based lastUpdated timestamps
        'fetch-depth': 0,
      },
    },
    {
      uses: github.ActionRefs.ACTIONS_SETUP_NODE,
      with: {
        'node-version': '22',
        'cache': 'npm',
      },
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
    {
      // The runner is a CodeBuild 2xlarge (72 vCPU, 145 GB). The heaviest shard peaks at ~7.5 GB RSS and fails
      // under a 6 GB heap, so an 8 GB cap leaves headroom; 16 at once stays within memory and uses ~20 cores.
      name: 'Build docs',
      run: `npx projen docs:build:sharded -- --num-shards ${DOCS_BUILD_SHARDS} --heap 8192 --concurrency 16`,
      env: {
        DOCS_BASE: SITE_BASE,
      },
    },
    {
      // Runs on every build. The zip file name must match the S3DocsPublishing artifactPath below.
      name: 'Package docs site for S3 publishing',
      run: `bash scripts/package-site.sh ${DIST_ROOT} cdk-docs-site.zip`,
    },
    {
      name: 'Upload docs site zip',
      uses: github.ActionRefs.ACTIONS_UPLOAD_ARTIFACT,
      with: {
        'name': 'docs-site',
        'path': 'cdk-docs-site.zip',
        'retention-days': 1,
        // The zip is already compressed.
        'compression-level': 0,
      },
    },
  ],
});
addDocsBuildJob(docsBuildWorkflow);
addDocsBuildJob(combined);

// One group per ref, so PR builds run independently of each other. A new push to a PR supersedes its running
// build, so cancel it rather than delay the latest commit; merge queue runs keep queueing.
docsBuildWorkflow.file!.addOverride('concurrency', {
  'group': '${{ github.workflow }}-${{ github.ref }}',
  'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
});

// `release` runs on main only, including dry runs, which are dispatched on main.
combined.file!.addOverride('jobs.release.if', "github.ref == 'refs/heads/main'");

// Projen's release concurrency group is workflow-wide; scope it per ref so pushes to main serialize (the removed
// anti-race gate below relies on that) and a branch dry run does not wait on main. Runs never cancel each other,
// so main deploys in order.
combined.file!.addOverride('concurrency.group', '${{ github.workflow }}-${{ github.ref }}');
combined.file!.addOverride('concurrency.cancel-in-progress', false);

// Restore GitHub Releases + drop the redundant release build.
//
// The `release` job only needs the version/changelog/tag metadata for `gh release create`; the site is built by
// the build job. Drop the full `build` spawn from projen's release task so the release job is seconds, not
// minutes.
const releaseTask = project.tasks.tryFind('release')!;
releaseTask.reset('rm -fr dist');
releaseTask.spawn(project.tasks.tryFind('bump')!);
releaseTask.spawn(project.tasks.tryFind('unbump')!);
releaseTask.exec('git diff --ignore-space-at-eol --exit-code');

// Projen's default anti-race gate skips publishing when main has moved on (`latest_commit == github.sha`). With
// the build and publish jobs ahead of the GitHub release, main often has newer commits by then,
// so deployed commits stopped getting tagged. The gate is redundant here: pushes to main serialize through the
// per-ref concurrency group above, so no two release jobs can race. Keep only the tag-already-exists guard.
combined.file!.addDeletionOverride('jobs.release.steps.7.if'); // Backup artifact permissions
combined.file!.addDeletionOverride('jobs.release.steps.8.if'); // Upload artifact

// The GitHub release, and with it the tag, waits for the publish job. On a dry run the publish job is
// skipped, which would skip this job too, so it runs unless a needed job failed; its release step keeps
// projen's own dry-run guard.
combined.file!.addOverride('jobs.release_github.needs', ['release', `release_docs_${DOCS_STREAM}`]);
combined.file!.addOverride(
  'jobs.release_github.if',
  `!cancelled() && !failure() && needs.release.result == 'success' && ${NOT_YET_RELEASED}`,
);

// Publish target: a versioned zip of the merged site goes to S3, modelled on
// aws-cdk-cli's S3DocsPublishing. The vars live on the `release` GitHub environment; artifactPath names the zip
// the build job packages above. The artifact is versioned by the documented aws-cdk-lib, read at publish time
// from the api/versions.json inside the site zip, so the manifest can never disagree with the artifact.
new S3DocsPublishing(project, {
  docsStream: DOCS_STREAM,
  artifactPath: 'cdk-docs-site.zip',
  bucketName: '${{ vars.DOCS_BUCKET_NAME }}',
  roleToAssume: '${{ vars.PUBLISH_CDK_REF_DOCS_ROLE_ARN }}',
  s3PathPrefix: 'awscdk-docs',
  // The dist tree mirrors the hosted URL, so the endpoint sits under
  // the site base inside the zip, not at its root. Composed from the
  // emitter's own path constant, so the reader cannot drift from the writer.
  versionsJsonPath: `${SITE_BASE.replace(/^\//, '')}${VERSIONS_JSON_PATH}`,
});

// Automated CDK version tracking: daily refresh of everything this repo pins or displays. One run resolves the
// released versions, applies whatever moved (the aws-cdk-lib pin, the alpha pin, the committed version snapshot),
// updates the version-history ledger from the newly installed release and opens a single auto-merging PR. A
// follow-up job files an alert issue on failure.
const versionCheck = project.github!.addWorkflow('cdk-version-check');
versionCheck.on({
  schedule: [{ cron: '0 6 * * *' }],
  workflowDispatch: {},
});

versionCheck.addJob('check', {
  runsOn: ['ubuntu-latest'],
  permissions: {
    contents: github.workflows.JobPermission.WRITE,
    pullRequests: github.workflows.JobPermission.WRITE,
  },
  environment: 'automation',
  env: {
    GH_TOKEN: '${{ github.token }}',
  },
  steps: [
    { uses: github.ActionRefs.ACTIONS_CHECKOUT },
    {
      uses: github.ActionRefs.ACTIONS_SETUP_NODE,
      with: { 'node-version': '22', 'cache': 'npm' },
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
    {
      // Queries the registry and records the plan; every judgment it makes is a unit-tested pure function in
      // src/docgen/version-bump.ts, including the check that every documented alpha module has published a
      // version before the alpha pin moves to it.
      name: 'Plan version refresh',
      id: 'detect',
      run: 'npx projen versions:plan',
    },
    {
      name: 'Apply version refresh',
      if: 'steps.detect.outputs.changed == \'true\'',
      run: [
        'npx projen versions:apply',
        // Regenerate package.json without installing against the stale lockfile, then update the lockfile.
        'npx projen --no-post',
        'npm install',
      ].join('\n'),
    },
    {
      // Must follow the apply step: the ledger diffs the newly installed release against the recorded shapes, so
      // the new assemblies have to be in node_modules. Gated on a pin moving: a snapshot-only night installs
      // nothing new, and the update would be a no-op anyway. An alpha-only run still updates it.
      name: 'Update version-history ledger from the new release',
      if: 'steps.detect.outputs.core != \'\' || steps.detect.outputs.alpha != \'\'',
      run: 'npx projen docs:baseline',
    },
    {
      name: 'Prepare PR body',
      if: 'steps.detect.outputs.changed == \'true\'',
      run: [
        'npx projen versions:pr-body > /tmp/pr-body.md',
        // The aws-cdk release notes for a core bump — a network call, so
        // it stays in the workflow rather than in the pure plan.
        'CORE="${{ steps.detect.outputs.core }}"',
        'if [ -n "$CORE" ]; then',
        '  {',
        '    echo ""',
        '    echo "## Changelog"',
        '    echo ""',
        '    gh api "repos/aws/aws-cdk/releases/tags/v$CORE" --jq .body 2>/dev/null | head -100 || echo "_No release notes found for v$CORE._"',
        '  } >> /tmp/pr-body.md',
        'fi',
        '{',
        '  echo ""',
        '  echo "---"',
        '  echo "By submitting this pull request, I confirm that my contribution is made under the terms of the Apache 2.0 license."',
        '} >> /tmp/pr-body.md',
      ].join('\n'),
    },
    {
      name: 'Open version update PR',
      if: 'steps.detect.outputs.changed == \'true\'',
      uses: github.ActionRefs.PETER_EVANS_CREATE_PULL_REQUEST,
      with: {
        // The default GITHUB_TOKEN cannot create pull requests, and PRs it creates would not trigger CI
        // workflows. Use the PROJEN_GITHUB_TOKEN PAT instead (same token projen's self-mutation workflow uses).
        'token': '${{ secrets.PROJEN_GITHUB_TOKEN }}',
        // Fixed branch: one PR carries the core pin, the alpha pin and the snapshot.
        'branch': 'chore/cdk-version-bot/refresh-cdk-versions',
        'commit-message': 'chore: refresh CDK versions',
        'title': 'chore: refresh CDK versions',
        'body-path': '/tmp/pr-body.md',
        // Pre-vetted, mechanically-generated bump — auto-approved so it only needs a green build to merge.
        'labels': 'auto-approve',
      },
    },
  ],
});

// Module-list sync: the alpha packages aws-cdk ships at the pinned release, diffed against docgen.config.json.
// A separate job with its own branch and no auto-approve label: a list change adds or deletes a whole module's
// pages, so a human merges it, unlike the mechanical version bump above.
versionCheck.addJob('sync-modules', {
  runsOn: ['ubuntu-latest'],
  permissions: {
    contents: github.workflows.JobPermission.WRITE,
    pullRequests: github.workflows.JobPermission.WRITE,
  },
  environment: 'automation',
  env: {
    GH_TOKEN: '${{ github.token }}',
  },
  steps: [
    { uses: github.ActionRefs.ACTIONS_CHECKOUT },
    {
      uses: github.ActionRefs.ACTIONS_SETUP_NODE,
      with: { 'node-version': '22', 'cache': 'npm' },
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
    {
      // Reads packages/@aws-cdk at the aws-cdk tag matching the core pin and the registry; fails the job when
      // either cannot be read, so an outage never reads as "no alpha modules".
      name: 'Plan module sync',
      id: 'modules',
      run: 'npx projen modules:plan',
    },
    {
      name: 'Apply module sync',
      if: 'steps.modules.outputs.changed == \'true\'',
      run: [
        'npx projen modules:apply',
        'npx projen --no-post',
        'npm install',
      ].join('\n'),
    },
    {
      // Must follow the apply step: a newly documented module's types are absent from the checked-in ledger, and
      // the build asserts the ledger already matches the install, so the sync has to carry the new rows with it.
      name: 'Update version-history ledger from the new module list',
      if: 'steps.modules.outputs.changed == \'true\'',
      run: 'npx projen docs:baseline',
    },
    {
      name: 'Prepare PR body',
      if: 'steps.modules.outputs.changed == \'true\'',
      run: [
        'npx projen modules:pr-body > /tmp/module-pr-body.md',
        '{',
        '  echo ""',
        '  echo "---"',
        '  echo "By submitting this pull request, I confirm that my contribution is made under the terms of the Apache 2.0 license."',
        '} >> /tmp/module-pr-body.md',
      ].join('\n'),
    },
    {
      name: 'Open module sync PR',
      if: 'steps.modules.outputs.changed == \'true\'',
      uses: github.ActionRefs.PETER_EVANS_CREATE_PULL_REQUEST,
      with: {
        'token': '${{ secrets.PROJEN_GITHUB_TOKEN }}',
        'branch': 'chore/cdk-version-bot/sync-modules',
        'commit-message': 'chore: sync documented alpha modules with aws-cdk',
        'title': 'chore: sync documented alpha modules with aws-cdk',
        'body-path': '/tmp/module-pr-body.md',
      },
    },
  ],
});

versionCheck.addJob('alert-on-failure', {
  needs: ['check', 'sync-modules'],
  runsOn: ['ubuntu-latest'],
  if: '${{ failure() }}',
  permissions: {
    issues: github.workflows.JobPermission.WRITE,
  },
  env: {
    GH_TOKEN: '${{ github.token }}',
  },
  steps: [
    {
      name: 'File failure alert issue',
      env: {
        GH_REPO: '${{ github.repository }}',
      },
      run: [
        'TITLE="cdk-version-check pipeline failed"',
        'BODY="The scheduled aws-cdk version and module tracking workflow failed: ${{ github.server_url }}/$GH_REPO/actions/runs/${{ github.run_id }}"',
        'EXISTING=$(gh issue list -R "$GH_REPO" --state open --search "$TITLE in:title" --json number --jq \'.[0].number\')',
        'if [ -n "$EXISTING" ]; then',
        '  gh issue comment "$EXISTING" -R "$GH_REPO" --body "$BODY"',
        'else',
        '  gh issue create -R "$GH_REPO" --title "$TITLE" --body "$BODY"',
        'fi',
      ].join('\n'),
    },
  ],
});

// The build job checks out the PR head repository, which a base-repo GITHUB_TOKEN cannot read when the fork is
// private. Drop the overrides so actions/checkout takes the pull_request merge ref in this repo instead.
const buildWorkflowFile = project.tryFindObjectFile('.github/workflows/build.yml');
buildWorkflowFile?.addDeletionOverride('jobs.build.steps.0.with.repository');
buildWorkflowFile?.addDeletionOverride('jobs.build.steps.0.with.ref');

// Run the build check on the self-hosted CodeBuild runner, matching the docs gates. projen's BuildWorkflow has
// no per-job runsOn option, so override the generated job. The self-mutation push-back job is left on
// ubuntu-latest: it only runs on same-repo (non-fork) PRs and does no heavy work.
buildWorkflowFile?.addOverride('jobs.build.runs-on', CODEBUILD_RUNNER);

// The package is ESM. `type: module` makes Node read every .js in the tree as a module, and NodeNext is the
// resolution mode that matches it, so relative imports carry the extension the emitted file will have.
project.package.addField('type', 'module');
for (const tsconfig of [project.tsconfig, project.tsconfigDev]) {
  tsconfig?.file.addOverride('compilerOptions.module', 'NodeNext');
  tsconfig?.file.addOverride('compilerOptions.moduleResolution', 'NodeNext');
  tsconfig?.file.addOverride('compilerOptions.target', 'ES2022');
}

// NodeNext requires the extension the emitted JS will have, so a source import reads `./x.js` while the file on
// disk is `./x.ts`. Jest resolves against the source tree, so it needs the extension mapped back off.
project.jest!.addModuleNameMappers({ '^(\\.{1,2}/.*)\\.js$': '$1' });

// ts-jest emits CommonJS unless told otherwise, and a CommonJS `require` cannot load an ESM-only dependency.
// Jest's own ESM support is behind a Node flag, so the runner needs it on the task.
project.jest!.config.extensionsToTreatAsEsm = ['.ts', '.tsx'];
project.jest!.config.transform = {
  '^.+\\.[t]sx?$': ['ts-jest', { tsconfig: 'test/tsconfig.json', useESM: true }],
};
project.testTask.env('NODE_OPTIONS', '--experimental-vm-modules');

project.synth();
