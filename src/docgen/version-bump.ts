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

/** Inputs for resolving each documented alpha module independently. */
export interface AlphaVersionInput {
  readonly modules: readonly string[];
  /** Modules present under packages/@aws-cdk at the target release tag; undefined means the listing failed. */
  readonly upstream?: readonly string[];
  /** Registry versions by module; a missing key means that module's registry read failed. */
  readonly published: ReadonlyMap<string, readonly string[]>;
  readonly targetCore: string;
  readonly currentDefault: string;
  readonly currentOverrides: Readonly<Record<string, string>>;
}

export interface AlphaVersionResolution {
  readonly defaultVersion: string;
  readonly overrides: Record<string, string>;
  readonly published: string[];
  readonly late: string[];
  readonly gone: string[];
  readonly unknown: string[];
}

/**
 * Resolve the target alpha version per module.
 *
 * A folder missing from the release tag means the module is gone. A folder
 * that exists without the target registry version is late. Failed tag or
 * registry reads are unknown and preserve the current pin.
 */
export function resolveAlphaVersions(input: AlphaVersionInput): AlphaVersionResolution {
  if (input.upstream === undefined || isNewerVersion(input.targetCore, releasePartOf(input.currentDefault))) {
    return {
      defaultVersion: input.currentDefault,
      overrides: { ...input.currentOverrides },
      published: [],
      late: [],
      gone: [],
      unknown: [...input.modules],
    };
  }

  const target = alphaVersionFor(input.targetCore);
  const upstream = new Set(input.upstream);
  const published: string[] = [];
  const late: string[] = [];
  const gone: string[] = [];
  const unknown: string[] = [];

  for (const name of input.modules) {
    if (!upstream.has(name)) {
      gone.push(name);
    } else if (!input.published.has(name)) {
      unknown.push(name);
    } else if (input.published.get(name)!.includes(target)) {
      published.push(name);
    } else {
      late.push(name);
    }
  }

  const defaultVersion = published.length > 0 ? target : input.currentDefault;
  const overrides: Record<string, string> = {};
  for (const name of [...late, ...unknown].sort()) {
    const held = input.currentOverrides[name] ?? input.currentDefault;
    if (held !== defaultVersion) {
      overrides[name] = held;
    }
  }

  return { defaultVersion, overrides, published, late, gone, unknown };
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
  /** Resolved default alpha version after late and gone modules are classified. */
  readonly alphaTarget?: string;
  /** True when per-module holds or removals changed, even if the default did not. */
  readonly alphaSetChanged?: boolean;
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

  // A module-level hold or removal must run the same apply and ledger path
  // even when the default alpha version itself stays unchanged.
  const alpha =
    input.alphaTarget
    && (
      (input.alphaTarget !== input.currentAlpha && isNewerVersion(input.currentAlpha, input.alphaTarget))
      || (input.alphaSetChanged === true && input.alphaTarget === input.currentAlpha)
    )
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
