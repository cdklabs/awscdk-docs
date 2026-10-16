import * as fs from 'fs';
import { assertValidVersion } from './version-format.js';

/**
 * The CDK version pins `.projenrc.ts` reads.
 *
 * The versions live in `projenrc/cdk-versions.json` so the nightly
 * cdk-version-check bot rewrites structured data rather than editing
 * TypeScript source.
 *
 * The pins are the human-authored source; the projen-generated
 * `package.json` remains the build's source of truth and is regenerated
 * from them by `npx projen`.
 */
export interface CdkPins {
  /** Exact `aws-cdk-lib` devDependency version. */
  readonly awsCdkLib: string;
  /**
   * Exact version for every documented `@aws-cdk/*-alpha` module. In-support
   * alphas ship in lockstep with the core library: the same release version
   * with an `-alpha.0` suffix.
   *
   * Maintained by the nightly refresh, which only moves it to a version
   * EVERY documented module has published — installing a version some
   * module lacks would fail outright. When the set is incomplete the pin
   * is held back and the PR body names the modules that are missing.
   */
  readonly cdkAlpha: string;
}

/** Repo-relative path of the pins file. */
export const CDK_PINS_FILE = 'projenrc/cdk-versions.json';

/** Pin keys, in the order they are written back to the file. */
export const CDK_PIN_KEYS: ReadonlyArray<keyof CdkPins> = ['awsCdkLib', 'cdkAlpha'];

function assertVersion(key: string, value: unknown): string {
  return assertValidVersion(`${CDK_PINS_FILE}: "${key}"`, value);
}

/** Parse the pins from JSON text, rejecting anything malformed loudly. */
export function parseCdkPins(text: string): CdkPins {
  const raw = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${CDK_PINS_FILE}: must contain a JSON object`);
  }
  return {
    awsCdkLib: assertVersion('awsCdkLib', raw.awsCdkLib),
    cdkAlpha: assertVersion('cdkAlpha', raw.cdkAlpha),
  };
}

/** Serialize pins back to the file's exact on-disk form. */
export function formatCdkPins(pins: CdkPins): string {
  const ordered = Object.fromEntries(CDK_PIN_KEYS.map((key) => [key, pins[key]]));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function readCdkPins(file: string = CDK_PINS_FILE): CdkPins {
  return parseCdkPins(fs.readFileSync(file, 'utf-8'));
}

export function writeCdkPins(pins: CdkPins, file: string = CDK_PINS_FILE): void {
  fs.writeFileSync(file, formatCdkPins(pins));
}

/**
 * Return the pins with one key replaced. Validates the incoming value the
 * same way reading does, so the bot cannot write a pin that the next read
 * would reject.
 */
export function withCdkPin(pins: CdkPins, key: keyof CdkPins, value: string): CdkPins {
  return { ...pins, [key]: assertVersion(key, value) };
}

/** True for a key the pins file defines. Narrows an untrusted CLI argument. */
export function isCdkPinKey(key: string): key is keyof CdkPins {
  return (CDK_PIN_KEYS as ReadonlyArray<string>).includes(key);
}
