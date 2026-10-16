import * as fs from 'fs';
import * as path from 'path';
import { sanitizeLogList, sanitizeLogText } from './log-text.js';
import { CDK_PINS_FILE, readCdkPins, withCdkPin, writeCdkPins } from './pins.js';
import {
  describeVersionBump,
  documentedAlphaModules,
  modulesMissingAlpha,
  planVersionBump,
  releasePartOf,
  renderWorkflowOutputs,
  resolveAlphaTarget,
  VersionBumpPlan,
} from './version-bump.js';
import {
  buildVersionSnapshot,
  compareVersionsDesc,
  fetchJson,
  fetchPackuments,
  isStableVersion,
  Packument,
  readVersionSnapshot,
  VERSION_SNAPSHOT_FILE,
  VersionSnapshot,
  writeVersionSnapshot,
} from './versions.js';

/**
 * Nightly CDK version refresh, in two phases so the plan is reviewable before anything moves:
 *
 *   --plan    query the registry, decide what moves, write PLAN_FILE
 *   --apply   apply that plan — offline, no second registry query
 *
 * Every judgment lives in `version-bump.ts` as a pure function; this file only does I/O and reporting.
 */

const root = process.cwd();
const PLAN_FILE = process.env.CDK_VERSION_PLAN_FILE ?? path.join(root, '.version-plan.json');

/** How far back to look for an alpha set that is published across every module. */
const ALPHA_CANDIDATE_DEPTH = 10;

interface PlanFile {
  readonly plan: VersionBumpPlan;
  readonly snapshot: VersionSnapshot;
  readonly missingAlphas: string[];
  readonly alphaCandidate?: string;
  readonly summary: string[];
}

function latestMap(packuments: Map<string, Packument>): Map<string, string> {
  return new Map([...packuments].map(([name, p]) => [name, p['dist-tags'].latest]));
}

/** Versions the registry lists for a package, newest-first for stable ones. */
async function publishedVersions(name: string): Promise<string[]> {
  const packument = await fetchJson(`https://registry.npmjs.org/${name}`);
  return Object.keys(packument.time ?? {});
}

async function plan(): Promise<void> {
  const pins = readCdkPins(path.join(root, CDK_PINS_FILE));
  const snapshot = readVersionSnapshot(path.join(root, VERSION_SNAPSHOT_FILE));
  const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
  const alphaModules = documentedAlphaModules(pkgJson.devDependencies ?? {});

  const packuments = await fetchPackuments();
  const core = packuments.get('aws-cdk-lib')!;
  const latestCore = core['dist-tags'].latest;

  // Alpha candidates: stable core releases at or below the newest one and
  // above the release the alphas are currently pinned to, newest first.
  const currentAlphaRelease = releasePartOf(pins.cdkAlpha);
  const candidates = Object.keys(core.time)
    .filter((v) => isStableVersion(v) && compareVersionsDesc(v, currentAlphaRelease) < 0)
    .sort(compareVersionsDesc)
    .slice(0, ALPHA_CANDIDATE_DEPTH);

  const published = new Map<string, string[]>();
  await Promise.all(alphaModules.map(async (name) => published.set(name, await publishedVersions(name))));

  const alphaTarget = resolveAlphaTarget(alphaModules, published, candidates);
  const bump = planVersionBump({
    currentCore: pins.awsCdkLib,
    latestCore,
    currentAlpha: pins.cdkAlpha,
    alphaTarget,
    snapshotLatest: latestMap(new Map(Object.entries(snapshot.packages))),
    registryLatest: latestMap(packuments),
  });

  // Evidence for a held-back alpha bump: which modules lack the version
  // the newest core release would imply.
  const wanted = candidates[0] ? `${candidates[0]}-alpha.0` : undefined;
  const missingAlphas = wanted && alphaTarget !== wanted ? modulesMissingAlpha(alphaModules, published, wanted) : [];

  const summary = describeVersionBump(bump);
  const planFile: PlanFile = {
    plan: bump,
    snapshot: buildVersionSnapshot(packuments),
    missingAlphas,
    alphaCandidate: wanted,
    summary,
  };
  fs.writeFileSync(PLAN_FILE, `${JSON.stringify(planFile, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(bump.changed ? `version-refresh: changes detected\n  ${sanitizeLogList(summary).join('\n  ')}` : 'version-refresh: nothing moved');
  if (missingAlphas.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`version-refresh: holding alpha pin — ${missingAlphas.length} module(s) have not published ${sanitizeLogText(`${wanted}`)}: ${sanitizeLogList(missingAlphas).join(', ')}`);
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, renderWorkflowOutputs(bump));
  }
}

function apply(): void {
  const planFile: PlanFile = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf-8'));
  if (!planFile.plan.changed) {
    // eslint-disable-next-line no-console
    console.log('version-refresh: nothing to apply');
    return;
  }

  writeVersionSnapshot(planFile.snapshot, path.join(root, VERSION_SNAPSHOT_FILE));

  const pinsPath = path.join(root, CDK_PINS_FILE);
  let pins = readCdkPins(pinsPath);
  if (planFile.plan.core) {
    pins = withCdkPin(pins, 'awsCdkLib', planFile.plan.core);
  }
  if (planFile.plan.alpha) {
    pins = withCdkPin(pins, 'cdkAlpha', planFile.plan.alpha);
  }
  writeCdkPins(pins, pinsPath);

  // eslint-disable-next-line no-console
  console.log(`version-refresh: applied\n  ${sanitizeLogList(planFile.summary).join('\n  ')}`);
}

/** Markdown body for the PR, from the plan alone. */
function body(): void {
  const planFile: PlanFile = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf-8'));
  const lines = [
    'Automated nightly refresh of the CDK version pins and the committed version snapshot, generated by the cdk-version-check workflow (see the versions-and-history ADR).',
    '',
    '## What moved',
    '',
    ...planFile.summary.map((line) => `- ${line}`),
  ];
  if (planFile.plan.core) {
    lines.push(
      '',
      `The version-history ledger was updated from v${planFile.plan.core}: its diff below lists every type and README introduced or changed in this release.`,
    );
  }
  if (planFile.missingAlphas.length > 0) {
    lines.push(
      '',
      '## Alpha pin held back',
      '',
      `\`${planFile.alphaCandidate}\` is not published for ${planFile.missingAlphas.length} documented module(s), so the alpha pin was left alone rather than bumped to a version some module lacks:`,
      '',
      ...planFile.missingAlphas.map((name) => `- \`${name}\``),
    );
  }
  // The changelog section and the contributor statement are appended by
  // the workflow: one needs a network call, the other is boilerplate the
  // Require Contributor Statement gate reads.
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
    throw new Error('usage: version-refresh-cli --plan | --apply | --pr-body');
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`version-refresh: ${sanitizeLogText(err instanceof Error ? err.message : String(err))}`);
  process.exitCode = 1;
});
