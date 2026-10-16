import * as fs from 'fs';
import * as path from 'path';
import { loadAssembly } from './index.js';
import { sanitizeLogList, sanitizeLogText } from './log-text.js';
import {
  alphaModulesOf,
  applyModuleSync,
  describeModuleSync,
  ModuleSyncPlan,
  modulePageCount,
  planModuleSync,
  renderModuleOutputs,
  upstreamAlphaModules,
} from './module-sync.js';
import { CDK_PINS_FILE, readCdkPins } from './pins.js';
import { assertValidVersion } from './version-format.js';
import { fetchJson } from './versions.js';

/**
 * Nightly sync of the documented alpha module list against the aws-cdk release the pins name, in two phases so
 * the plan is reviewable before anything moves:
 *
 *   --plan     read the release tag's package listing and the registry, decide what moves, write PLAN_FILE
 *   --apply    rewrite docgen.config.json from that plan — offline, no second network call
 *   --pr-body  render the PR body from the plan
 *
 * Every judgment lives in `module-sync.ts` as a pure function; this file only does I/O and reporting.
 */

const root = process.cwd();
const PLAN_FILE = process.env.CDK_MODULE_PLAN_FILE ?? path.join(root, '.module-plan.json');
const CONFIG_FILE = 'docgen.config.json';

interface PlanFile {
  readonly plan: ModuleSyncPlan;
  readonly coreVersion: string;
  readonly alphaVersion: string;
  /** Generated pages each removal deletes, by module. */
  readonly removalPages: Record<string, number>;
  readonly summary: string[];
}

function documentedAlphas(): string[] {
  const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), 'utf-8'));
  if (!Array.isArray(config.modules)) {
    throw new Error(`${CONFIG_FILE}: "modules" must be an array`);
  }
  return alphaModulesOf(config.modules);
}

/**
 * The `packages/@aws-cdk` directory of aws/aws-cdk at a release tag. A non-200 answer is an error, never an
 * empty list.
 */
async function fetchUpstreamListing(coreVersion: string): Promise<unknown> {
  const url = `https://api.github.com/repos/aws/aws-cdk/contents/packages/@aws-cdk?ref=v${coreVersion}`;
  const headers: Record<string, string> = {
    'accept': 'application/vnd.github+json',
    'user-agent': 'cdk-docs-module-sync',
  };
  if (process.env.GH_TOKEN) {
    headers.authorization = `Bearer ${process.env.GH_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url}: HTTP ${res.status}`);
  }
  return res.json();
}

async function publishedVersions(name: string): Promise<string[]> {
  const packument = await fetchJson(`https://registry.npmjs.org/${name}`);
  return Object.keys(packument.time ?? {});
}

async function plan(): Promise<void> {
  const pins = readCdkPins(path.join(root, CDK_PINS_FILE));
  const documented = documentedAlphas();
  const upstream = upstreamAlphaModules(await fetchUpstreamListing(pins.awsCdkLib));

  const candidates = upstream.filter((name) => !documented.includes(name));
  const published = new Map<string, string[]>();
  await Promise.all(candidates.map(async (name) => published.set(name, await publishedVersions(name))));

  const syncPlan = planModuleSync({ documented, upstream, published, alphaVersion: pins.cdkAlpha });
  const removalPages: Record<string, number> = {};
  for (const name of syncPlan.removals) {
    removalPages[name] = modulePageCount(loadAssembly(path.join(root, 'node_modules', name)));
  }
  const summary = describeModuleSync(syncPlan);
  const planFile: PlanFile = {
    plan: syncPlan,
    coreVersion: pins.awsCdkLib,
    alphaVersion: pins.cdkAlpha,
    removalPages,
    summary,
  };
  fs.writeFileSync(PLAN_FILE, `${JSON.stringify(planFile, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(syncPlan.changed
    ? `module-sync: changes detected against aws-cdk v${pins.awsCdkLib}\n  ${sanitizeLogList(summary).join('\n  ')}`
    : `module-sync: documented modules match aws-cdk v${pins.awsCdkLib}`);
  if (syncPlan.held.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`module-sync: holding ${syncPlan.held.length} module(s) not yet published at ${pins.cdkAlpha}: ${sanitizeLogList(syncPlan.held).join(', ')}`);
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, renderModuleOutputs(syncPlan));
  }
}

function apply(): void {
  const planFile: PlanFile = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf-8'));
  if (!planFile.plan.changed) {
    // eslint-disable-next-line no-console
    console.log('module-sync: nothing to apply');
    return;
  }
  const configPath = path.join(root, CONFIG_FILE);
  fs.writeFileSync(configPath, applyModuleSync(fs.readFileSync(configPath, 'utf-8'), planFile.plan));
  // eslint-disable-next-line no-console
  console.log(`module-sync: applied\n  ${sanitizeLogList(planFile.summary).join('\n  ')}`);
}

/** Markdown body for the PR, from the plan alone. */
function body(): void {
  const planFile: PlanFile = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf-8'));
  const core = assertValidVersion('plan "coreVersion"', planFile.coreVersion);
  const alpha = assertValidVersion('plan "alphaVersion"', planFile.alphaVersion);
  const lines = [
    `Automated nightly sync of the documented \`@aws-cdk/*-alpha\` modules against the packages aws-cdk v${core} ships, generated by the cdk-version-check workflow (see the docgen-sources-and-modules ADR).`,
    '',
    'This PR is not auto-merged: a reviewer confirms the list change before it lands.',
    '',
    '## What moved',
    '',
    ...planFile.summary.map((line) => `- ${line}`),
  ];
  if (planFile.plan.additions.length > 0) {
    lines.push(
      '',
      `Each addition is pinned at \`${alpha}\` and starts generating pages on the next build.`,
    );
  }
  if (planFile.plan.removals.length > 0) {
    const total = planFile.plan.removals.reduce((sum, name) => sum + (planFile.removalPages[name] ?? 0), 0);
    lines.push(
      '',
      '## Pages this removes',
      '',
      `aws-cdk v${core} no longer ships these modules, so their generated pages leave the site — **${total} pages** in total, and every inbound link to them. Confirm each module really graduated or was dropped before merging:`,
      '',
      ...planFile.plan.removals.map((name) => `- \`${name}\`: ${planFile.removalPages[name] ?? 0} pages`),
    );
  }
  if (planFile.plan.held.length > 0) {
    lines.push(
      '',
      '## Held back',
      '',
      `These modules ship in v${core} but have not published \`${alpha}\`, so they are not added yet:`,
      '',
      ...planFile.plan.held.map((name) => `- \`${name}\``),
    );
  }
  // The contributor statement is appended by the workflow: boilerplate the Require Contributor Statement gate reads.
  lines.push('');
  // eslint-disable-next-line no-console
  console.log(sanitizeLogList(lines).join('\n'));
}

async function main(): Promise<void> {
  if (process.argv.includes('--plan')) {
    await plan();
  } else if (process.argv.includes('--apply')) {
    apply();
  } else if (process.argv.includes('--pr-body')) {
    body();
  } else {
    throw new Error('usage: module-sync-cli --plan | --apply | --pr-body');
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`module-sync: ${sanitizeLogText(err instanceof Error ? err.message : String(err))}`);
  process.exitCode = 1;
});
