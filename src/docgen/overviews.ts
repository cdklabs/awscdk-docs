/**
 * Per-module overview behavior.
 *
 * Every documented module — package root or submodule — owns one overview page at the canonical `…-readme` URL.
 * What that page shows is config rather than a special case in the renderer, so modules like `core` can render their
 * README at the root URL.
 *
 * The config lives in `docgen.config.json` under `overviews`, keyed by module id — `<assemblyName>` for a package
 * root, `<assemblyName>.<submodule>` for a submodule. This is the same id used for `assembly.submodules` lookups and
 * `moduleReadmeLink()`.
 *
 * This module owns the types, the default, and validation. It imports nothing from `@jsii/spec` so it stays
 * trivially unit-testable.
 */

/** How a module's overview page is composed. */
export type OverviewSpec =
  /** The module's own README (the default). */
  | { readonly kind: 'readme' }
  /** No README body — the type list / table only. */
  | { readonly kind: 'none' }
  /** Another module's README verbatim, body only. */
  | { readonly kind: 'copy'; readonly from: string }
  /** The artificial index page: title, version, description, links. */
  | { readonly kind: 'generated' };

/**
 * Behavior for a module that says nothing: `readme` for package roots as well as submodules, so `aws-cdk-lib`'s
 * overview URL renders the library README instead of an artificial index.
 */
export const DEFAULT_OVERVIEW: OverviewSpec = { kind: 'readme' };

const KINDS = ['readme', 'none', 'copy', 'generated'] as const;

export type OverviewMap = ReadonlyMap<string, OverviewSpec>;

/**
 * Validate and parse the `overviews` object from a raw config file.
 *
 * Shape validation only: unknown `kind`, a `copy` without a usable `from`, a self-copy, and a `copy` chained onto
 * another `copy` entry. Whether a key names a module that exists needs the loaded assemblies, so that lives in
 * {@link assertOverviewsResolvable}. Every rejection throws and names the offending key so a typo cannot silently
 * produce wrong overview pages.
 */
export function parseOverviews(raw: unknown, file = 'docgen.config.json'): OverviewMap {
  if (raw === undefined) {
    return new Map();
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError(`${file}: "overviews" must be an object keyed by module id`);
  }
  const entries = new Map<string, OverviewSpec>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    entries.set(key, parseOne(key, value, file));
  }
  // One hop only: `from` pointing at another `copy` is treated as a mistake rather than a chain to resolve.
  for (const [key, spec] of entries) {
    if (spec.kind !== 'copy') {
      continue;
    }
    const target = entries.get(spec.from);
    if (target?.kind === 'copy') {
      throw new TypeError(
        `${file}: "overviews"."${key}" copies from "${spec.from}", which is itself a "copy" entry; chains are not resolved`,
      );
    }
  }
  return entries;
}

function parseOne(key: string, value: unknown, file: string): OverviewSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${file}: "overviews"."${key}" must be an object with a "kind"`);
  }
  const raw = value as Record<string, unknown>;
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    throw new TypeError(
      `${file}: "overviews"."${key}" has unknown kind ${JSON.stringify(kind)}. Valid: ${KINDS.join(', ')}`,
    );
  }
  if (kind === 'copy') {
    const from = raw.from;
    if (typeof from !== 'string' || from.trim() === '') {
      throw new TypeError(`${file}: "overviews"."${key}" is a "copy" and needs a non-empty "from"`);
    }
    if (from === key) {
      throw new TypeError(`${file}: "overviews"."${key}" copies from itself`);
    }
    return { kind: 'copy', from };
  }
  return { kind } as OverviewSpec;
}

/**
 * Second validation pass, run once the assemblies are loaded and the full set of module ids is known: every
 * configured key, and every `copy` source, must name a module the run documents. Fails here rather than at render
 * time so a key resolving to nothing is caught as a typo.
 *
 * `generated` is rejected for submodules: the artificial page is a package-root shape (version, description,
 * submodule links) with nothing coherent to render for a submodule.
 */
export function assertOverviewsResolvable(
  overviews: OverviewMap,
  moduleIds: Iterable<string>,
  packageRoots: Iterable<string>,
  file = 'docgen.config.json',
): void {
  const known = new Set(moduleIds);
  const roots = new Set(packageRoots);
  for (const [key, spec] of overviews) {
    if (!known.has(key)) {
      throw new TypeError(
        `${file}: "overviews"."${key}" does not name a documented module or submodule`,
      );
    }
    if (spec.kind === 'generated' && !roots.has(key)) {
      throw new TypeError(
        `${file}: "overviews"."${key}" uses kind "generated", which is only available for package roots`,
      );
    }
    if (spec.kind === 'copy' && !known.has(spec.from)) {
      throw new TypeError(
        `${file}: "overviews"."${key}" copies from "${spec.from}", which is not a documented module or submodule`,
      );
    }
  }
}

/** Resolved behavior for a module id, defaulting to {@link DEFAULT_OVERVIEW}. */
export function overviewFor(overviews: OverviewMap, id: string): OverviewSpec {
  return overviews.get(id) ?? DEFAULT_OVERVIEW;
}
