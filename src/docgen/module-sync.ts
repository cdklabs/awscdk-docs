/**
 * Pure decision logic for the nightly sync of the documented `@aws-cdk/*-alpha` module list against what
 * aws/aws-cdk ships.
 *
 * The nightly job does the impure parts — read the release tag's package listing, query the registry, rewrite
 * docgen.config.json, open the PR — and every judgment it makes lives here so it is unit-testable offline.
 */

/** Shape of an in-support alpha package name. Anything else is not a candidate, whatever the listing says. */
export const ALPHA_MODULE_PATTERN = /^@aws-cdk\/[a-z0-9]+(?:-[a-z0-9]+)*-alpha$/;

/** The documented alpha modules: every `-alpha` entry of a docgen module list. */
export function alphaModulesOf(modules: readonly string[]): string[] {
  return modules.filter((name) => ALPHA_MODULE_PATTERN.test(name));
}

/** One entry of the GitHub contents API listing for `packages/@aws-cdk` at a release tag. */
export interface UpstreamEntry {
  readonly name: string;
  readonly type: string;
}

/**
 * The alpha packages a release ships, from the `packages/@aws-cdk` directory listing at its tag.
 *
 * Throws rather than returning an empty set when the listing is not a non-empty array of entries or names no alpha
 * package at all: every such shape means the source of truth was not read, and acting on it would remove every
 * documented module.
 */
export function upstreamAlphaModules(listing: unknown): string[] {
  if (!Array.isArray(listing) || listing.length === 0) {
    throw new Error('aws-cdk package listing: expected a non-empty array of directory entries');
  }
  const names = listing
    .filter((entry): entry is UpstreamEntry =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as UpstreamEntry).name === 'string' && (entry as UpstreamEntry).type === 'dir')
    .map((entry) => `@aws-cdk/${entry.name}`)
    .filter((name) => ALPHA_MODULE_PATTERN.test(name))
    .sort();
  if (names.length === 0) {
    throw new Error('aws-cdk package listing: no alpha package directories found');
  }
  return names;
}

export interface ModuleSyncInput {
  /** Alpha modules docgen.config.json documents today. */
  readonly documented: readonly string[];
  /** Alpha modules the release ships, from {@link upstreamAlphaModules}. */
  readonly upstream: readonly string[];
  /** Versions the registry lists for each addition candidate; a missing key means nothing is published. */
  readonly published: ReadonlyMap<string, readonly string[]>;
  /** The alpha version every documented module is pinned to. */
  readonly alphaVersion: string;
}

export interface ModuleSyncPlan {
  /** Whether applying the plan changes the module list. */
  readonly changed: boolean;
  /** Upstream modules to add: not documented, and published at the pinned alpha version. */
  readonly additions: string[];
  /** Upstream modules not yet published at the pinned alpha version: reported, added on a later night. */
  readonly held: string[];
  /** Documented modules the release no longer ships: graduated or dropped. */
  readonly removals: string[];
}

/**
 * Decide what the module list should gain and lose.
 *
 * An addition must have published the pinned alpha version, or installing it would fail the same way a partial
 * alpha bump does; until it has, it is held and named rather than silently skipped.
 */
export function planModuleSync(input: ModuleSyncInput): ModuleSyncPlan {
  const documented = new Set(input.documented);
  const upstream = new Set(input.upstream);
  const additions: string[] = [];
  const held: string[] = [];
  for (const name of [...upstream].sort()) {
    if (documented.has(name)) {
      continue;
    }
    (input.published.get(name)?.includes(input.alphaVersion) ? additions : held).push(name);
  }
  const removals = [...documented].filter((name) => !upstream.has(name)).sort();
  return { changed: additions.length > 0 || removals.length > 0, additions, held, removals };
}

/**
 * The docgen.config.json text with the plan applied: non-alpha modules keep their place and order, the alpha
 * modules become the documented set plus additions minus removals, sorted. Only the `modules` array is rewritten,
 * with the file's own indentation, so every other key keeps its formatting byte for byte.
 */
export function applyModuleSync(configText: string, plan: ModuleSyncPlan): string {
  const config = JSON.parse(configText);
  if (!Array.isArray(config.modules)) {
    throw new Error('docgen.config.json: "modules" must be an array');
  }
  const modules: string[] = config.modules;
  const fixed = modules.filter((name) => !ALPHA_MODULE_PATTERN.test(name));
  const removals = new Set(plan.removals);
  const alphas = new Set([...alphaModulesOf(modules).filter((name) => !removals.has(name)), ...plan.additions]);
  const next = [...fixed, ...[...alphas].sort()];

  const match = /("modules":\s*\[)([\s\S]*?)(\n\s*\])/.exec(configText);
  if (!match) {
    throw new Error('docgen.config.json: "modules" array not found in the file text');
  }
  const indent = /\n(\s+)"/.exec(match[2])?.[1] ?? '    ';
  const body = next.map((name) => `\n${indent}${JSON.stringify(name)}`).join(',');
  const result = configText.replace(match[0], `${match[1]}${body}${match[3]}`);
  if (JSON.stringify(JSON.parse(result).modules) !== JSON.stringify(next)) {
    throw new Error('docgen.config.json: rewritten "modules" array does not parse back to the plan');
  }
  return result;
}

/** One-line-per-change summary of a plan, for the job log and the PR body. */
export function describeModuleSync(plan: ModuleSyncPlan): string[] {
  return [
    ...plan.additions.map((name) => `add ${name}`),
    ...plan.removals.map((name) => `remove ${name}`),
  ];
}

/**
 * The `$GITHUB_OUTPUT` lines for the plan. Package names are validated against {@link ALPHA_MODULE_PATTERN}
 * before they are written, so a value from the listing can never forge a second output line.
 */
export function renderModuleOutputs(plan: ModuleSyncPlan): string {
  for (const name of [...plan.additions, ...plan.removals]) {
    if (!ALPHA_MODULE_PATTERN.test(name)) {
      throw new Error(`$GITHUB_OUTPUT: not an alpha module name: ${JSON.stringify(name)}`);
    }
  }
  return `changed=${plan.changed}\nadditions=${plan.additions.join(',')}\nremovals=${plan.removals.join(',')}\n`;
}

/**
 * How many generated pages a documented module accounts for: one per type plus the module README. Read from the
 * installed jsii assembly, so a removal PR can state what it deletes.
 */
export function modulePageCount(assembly: { readonly types?: Record<string, unknown> }): number {
  return Object.keys(assembly.types ?? {}).length + 1;
}
