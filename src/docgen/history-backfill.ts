import { gunzipSync } from 'zlib';
import * as spec from '@jsii/spec';
import {
  FINGERPRINT_VERSION,
  Ledger,
  LedgerEntry,
  readmeFingerprint,
  typeFingerprint,
} from './history.js';

export interface BackfillRelease {
  readonly version: string;
  readonly publishedAt: string;
  readonly tarball: string;
}

interface PackumentVersion {
  readonly dist?: { readonly tarball?: string };
}

export interface Packument {
  readonly versions?: Record<string, PackumentVersion>;
  readonly time?: Record<string, string>;
}

export interface BackfillCoverage {
  readonly currentTypes: number;
  readonly introducedTypes: number;
  readonly changedTypes: number;
  readonly introducedPercent: number;
  readonly changedPercent: number;
  readonly currentReadmes: number;
  readonly introducedReadmes: number;
  readonly changedReadmes: number;
}

export interface BackfillResult {
  readonly ledger: Ledger;
  readonly coverage: BackfillCoverage;
}

const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function compareVersions(left: string, right: string): number {
  const a = STABLE_VERSION.exec(left);
  const b = STABLE_VERSION.exec(right);
  if (!a || !b) {
    throw new Error(`stable versions required, received ${left} and ${right}`);
  }
  for (let i = 1; i <= 3; i += 1) {
    const difference = Number(a[i]) - Number(b[i]);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function selectReleaseWindow(packument: Packument, target: string, count: number): BackfillRelease[] {
  if (!STABLE_VERSION.test(target)) {
    throw new Error(`target must be a stable version, received ${target}`);
  }
  if (!Number.isInteger(count) || count < 2) {
    throw new Error(`release count must be an integer of at least 2, received ${count}`);
  }
  const versions = packument.versions ?? {};
  const times = packument.time ?? {};
  const selected = Object.keys(versions)
    .filter((version) => STABLE_VERSION.test(version) && compareVersions(version, target) <= 0)
    .sort(compareVersions)
    .slice(-count);
  if (selected[selected.length - 1] !== target) {
    throw new Error(`target ${target} is absent from the npm packument`);
  }
  return selected.map((version) => {
    const tarball = versions[version].dist?.tarball;
    const publishedAt = times[version];
    if (!tarball || !publishedAt) {
      throw new Error(`packument is missing tarball or publish time for ${version}`);
    }
    return { version, publishedAt, tarball };
  });
}

function tarString(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
}

export function assemblyFromTarball(compressed: Buffer): spec.Assembly {
  const archive = gunzipSync(compressed);
  let plainAssembly: Buffer | undefined;
  for (let offset = 0; offset + 512 <= archive.length;) {
    const name = tarString(archive, offset, 100);
    if (!name) {
      break;
    }
    const prefix = tarString(archive, offset + 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeText = tarString(archive, offset + 124, 12).trim();
    const size = Number.parseInt(sizeText || '0', 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`invalid tar entry size for ${path}`);
    }
    const bodyStart = offset + 512;
    const body = archive.subarray(bodyStart, bodyStart + size);
    if (/(^|\/)\.jsii$/.test(path)) {
      plainAssembly = body;
    }
    if (/(^|\/)\.jsii\.gz$/.test(path)) {
      return JSON.parse(gunzipSync(body).toString('utf8')) as spec.Assembly;
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  if (plainAssembly) {
    const parsed = JSON.parse(plainAssembly.toString('utf8')) as spec.Assembly | { readonly filename?: string };
    if ('name' in parsed && 'version' in parsed) {
      return parsed;
    }
    throw new Error(`package tarball redirects the jsii assembly to ${parsed.filename ?? 'an absent file'}`);
  }
  throw new Error('package tarball contains neither .jsii nor .jsii.gz');
}

/** The only origin a release tarball may be downloaded from. */
export const REGISTRY_ORIGIN = 'https://registry.npmjs.org';

/**
 * Resolve the tarball a release record points at, rejecting anything outside the supported registry before a
 * request is made.
 */
function tarballUrl(release: BackfillRelease): URL {
  let url: URL;
  try {
    url = new URL(release.tarball);
  } catch {
    throw new Error(`aws-cdk-lib ${release.version} declares an unparsable tarball URL: ${release.tarball}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`aws-cdk-lib ${release.version} declares a non-HTTPS tarball URL: ${release.tarball}`);
  }
  if (url.origin !== REGISTRY_ORIGIN) {
    throw new Error(`aws-cdk-lib ${release.version} declares a tarball outside ${REGISTRY_ORIGIN}: ${release.tarball}`);
  }
  return url;
}

export async function downloadAssembly(
  release: BackfillRelease,
  get: typeof fetch = fetch,
): Promise<spec.Assembly> {
  const url = tarballUrl(release);
  let response: Response;
  try {
    response = await get(url, { redirect: 'error' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to download aws-cdk-lib ${release.version} from ${url.href}: ${reason}`);
  }
  if (!response.ok) {
    throw new Error(`failed to download aws-cdk-lib ${release.version}: ${response.status} ${response.statusText}`);
  }
  return assemblyFromTarball(Buffer.from(await response.arrayBuffer()));
}

function fingerprints(assembly: spec.Assembly): {
  readonly types: Map<string, string>;
  readonly readmes: Map<string, string>;
} {
  const types = new Map<string, string>();
  const readmes = new Map<string, string>();
  for (const [fqn, type] of Object.entries(assembly.types ?? {})) {
    types.set(fqn, typeFingerprint(type));
  }
  if (assembly.readme?.markdown !== undefined) {
    readmes.set(assembly.name, readmeFingerprint(assembly.readme.markdown));
  }
  for (const [fqn, submodule] of Object.entries(assembly.submodules ?? {})) {
    if (submodule.readme?.markdown !== undefined) {
      readmes.set(fqn, readmeFingerprint(submodule.readme.markdown));
    }
  }
  return { types, readmes };
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : Number(((value / total) * 100).toFixed(2));
}

export async function seedHistoryLedger(
  releases: readonly BackfillRelease[],
  loadAssembly: (release: BackfillRelease) => Promise<spec.Assembly> = downloadAssembly,
): Promise<BackfillResult> {
  if (releases.length < 2) {
    throw new Error('backfill requires at least two releases');
  }
  const ledger: Ledger = { fingerprintVersion: FINGERPRINT_VERSION, versions: [], types: {}, readmes: {} };
  let previousTypes = new Map<string, string>();
  let previousReadmes = new Map<string, string>();
  let currentTypes = new Map<string, string>();
  let currentReadmes = new Map<string, string>();

  const apply = (
    target: Record<string, LedgerEntry>,
    current: ReadonlyMap<string, string>,
    previous: ReadonlyMap<string, string>,
    releaseIndex: number,
    publishedAt: string,
  ): void => {
    for (const [key, fingerprint] of current) {
      const existing = target[key];
      if (!existing) {
        target[key] = releaseIndex === 0
          ? [null, null, null, fingerprint]
          : [releaseIndex, releaseIndex, publishedAt, fingerprint];
      } else if (releaseIndex > 0 && previous.get(key) !== fingerprint) {
        target[key] = [existing[0], releaseIndex, publishedAt, fingerprint];
      } else if (existing[3] !== fingerprint) {
        target[key] = [existing[0], existing[1], existing[2], fingerprint];
      }
    }
  };

  for (let index = 0; index < releases.length; index += 1) {
    const release = releases[index];
    const assembly = await loadAssembly(release);
    if (assembly.name !== 'aws-cdk-lib' || assembly.version !== release.version) {
      throw new Error(`tarball for ${release.version} contains ${assembly.name}@${assembly.version}`);
    }
    ledger.versions.push(release.version);
    const current = fingerprints(assembly);
    apply(ledger.types, current.types, previousTypes, index, release.publishedAt);
    apply(ledger.readmes, current.readmes, previousReadmes, index, release.publishedAt);
    previousTypes = current.types;
    previousReadmes = current.readmes;
    currentTypes = current.types;
    currentReadmes = current.readmes;
  }

  const currentTypeRows = [...currentTypes.keys()].map((key) => ledger.types[key]);
  const currentReadmeRows = [...currentReadmes.keys()].map((key) => ledger.readmes[key]);
  const introducedTypes = currentTypeRows.filter((row) => row[0] !== null).length;
  const changedTypes = currentTypeRows.filter((row) => row[1] !== null).length;
  const introducedReadmes = currentReadmeRows.filter((row) => row[0] !== null).length;
  const changedReadmes = currentReadmeRows.filter((row) => row[1] !== null).length;
  return {
    ledger,
    coverage: {
      currentTypes: currentTypeRows.length,
      introducedTypes,
      changedTypes,
      introducedPercent: percentage(introducedTypes, currentTypeRows.length),
      changedPercent: percentage(changedTypes, currentTypeRows.length),
      currentReadmes: currentReadmeRows.length,
      introducedReadmes,
      changedReadmes,
    },
  };
}

/** Replace the aws-cdk-lib slice while preserving every other assembly already tracked by the ledger. */
export function mergeSeedLedger(seed: Ledger, existing: Ledger | undefined): Ledger {
  if (!existing) {
    return seed;
  }
  if (existing.fingerprintVersion !== seed.fingerprintVersion) {
    throw new Error(
      `cannot merge fingerprintVersion ${seed.fingerprintVersion} seed into ${existing.fingerprintVersion} ledger`,
    );
  }
  const versions = [...seed.versions];
  const remap = (entry: LedgerEntry): LedgerEntry => {
    const index = (source: number | null): number | null => {
      if (source === null) {
        return null;
      }
      const version = existing.versions[source];
      let target = versions.indexOf(version);
      if (target < 0) {
        versions.push(version);
        target = versions.length - 1;
      }
      return target;
    };
    return [index(entry[0]), index(entry[1]), entry[2], entry[3]];
  };
  const types = { ...seed.types };
  const readmes = { ...seed.readmes };
  for (const [key, entry] of Object.entries(existing.types)) {
    if (!key.startsWith('aws-cdk-lib.')) {
      types[key] = remap(entry);
    }
  }
  for (const [key, entry] of Object.entries(existing.readmes)) {
    if (key !== 'aws-cdk-lib' && !key.startsWith('aws-cdk-lib.')) {
      readmes[key] = remap(entry);
    }
  }
  return { fingerprintVersion: seed.fingerprintVersion, versions, types, readmes };
}
