import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import { VERSIONS_JSON_PATH } from '../site-routes.js';
import { CDK_DIST_DIR_ENV, distDirFromEnv, readBuildJson } from './dist.js';
import { moduleReadmeLink } from './links.js';
import { assertValidVersion, VERSION_PARSE_PATTERN } from './version-format.js';

/**
 * Build-time version data for the /versions page.
 *
 * The VitePress data loader (`docs/versions.data.ts`) calls `loadVersionsData()` while the site builds. It reads
 * a committed snapshot rather than the npm registry, so the build makes no network call and nothing is fetched
 * client-side. Everything here is a pure function of the packument and unit-testable offline.
 */

const NPM_REGISTRY = 'https://registry.npmjs.org';

export interface TrackedPackage {
  /** npm package name. */
  readonly name: string;
  /** Human-facing label for the versions table. */
  readonly label: string;
  /** GitHub repository (`owner/repo`) that publishes the releases. */
  readonly repo: string;
  /**
   * Release tag for a version. aws-cdk-lib releases from `aws/aws-cdk`
   * as `v<version>`; the CLI-adjacent packages release from
   * `aws/aws-cdk-cli` in a monorepo, tagged `<package>@v<version>`.
   */
  readonly releaseTag: (version: string) => string;
  /**
   * Show only the major version. The minor/patch cadence of some packages (e.g. the Cloud Assembly Schema) is
   * independent of aws-cdk-lib and not meaningful to readers, so the version renders as `v<major>`, linking to the
   * latest release within that major.
   */
  readonly majorOnly?: boolean;
  /**
   * API documentation for the latest version of the package. A path starting with `/` is a page on this site — the
   * versions page renders it base-aware via `withBase`, so it must NOT bake in the VitePress `base`. Anything else
   * is an absolute external URL.
   */
  readonly docsUrl: string;
}

/**
 * Site-relative path of this site's own generated API docs for an npm package: the package's `…-readme.html`
 * overview page in the canonical `/v2/docs/` tree. Rendered into a raw `<a>` on the versions page, so the
 * `.html` suffix is explicit. Starts with `/`; the VitePress `base` is applied at render time (`withBase`), never
 * here.
 */
export function siteApiDocsUrl(packageName: string): string {
  return `${moduleReadmeLink(packageName)}.html`;
}

/** The core CDK ecosystem packages listed on the /versions page. */
export const TRACKED_PACKAGES: TrackedPackage[] = [
  {
    name: 'aws-cdk-lib',
    label: 'AWS Construct Library',
    repo: 'aws/aws-cdk',
    releaseTag: (version) => `v${version}`,
    // This site IS the aws-cdk-lib API reference — link to our own
    // generated module docs rather than an external mirror.
    docsUrl: siteApiDocsUrl('aws-cdk-lib'),
  },
  {
    name: 'aws-cdk',
    label: 'AWS CDK Toolkit CLI',
    repo: 'aws/aws-cdk-cli',
    releaseTag: (version) => `aws-cdk@v${version}`,
    docsUrl: 'https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd.html',
  },
  {
    name: '@aws-cdk/toolkit-lib',
    label: 'AWS CDK Toolkit Library',
    repo: 'aws/aws-cdk-cli',
    releaseTag: (version) => `@aws-cdk/toolkit-lib@v${version}`,
    docsUrl: 'https://docs.aws.amazon.com/cdk/api/toolkit-lib/',
  },
  {
    name: '@aws-cdk/cloud-assembly-schema',
    label: 'Cloud Assembly Schema',
    repo: 'aws/aws-cdk-cli',
    releaseTag: (version) => `@aws-cdk/cloud-assembly-schema@v${version}`,
    majorOnly: true,
    // No dedicated docs site — the npm package page (README) is the
    // canonical documentation entry point.
    docsUrl: 'https://www.npmjs.com/package/@aws-cdk/cloud-assembly-schema',
  },
];

/**
 * AWS CDK v1: the v1 line is end-of-life and pinned at its final release, so it is a STATIC entry — hardcoded,
 * never resolved from npm. Its link goes to the archived v1 API reference instead of a GitHub release. `aws-cdk-lib`
 * did not exist in v1; the line shipped as the `@aws-cdk/*` scoped packages, so `@aws-cdk/core` identifies it.
 */
export const CDK_V1 = {
  /** Identifier in `versions.json` (the v1 framework core package). */
  package: '@aws-cdk/core',
  /** Human-facing label for the versions table. */
  label: 'AWS CDK v1',
  /** The final v1 release — hardcoded, v1 is EOL. */
  version: '1.204.0',
  /** Publish timestamp of 1.204.0, ISO-8601 datetime. */
  date: '2023-06-19T20:55:21.633Z',
  /** Release notes for 1.204.0, tagged like every other aws/aws-cdk release. */
  releaseUrl: 'https://github.com/aws/aws-cdk/releases/tag/v1.204.0',
  /** Date v1 reached end of support, ISO `YYYY-MM-DD`. Fixed: the line is closed. */
  endOfSupport: '2023-06-01',
  /** Archived v1 API reference. */
  docsUrl: 'https://docs.aws.amazon.com/cdk/api/v1/',
} as const;

/** Subset of an npm registry packument this module consumes. */
export interface Packument {
  readonly 'dist-tags': { readonly latest: string };
  /** ISO publish timestamps keyed by version (plus created/modified). */
  readonly 'time': Record<string, string>;
}

export interface Release {
  readonly version: string;
  /** Link to the GitHub release for this version. A candidate has no release yet, so its link is dead. */
  readonly releaseUrl: string;
  /** Publish date, ISO `YYYY-MM-DD`. Empty when the registry has no timestamp. */
  readonly releaseDate: string;
}

export interface PackageVersions {
  readonly name: string;
  readonly label: string;
  /**
   * API documentation for the latest version. Site-relative (starts with `/`, rendered via `withBase`) or absolute
   * external URL.
   */
  readonly docsUrl: string;
  /** The latest stable release, or the candidate itself in a candidate build (see CDK_DIST_DIR_ENV). */
  readonly current: Release;
}

export interface VersionsData {
  /** ISO timestamp of when the data was generated (site build time). */
  readonly generatedAt: string;
  /** Date the v1 line reached end of support, ISO `YYYY-MM-DD` — page copy, from {@link CDK_V1}. */
  readonly v1EndOfSupport: string;
  readonly packages: PackageVersions[];
}

/** GitHub release URL for a tracked package version. */
export function releaseUrl(pkg: TrackedPackage, version: string): string {
  return `https://github.com/${pkg.repo}/releases/tag/${encodeURIComponent(pkg.releaseTag(version))}`;
}

/** True for plain `X.Y.Z` versions — pre-releases are not shown. */
export function isStableVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function releaseParts(version: string): number[] {
  const match = version.match(VERSION_PARSE_PATTERN);
  return match === null ? [NaN, NaN, NaN] : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Descending comparator on the release parts of `X.Y.Z`, so a pre-release orders as the release it precedes
 * rather than as `NaN`. For a stable version the release parts are the whole version.
 */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = releaseParts(a);
  const pb = releaseParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pb[i] - pa[i];
    }
  }
  return 0;
}

function toRelease(pkg: TrackedPackage, version: string, time: Record<string, string>): Release {
  const timestamp = time[version];
  return {
    version,
    releaseUrl: releaseUrl(pkg, version),
    releaseDate: timestamp ? timestamp.slice(0, 10) : '',
  };
}

/** The major component of a stable `X.Y.Z` version. */
export function majorOf(version: string): number {
  return Number(version.split('.')[0]);
}

/**
 * A release displayed as its major only: shows `v<major>` but links to (and dates) the latest minor/patch release
 * of that major.
 */
function toMajorRelease(
  pkg: TrackedPackage,
  major: number,
  latestInMajor: string,
  time: Record<string, string>,
): Release {
  const timestamp = time[latestInMajor];
  return {
    version: `${major}`,
    releaseUrl: releaseUrl(pkg, latestInMajor),
    releaseDate: timestamp ? timestamp.slice(0, 10) : '',
  };
}

/** Newest stable release within one major line, or `undefined` when the packument has none. */
function newestInMajor(packument: Packument, major: number): string | undefined {
  return Object.keys(packument.time)
    .filter((version) => isStableVersion(version) && majorOf(version) === major)
    .sort(compareVersionsDesc)[0];
}

/**
 * Major-only view of a packument: the current major, linked to and dated by the latest minor/patch release of that
 * major line.
 */
function majorOnlyPackageVersions(pkg: TrackedPackage, packument: Packument): PackageVersions {
  const latest = packument['dist-tags'].latest;
  const currentMajor = majorOf(latest);

  return {
    name: pkg.name,
    label: pkg.label,
    docsUrl: pkg.docsUrl,
    current: toMajorRelease(
      pkg,
      currentMajor,
      newestInMajor(packument, currentMajor) ?? latest,
      packument.time,
    ),
  };
}

/**
 * Derive the displayed release for one package from its packument: the `latest` dist-tag.
 */
export function packageVersions(pkg: TrackedPackage, packument: Packument): PackageVersions {
  if (pkg.majorOnly) {
    return majorOnlyPackageVersions(pkg, packument);
  }
  return {
    name: pkg.name,
    label: pkg.label,
    docsUrl: pkg.docsUrl,
    current: toRelease(pkg, packument['dist-tags'].latest, packument.time),
  };
}

/** Assemble the /versions page data from already-fetched packuments. */
export function buildVersionsData(
  packuments: Map<string, Packument>,
  now: Date = new Date(),
): VersionsData {
  const packages: PackageVersions[] = [];
  for (const pkg of TRACKED_PACKAGES) {
    const packument = packuments.get(pkg.name);
    if (!packument) {
      throw new Error(`versions: missing packument for ${pkg.name}`);
    }
    packages.push(packageVersions(pkg, packument));
  }
  // The static v1 row — see CDK_V1. Appended last: an EOL line belongs below the live packages.
  packages.push({
    name: CDK_V1.package,
    label: CDK_V1.label,
    docsUrl: CDK_V1.docsUrl,
    current: {
      version: CDK_V1.version,
      releaseUrl: CDK_V1.releaseUrl,
      releaseDate: CDK_V1.date.slice(0, 10),
    },
  });
  return { generatedAt: now.toISOString(), v1EndOfSupport: CDK_V1.endOfSupport, packages };
}

/**
 * One entry of the machine-readable `/versions.json` endpoint. Unlike the HTML page, the version carries all three
 * parts — including for major-only display packages like the Cloud Assembly Schema — so consumers get the exact
 * latest release. A candidate build additionally carries that candidate's pre-release suffix.
 */
export interface VersionsJsonEntry {
  /** npm package name. */
  readonly package: string;
  /**
   * Latest stable version, full `major.minor.patch` — except in a candidate build (see CDK_DIST_DIR_ENV), where the
   * documented package reports the candidate's own version and so carries a pre-release suffix.
   */
  readonly version: string;
  /** Publish timestamp of that version, ISO-8601 datetime. Empty for a candidate, which is not published. */
  readonly date: string;
  /**
   * Release notes for that version: the same GitHub release the HTML page's "current version" column links, so the
   * two surfaces cannot drift. For the static EOL v1 entry it is the 1.204.0 release.
   */
  readonly releaseUrl: string;
  /**
   * API documentation link, always an absolute `https://` URL: consumers of the endpoint have no site to resolve a
   * relative path against, so site-relative page links are absolutized against the configurable site prefix at build
   * time (see `absoluteDocsUrl`). For live packages it is the latest version's docs; for the static EOL v1 entry
   * (see CDK_V1) it is the archived v1 API reference.
   */
  readonly docsUrl: string;
}

export interface VersionsJson {
  /** ISO-8601 timestamp of when the data was generated (site build time). */
  readonly generatedAt: string;
  readonly packages: VersionsJsonEntry[];
}

/**
 * Public-dir-relative path of the machine-readable endpoint, served at `/versions.json` — the same path as the
 * HTML page with the extension swapped. Canonically defined in src/site-routes.ts, shared with the theme.
 */
export { VERSIONS_JSON_PATH } from '../site-routes.js';

/**
 * Default public URL of this site, used to absolutize site-relative docs links in `versions.json`. Overridable at
 * build time via the `DOCS_SITE_URL` env var, same shape as `DOCS_BASE` in the VitePress config. Distinct from
 * `DOCS_BASE`: an override must already include whatever deploy sub-path the site uses.
 */
export const DEFAULT_DOCS_SITE_URL = 'https://docs.aws.amazon.com/cdk/api/';

/**
 * The public site URL every absolute link is built from: `DOCS_SITE_URL` when set, the default otherwise, always
 * with a trailing slash so `new URL(relative, siteUrl)` joins under the deploy sub-path instead of replacing it.
 */
export function docsSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DOCS_SITE_URL ?? DEFAULT_DOCS_SITE_URL;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/**
 * Absolutize a docs URL for the JSON endpoint: a site-relative path
 * (leading `/`) is joined onto the site prefix; anything else is already
 * absolute and passes through unchanged. Tolerates a prefix supplied
 * without a trailing slash — `new URL` against a directory-style base
 * does the join, so no double slash can appear.
 *
 * JSON-only by design: the stored `TRACKED_PACKAGES[].docsUrl` stays
 * site-relative because the HTML page routes it through `withBase` and
 * keys same-tab rendering off the leading `/`.
 */
export function absoluteDocsUrl(docsUrl: string, siteUrl: string = docsSiteUrl()): string {
  if (!docsUrl.startsWith('/')) {
    return docsUrl;
  }
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  return new URL(docsUrl.replace(/^\//, ''), base).href;
}

/**
 * Build the `/versions.json` payload from the same packuments that feed the HTML page (single source of truth —
 * see `buildVersionsData`). Unlike the page, every `docsUrl` here is absolute: a consumer fetching the endpoint has
 * no site to resolve a relative path against.
 */
export function buildVersionsJson(
  packuments: Map<string, Packument>,
  now: Date = new Date(),
): VersionsJson {
  const packages: VersionsJsonEntry[] = [];
  for (const pkg of TRACKED_PACKAGES) {
    const packument = packuments.get(pkg.name);
    if (!packument) {
      throw new Error(`versions: missing packument for ${pkg.name}`);
    }
    const latest = packument['dist-tags'].latest;
    packages.push({
      package: pkg.name,
      version: latest,
      date: packument.time[latest] ?? '',
      releaseUrl: releaseUrl(pkg, latest),
      docsUrl: absoluteDocsUrl(pkg.docsUrl),
    });
  }
  // The static v1 entry — same build-time data as the HTML page (both come from CDK_V1), so page and JSON cannot
  // drift.
  packages.push({
    package: CDK_V1.package,
    version: CDK_V1.version,
    date: CDK_V1.date,
    releaseUrl: CDK_V1.releaseUrl,
    docsUrl: CDK_V1.docsUrl,
  });
  return { generatedAt: now.toISOString(), packages };
}

/**
 * Write the endpoint into the VitePress public dir, from where it is
 * copied verbatim into the built site (honoring `base`) at
 * `VERSIONS_JSON_PATH`.
 */
export function writeVersionsJson(json: VersionsJson, publicDir: string): string {
  const file = path.join(publicDir, VERSIONS_JSON_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return file;
}

/** GET a JSON document, following redirects. Exported for stubbing in tests. */
export function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(fetchJson(new URL(res.headers.location, url).toString()));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url}: HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(30_000, () => request.destroy(new Error(`GET ${url}: timeout`)));
  });
}

/**
 * Fetch packuments for all tracked packages. The registry round-trip is performed by the nightly refresh rather
 * than by the site build; the page data and `versions.json` are derived from one committed snapshot so they cannot
 * drift.
 */
export async function fetchPackuments(
  fetcher: (url: string) => Promise<any> = fetchJson,
): Promise<Map<string, Packument>> {
  const packuments = new Map<string, Packument>();
  await Promise.all(
    TRACKED_PACKAGES.map(async (pkg) => {
      const packument = await fetcher(`${NPM_REGISTRY}/${pkg.name}`);
      packuments.set(pkg.name, packument as Packument);
    }),
  );
  return packuments;
}

/**
 * Committed version snapshot: the registry data the /versions page and `versions.json` are built from, refreshed by
 * the nightly cdk-version-check job and reviewed as a diff in its PR.
 *
 * Two consequences: the site build makes no registry call, and two builds of one commit produce identical output
 * because `generatedAt` comes from the snapshot rather than the clock.
 */
export interface VersionSnapshot {
  /** ISO timestamp of when the snapshot was refreshed from the registry. */
  readonly generatedAt: string;
  /** Trimmed packument per tracked package, keyed by package name. */
  readonly packages: Record<string, Packument>;
}

/** Repo-relative path of the committed snapshot. */
export const VERSION_SNAPSHOT_FILE = 'versions.snapshot.json';

/**
 * The versions a package's rendered row reads: the `latest` dist-tag, plus — for a major-only package — the newest
 * release within the current major, since that is what the row links to and dates.
 *
 * Used to trim the committed snapshot down from a packument with thousands of `time` entries. The trim is safe by
 * test, not by inspection: `packageVersions` over a trimmed packument is asserted to equal it over the full one.
 */
export function renderedVersions(pkg: TrackedPackage, packument: Packument): string[] {
  const latest = packument['dist-tags'].latest;
  if (!pkg.majorOnly) {
    return [latest];
  }
  const current = newestInMajor(packument, majorOf(latest));
  return current === undefined || current === latest ? [latest] : [latest, current];
}

/**
 * Reduce a packument to what the rendered rows read: the `latest`
 * dist-tag and a `time` map holding only the displayed versions.
 */
export function trimPackument(pkg: TrackedPackage, packument: Packument): Packument {
  const time: Record<string, string> = {};
  for (const version of renderedVersions(pkg, packument)) {
    const timestamp = packument.time[version];
    if (timestamp !== undefined) {
      time[version] = timestamp;
    }
  }
  const latest = assertValidVersion(`versions: ${pkg.name} dist-tags.latest`, packument['dist-tags'].latest);
  return { 'dist-tags': { latest }, time };
}

/** Build the committed snapshot from freshly fetched packuments. */
export function buildVersionSnapshot(
  packuments: Map<string, Packument>,
  now: Date = new Date(),
): VersionSnapshot {
  const packages: Record<string, Packument> = {};
  for (const pkg of TRACKED_PACKAGES) {
    const packument = packuments.get(pkg.name);
    if (!packument) {
      throw new Error(`versions: missing packument for ${pkg.name}`);
    }
    packages[pkg.name] = trimPackument(pkg, packument);
  }
  return { generatedAt: now.toISOString(), packages };
}

/** Parse a snapshot, rejecting anything the build could not render. */
export function parseVersionSnapshot(text: string): VersionSnapshot {
  const raw = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${VERSION_SNAPSHOT_FILE}: must contain a JSON object`);
  }
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt))) {
    throw new Error(`${VERSION_SNAPSHOT_FILE}: "generatedAt" must be an ISO timestamp`);
  }
  if (typeof raw.packages !== 'object' || raw.packages === null || Array.isArray(raw.packages)) {
    throw new Error(`${VERSION_SNAPSHOT_FILE}: "packages" must be an object`);
  }
  for (const pkg of TRACKED_PACKAGES) {
    const entry = raw.packages[pkg.name];
    if (typeof entry?.['dist-tags']?.latest !== 'string' || typeof entry?.time !== 'object' || entry.time === null) {
      throw new Error(`${VERSION_SNAPSHOT_FILE}: entry for ${pkg.name} is missing or malformed`);
    }
    assertValidVersion(`${VERSION_SNAPSHOT_FILE}: "${pkg.name}" dist-tags.latest`, entry['dist-tags'].latest);
  }
  return raw as VersionSnapshot;
}

export function readVersionSnapshot(file: string): VersionSnapshot {
  return parseVersionSnapshot(fs.readFileSync(file, 'utf-8'));
}

export function writeVersionSnapshot(snapshot: VersionSnapshot, file: string): void {
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
}

/** The snapshot's packuments in the shape the builders consume. */
export function snapshotPackuments(snapshot: VersionSnapshot): Map<string, Packument> {
  return new Map(Object.entries(snapshot.packages));
}

/** The package this site documents, and the only entry a candidate build overlays. */
export const DOCUMENTED_PACKAGE = 'aws-cdk-lib';

/**
 * Report `version` as the documented package's latest release, leaving the other tracked packages alone. No publish
 * date is recorded: a candidate has none, and both builders render a missing timestamp as an empty date.
 */
export function overlayDistVersion(snapshot: VersionSnapshot, version: string): VersionSnapshot {
  assertValidVersion(`${CDK_DIST_DIR_ENV}: candidate version`, version);
  const entry = snapshot.packages[DOCUMENTED_PACKAGE];
  if (entry === undefined) {
    throw new Error(`${VERSION_SNAPSHOT_FILE}: no entry for ${DOCUMENTED_PACKAGE} to overlay`);
  }
  return {
    ...snapshot,
    packages: {
      ...snapshot.packages,
      [DOCUMENTED_PACKAGE]: { ...entry, 'dist-tags': { latest: version } },
    },
  };
}

/**
 * Page data for the /versions page, read from the committed snapshot, and the machine-readable endpoint written
 * from the same snapshot so the two cannot drift.
 *
 * This is the whole build-time path: `docs/versions.data.ts` calls only this, so what ships is what the tests
 * exercise. It performs no network I/O, and `generatedAt` is the snapshot's refresh time rather than the clock, so
 * the same commit renders the same output — except in dist mode, where the documented version comes from the
 * candidate's `build.json` outside the tree.
 */
export function loadVersionsData(snapshotFile: string, publicDir: string): VersionsData {
  const committed = readVersionSnapshot(snapshotFile);
  const distDir = distDirFromEnv();
  const snapshot = distDir === undefined
    ? committed
    : overlayDistVersion(committed, readBuildJson(distDir).version);
  const packuments = snapshotPackuments(snapshot);
  const generatedAt = new Date(snapshot.generatedAt);
  writeVersionsJson(buildVersionsJson(packuments, generatedAt), publicDir);
  return buildVersionsData(packuments, generatedAt);
}
