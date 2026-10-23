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
  /** Default version for documented `@aws-cdk/*-alpha` modules. */
  readonly cdkAlpha: string;
  /** Older per-module pins retained while those modules publish late. */
  readonly cdkAlphaOverrides: Readonly<Record<string, string>>;
}

/** Repo-relative path of the pins file. */
export const CDK_PINS_FILE = 'projenrc/cdk-versions.json';

/** Scalar pin keys accepted by the `cdk:pin` CLI. */
export type CdkPinKey = 'awsCdkLib' | 'cdkAlpha';
export const CDK_PIN_KEYS: ReadonlyArray<CdkPinKey> = ['awsCdkLib', 'cdkAlpha'];

/** All keys, in their stable on-disk order. */
export const CDK_PIN_FILE_KEYS: ReadonlyArray<keyof CdkPins> = [
  ...CDK_PIN_KEYS,
  'cdkAlphaOverrides',
];

const ALPHA_MODULE_PATTERN = /^@aws-cdk\/[a-z0-9]+(?:-[a-z0-9]+)*-alpha$/;

function assertVersion(key: string, value: unknown): string {
  return assertValidVersion(`${CDK_PINS_FILE}: "${key}"`, value);
}

function parseAlphaOverrides(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${CDK_PINS_FILE}: "cdkAlphaOverrides" must contain a JSON object`);
  }
  const overrides: Record<string, string> = {};
  for (const name of Object.keys(value).sort()) {
    if (!ALPHA_MODULE_PATTERN.test(name)) {
      throw new Error(`${CDK_PINS_FILE}: invalid alpha module override ${JSON.stringify(name)}`);
    }
    overrides[name] = assertVersion(`cdkAlphaOverrides.${name}`, (value as Record<string, unknown>)[name]);
  }
  return overrides;
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
    cdkAlphaOverrides: parseAlphaOverrides(raw.cdkAlphaOverrides),
  };
}

/** Serialize pins back to the file's exact on-disk form. */
export function formatCdkPins(pins: CdkPins): string {
  const ordered: CdkPins = {
    awsCdkLib: pins.awsCdkLib,
    cdkAlpha: pins.cdkAlpha,
    cdkAlphaOverrides: Object.fromEntries(Object.entries(pins.cdkAlphaOverrides).sort(([a], [b]) => a.localeCompare(b))),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function readCdkPins(file: string = CDK_PINS_FILE): CdkPins {
  return parseCdkPins(fs.readFileSync(file, 'utf-8'));
}

export function writeCdkPins(pins: CdkPins, file: string = CDK_PINS_FILE): void {
  fs.writeFileSync(file, formatCdkPins(pins));
}

/** The effective pin for one documented alpha module. */
export function alphaVersionForModule(pins: CdkPins, module: string): string {
  return pins.cdkAlphaOverrides[module] ?? pins.cdkAlpha;
}

/** Replace the default and held alpha pins after validating every value. */
export function withAlphaVersions(
  pins: CdkPins,
  defaultVersion: string,
  overrides: Readonly<Record<string, string>>,
): CdkPins {
  return {
    ...pins,
    cdkAlpha: assertVersion('cdkAlpha', defaultVersion),
    cdkAlphaOverrides: parseAlphaOverrides(overrides),
  };
}

/**
 * Return the pins with one scalar key replaced. Validates the incoming value
 * before writing, so the bot cannot persist a malformed pin.
 */
export function withCdkPin(pins: CdkPins, key: CdkPinKey, value: string): CdkPins {
  return { ...pins, [key]: assertVersion(key, value) };
}

/** True for a scalar key the pins CLI may set. */
export function isCdkPinKey(key: string): key is CdkPinKey {
  return (CDK_PIN_KEYS as ReadonlyArray<string>).includes(key);
}
