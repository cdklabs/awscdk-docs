import { isNewerVersion } from './freshness.js';
import { assertValidVersion } from './version-format.js';

/**
 * Pure decision logic for the nightly CDK version refresh.
 *
 * The nightly job does the impure parts — query the registry, edit the
 * pins, write the snapshot, open the PR — and every judgment it makes
 * lives here so it is unit-testable offline.
 */

/**
 * The alpha release that ships alongside a core library version.
 * In-support alpha modules are published in lockstep with the same
 * release version plus an `-alpha.0` suffix.
 */
export function alphaVersionFor(coreVersion: string): string {
  return `${coreVersion}-alpha.0`;
}

/**
 * Pick the alpha version to pin, given the versions each documented
 * alpha module has actually published.
 *
 * A partial bump is a broken tree — installing
 * `@aws-cdk/aws-foo-alpha@2.269.0-alpha.0` fails outright when only 30
 * of the 31 modules have published it — so a candidate only qualifies
 * when EVERY module has it. Candidates are tried newest first and the
 * first unanimous one wins; `undefined` means no candidate is unanimous
 * and the alphas must be left alone this run.
 *
 * `published` maps module name to the versions the registry lists for
 * it. A module missing from the map has published nothing and therefore
 * disqualifies every candidate.
 */
export function resolveAlphaTarget(
  modules: readonly string[],
  published: ReadonlyMap<string, readonly string[]>,
  coreCandidates: readonly string[],
): string | undefined {
  for (const core of coreCandidates) {
    const target = alphaVersionFor(core);
    if (modules.every((name) => published.get(name)?.includes(target))) {
      return target;
    }
  }
  return undefined;
}

/**
 * Modules lacking a given alpha version — the evidence for why an alpha
 * bump was skipped, reported into the job log and the PR body rather
 * than left for someone to reconstruct.
 */
export function modulesMissingAlpha(
  modules: readonly string[],
  published: ReadonlyMap<string, readonly string[]>,
  alphaVersion: string,
): string[] {
  return modules.filter((name) => !published.get(name)?.includes(alphaVersion));
}

/**
 * The documented alpha modules, derived from the installed
 * devDependencies rather than restated anywhere. `.projenrc.ts` holds
 * the single list (`DOCUMENTED_ALPHA_MODULES`) and projen writes it into
 * `package.json`, which `test/docgen.test.ts` already keeps in sync with
 * `docgen.config.json` — so reading it back here duplicates nothing.
 */
export function documentedAlphaModules(devDependencies: Record<string, string>): string[] {
  return Object.keys(devDependencies).filter((name) => name.endsWith('-alpha')).sort();
}

/** The release part of an alpha version: `2.266.0-alpha.0` -> `2.266.0`. */
export function releasePartOf(alphaVersion: string): string {
  return alphaVersion.replace(/-.*$/, '');
}

/** Latest version per tracked package, as resolved from the registry. */
export type LatestVersions = ReadonlyMap<string, string>;

export interface VersionBumpInput {
  /** Current `awsCdkLib` pin. */
  readonly currentCore: string;
  /** Newest published `aws-cdk-lib` release. */
  readonly latestCore: string;
  /** Current `cdkAlpha` pin. */
  readonly currentAlpha: string;
  /**
   * Alpha version to move to, or undefined when no version is published
   * across every documented module (see `resolveAlphaTarget`).
   */
  readonly alphaTarget?: string;
  /** `dist-tags.latest` per tracked package in the committed snapshot. */
  readonly snapshotLatest: LatestVersions;
  /** `dist-tags.latest` per tracked package as published now. */
  readonly registryLatest: LatestVersions;
}

export interface VersionBumpPlan {
  /** New core pin, when a newer release exists. */
  readonly core?: string;
  /** New alpha pin, when a unanimously published newer alpha exists. */
  readonly alpha?: string;
  /** Tracked packages whose displayed version moved, `name: old -> new`. */
  readonly snapshot: Record<string, { readonly from: string; readonly to: string }>;
  /** True when anything at all moved — the condition for opening a PR. */
  readonly changed: boolean;
}

/**
 * Decide what the nightly run should change. Nothing moving yields
 * `changed: false`, which is the signal to open no PR and leave the tree
 * clean.
 *
 * The core and alpha cursors are decided independently and may diverge:
 * when the alphas lag, the core still moves. A partially published alpha
 * set therefore holds only the alpha pin back, never the core bump.
 */
export function planVersionBump(input: VersionBumpInput): VersionBumpPlan {
  const core = isNewerVersion(input.currentCore, input.latestCore) ? input.latestCore : undefined;

  // Compared with isNewerVersion, which ignores the -alpha.0 suffix
  // both pins carry: the comparison is between their release parts.
  const alpha =
    input.alphaTarget && input.alphaTarget !== input.currentAlpha && isNewerVersion(input.currentAlpha, input.alphaTarget)
      ? input.alphaTarget
      : undefined;

  const snapshot: Record<string, { from: string; to: string }> = {};
  for (const [name, to] of input.registryLatest) {
    const from = input.snapshotLatest.get(name);
    if (from !== to) {
      snapshot[name] = { from: from ?? '(absent)', to };
    }
  }

  return {
    core,
    alpha,
    snapshot,
    changed: core !== undefined || alpha !== undefined || Object.keys(snapshot).length > 0,
  };
}

/** Render the plan as `$GITHUB_OUTPUT` lines, rejecting any malformed version. */
export function renderWorkflowOutputs(plan: VersionBumpPlan): string {
  const core = plan.core === undefined ? '' : assertValidVersion('$GITHUB_OUTPUT "core"', plan.core);
  const alpha = plan.alpha === undefined ? '' : assertValidVersion('$GITHUB_OUTPUT "alpha"', plan.alpha);
  return `changed=${plan.changed}\ncore=${core}\nalpha=${alpha}\n`;
}

/** One-line-per-change summary of a plan, for the job log and PR body. */
export function describeVersionBump(plan: VersionBumpPlan): string[] {
  const lines: string[] = [];
  if (plan.core) {
    lines.push(`aws-cdk-lib pin -> ${plan.core}`);
  }
  if (plan.alpha) {
    lines.push(`alpha modules pin -> ${plan.alpha}`);
  }
  for (const [name, move] of Object.entries(plan.snapshot)) {
    lines.push(`${name} displayed version ${move.from} -> ${move.to}`);
  }
  return lines;
}
