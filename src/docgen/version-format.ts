/**
 * The single definition of what a CDK version string may look like.
 *
 * Versions arrive as `dist-tags.latest` from an npm packument and are therefore
 * untrusted. Both patterns are end-anchored so a longer string cannot pass as
 * its own prefix.
 */

/** Canonical form: three numeric parts, optional pre-release suffix, nothing else. */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** As {@link VERSION_PATTERN}, but tolerates a `v` prefix and captures the release parts. */
export const VERSION_PARSE_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/** True when `value` is a string in the canonical version form. */
export function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

/** Return `value` when it is a canonical version string, otherwise throw naming `context`. */
export function assertValidVersion(context: string, value: unknown): string {
  if (!isValidVersion(value)) {
    throw new Error(`${context} must be a semver version, got ${JSON.stringify(value)}`);
  }
  return value;
}
