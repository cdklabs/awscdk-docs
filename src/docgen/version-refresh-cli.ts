import * as fs from 'fs';
import * as path from 'path';
import { fetchUpstreamAlphaModules } from './alpha-module-source.js';
import { sanitizeLogList, sanitizeLogText } from './log-text.js';
import { applyModuleSync, ModuleSyncPlan } from './module-sync.js';
import {
  CDK_PINS_FILE,
  readCdkPins,
  withAlphaVersions,
  withCdkPin,
  writeCdkPins,
} from './pins.js';
import {
  AlphaVersionResolution,
  describeVersionBump,
  documentedAlphaModules,
  planVersionBump,
  renderWorkflowOutputs,
  resolveAlphaVersions,
  VersionBumpPlan,
} from './version-bump.js';
import {
  buildVersionSnapshot,
  fetchJson,
  fetchPackuments,
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

interface PlanFile {
  readonly plan: VersionBumpPlan;
  readonly snapshot: VersionSnapshot;
  readonly alphaResolution: AlphaVersionResolution;
  readonly targetCore: string;
  readonly summary: string[];
}

function latestMap(packuments: Map<string, Packument>): Map<string, string> {
  return new Map([...packuments].map(([name, p]) => [name, p['dist-tags'].latest]));
}

/** Versions the registry lists for a package. */
async function publishedVersions(name: string): Promise<string[]> {
  const packument = await fetchJson(`https://registry.npmjs.org/${name}`);
  return Object.keys(packument.time ?? {});
}

function sameOverrides(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

async function plan(): Promise<void> {
  const pins = readCdkPins(path.join(root, CDK_PINS_FILE));
  const snapshot = readVersionSnapshot(path.join(root, VERSION_SNAPSHOT_FILE));
  const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
  const alphaModules = documentedAlphaModules(pkgJson.devDependencies ?? {});

  const packuments = await fetchPackuments();
  const core = packuments.get('aws-cdk-lib')!;
  const latestCore = core['dist-tags'].latest;

  let upstream: string[] | undefined;
  try {
    upstream = await fetchUpstreamAlphaModules(latestCore);
  } catch (err: unknown) {
    // A failed tag read proves nothing about package removal. Preserve every alpha pin.
    // eslint-disable-next-line no-console
    console.log(`version-refresh: release-tag module list unavailable — holding alpha pins: ${sanitizeLogText(err instanceof Error ? err.message : String(err))}`);
  }

  const published = new Map<string, string[]>();
  if (upstream !== undefined) {
    const upstreamSet = new Set(upstream);
    await Promise.all(alphaModules.filter((name) => upstreamSet.has(name)).map(async (name) => {
      try {
        published.set(name, await publishedVersions(name));
      } catch (err: unknown) {
        // One failed registry read is unknown, not evidence that the module is late or gone.
        // eslint-disable-next-line no-console
        console.log(`version-refresh: registry data unavailable for ${sanitizeLogText(name)} — holding its pin: ${sanitizeLogText(err instanceof Error ? err.message : String(err))}`);
      }
    }));
  }

  const alphaResolution = resolveAlphaVersions({
    modules: alphaModules,
    upstream,
    published,
    targetCore: latestCore,
    currentDefault: pins.cdkAlpha,
    currentOverrides: pins.cdkAlphaOverrides,
  });
  const alphaSetChanged = alphaResolution.defaultVersion !== pins.cdkAlpha
    || !sameOverrides(alphaResolution.overrides, pins.cdkAlphaOverrides)
    || alphaResolution.gone.length > 0;

  const bump = planVersionBump({
    currentCore: pins.awsCdkLib,
    latestCore,
    currentAlpha: pins.cdkAlpha,
    alphaTarget: alphaResolution.defaultVersion,
    alphaSetChanged,
    snapshotLatest: latestMap(new Map(Object.entries(snapshot.packages))),
    registryLatest: latestMap(packuments),
  });

  const describedBump = alphaResolution.defaultVersion === pins.cdkAlpha
    ? { ...bump, alpha: undefined }
    : bump;
  const summary = [
    ...describeVersionBump(describedBump),
    ...alphaResolution.late.map((name) => `hold ${name} at its current alpha pin`),
    ...alphaResolution.gone.map((name) => `remove ${name}; folder missing at aws-cdk v${latestCore}`),
  ];
  const planFile: PlanFile = {
    plan: bump,
    snapshot: buildVersionSnapshot(packuments),
    alphaResolution,
    targetCore: latestCore,
    summary,
  };
  fs.writeFileSync(PLAN_FILE, `${JSON.stringify(planFile, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(bump.changed
    ? `version-refresh: changes detected\n  ${sanitizeLogList(summary).join('\n  ')}`
    : 'version-refresh: nothing moved');
  if (alphaResolution.late.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`version-refresh: holding ${alphaResolution.late.length} late module pin(s): ${sanitizeLogList(alphaResolution.late).join(', ')}`);
  }
  if (alphaResolution.gone.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`version-refresh: dropping ${alphaResolution.gone.length} gone module(s): ${sanitizeLogList(alphaResolution.gone).join(', ')}`);
  }
  if (alphaResolution.unknown.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`version-refresh: holding ${alphaResolution.unknown.length} unknown module pin(s): ${sanitizeLogList(alphaResolution.unknown).join(', ')}`);
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

  const pinsPath = path.join(root, CDK_PINS_FILE);
  let pins = readCdkPins(pinsPath);
  if (planFile.plan.core) {
    pins = withCdkPin(pins, 'awsCdkLib', planFile.plan.core);
  }
  pins = withAlphaVersions(
    pins,
    planFile.alphaResolution.defaultVersion,
    planFile.alphaResolution.overrides,
  );

  const configPath = path.join(root, 'docgen.config.json');
  const modulePlan: ModuleSyncPlan = {
    changed: planFile.alphaResolution.gone.length > 0,
    additions: [],
    held: [],
    removals: planFile.alphaResolution.gone,
  };
  const config = applyModuleSync(fs.readFileSync(configPath, 'utf-8'), modulePlan);

  writeVersionSnapshot(planFile.snapshot, path.join(root, VERSION_SNAPSHOT_FILE));
  writeCdkPins(pins, pinsPath);
  fs.writeFileSync(configPath, config);

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
  if (planFile.alphaResolution.late.length > 0) {
    lines.push(
      '',
      '## Alpha pins held back',
      '',
      `These modules still exist in aws-cdk v${planFile.targetCore}, but have not published that release's alpha. Their prior pins remain in place while the other alphas move:`,
      '',
      ...planFile.alphaResolution.late.map((name) => `- \`${name}\``),
    );
  }
  if (planFile.alphaResolution.gone.length > 0) {
    lines.push(
      '',
      '## Alpha modules removed',
      '',
      `These modules are removed because their folders are missing under \`packages/@aws-cdk\` at aws-cdk v${planFile.targetCore}. Review each removal before merging:`,
      '',
      ...planFile.alphaResolution.gone.map((name) => `- \`${name}\``),
    );
  }
  if (planFile.alphaResolution.unknown.length > 0) {
    lines.push(
      '',
      '## Alpha pins unchanged after failed reads',
      '',
      'Release-tag or registry data could not be read for these modules. Their pins remain unchanged, and none are removed:',
      '',
      ...planFile.alphaResolution.unknown.map((name) => `- \`${name}\``),
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
