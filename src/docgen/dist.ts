/**
 * Dist mode: install the documented CDK modules from a release candidate's dist instead of the registry pins.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { assertValidVersion, VERSION_PARSE_PATTERN } from './version-format.js';

/** Opt-in switch and dist root: the pipeline's build output directory. */
export const CDK_DIST_DIR_ENV = 'CDK_DIST_DIR';

/** File naming the candidate, at the dist root. */
export const BUILD_JSON_FILE = 'build.json';

/** Subdirectory holding the npm tarballs. */
export const DIST_JS_DIR = 'js';

/** Documented at its own npm range: it releases independently of aws-cdk. */
export const DIST_EXCLUDED_MODULES = ['constructs'];

/** The candidate's identity, as the pipeline records it. */
export interface DistBuild {
  /** Version being released, e.g. `2.269.0`. */
  readonly version: string;
  /** Commit the candidate was built from, when recorded. */
  readonly commit?: string;
}

/**
 * The dist directory the build was told to use, or undefined in normal mode. An absolute path is required: the
 * sharded build reads this from inside a per-shard workspace, so a relative value would resolve somewhere else
 * there than at install time. Rejecting it fails at the install command rather than mid-build.
 */
export function distDirFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[CDK_DIST_DIR_ENV];
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  if (!path.isAbsolute(value)) {
    throw new Error(`${CDK_DIST_DIR_ENV} must be an absolute path, got ${JSON.stringify(value)}`);
  }
  try {
    return fs.realpathSync(value);
  } catch {
    throw new Error(`${CDK_DIST_DIR_ENV} must resolve to an existing path, got ${JSON.stringify(value)}`);
  }
}

/** Parse `build.json`, validating the version through the repo's one version validator. */
export function parseBuildJson(text: string, file = BUILD_JSON_FILE): DistBuild {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err: unknown) {
    throw new Error(`${file}: not valid JSON (${err instanceof Error ? err.message : err})`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: must contain a JSON object`);
  }
  const record = raw as Record<string, unknown>;
  const version = assertValidVersion(`${file}: "version"`, record.version);
  const commit = typeof record.commit === 'string' ? record.commit : undefined;
  return commit === undefined ? { version } : { version, commit };
}

export function readBuildJson(distDir: string): DistBuild {
  const file = path.join(distDir, BUILD_JSON_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(`${CDK_DIST_DIR_ENV}=${distDir} has no ${BUILD_JSON_FILE}`);
  }
  return parseBuildJson(fs.readFileSync(file, 'utf-8'), file);
}

/**
 * The package name a tarball declares. `npm pack` mangles scopes, so `@aws-cdk/aws-msk-alpha` and a hypothetical
 * unscoped `aws-cdk-aws-msk-alpha` produce the same file name; the archive's own manifest is the only reliable key.
 */
export function readTarballPackageName(tarball: string): string {
  const result = spawnSync('tar', ['-xzOf', tarball, 'package/package.json'], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim() || `exit ${result.status}`;
    throw new Error(`${path.basename(tarball)}: could not read package/package.json (${detail})`);
  }
  const name = (JSON.parse(result.stdout) as { name?: unknown }).name;
  if (typeof name !== 'string' || name === '') {
    throw new Error(`${path.basename(tarball)}: package/package.json declares no "name"`);
  }
  return name;
}

/** Absolute paths of the tarballs in a dist, sorted for a stable install order. */
export function listDistTarballs(distDir: string): string[] {
  const dir = path.join(distDir, DIST_JS_DIR);
  if (!fs.existsSync(dir)) {
    throw new Error(`${CDK_DIST_DIR_ENV}=${distDir} has no ${DIST_JS_DIR}/ directory`);
  }
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.tgz'))
    .sort()
    .map((entry) => path.join(dir, entry));
}

/** One documented module mapped onto the tarball that supplies it. */
export interface DistInstall {
  readonly module: string;
  readonly tarball: string;
}

export interface DistInstallPlan {
  readonly installs: DistInstall[];
  /** Configured modules deliberately left to npm — see {@link DIST_EXCLUDED_MODULES}. */
  readonly excluded: string[];
  /** Configured alpha modules omitted because the dist has no matching tarball. */
  readonly dropped: string[];
  /** Modules docgen should read: available configured modules plus new jsii modules supplied by the dist. */
  readonly modules: string[];
}

/**
 * Map configured modules onto the dist and append new jsii modules it supplies. Missing alpha modules are dropped;
 * missing stable modules fail loudly because the dist is authoritative only for additions.
 */
export function planDistInstall(modules: string[], tarballNames: Map<string, string>): DistInstallPlan {
  const installs: DistInstall[] = [];
  const excluded: string[] = [];
  const dropped: string[] = [];
  const missing: string[] = [];
  for (const module of modules) {
    if (DIST_EXCLUDED_MODULES.includes(module)) {
      excluded.push(module);
      continue;
    }
    const tarball = tarballNames.get(module);
    if (tarball === undefined) {
      if (module.endsWith('-alpha')) {
        dropped.push(module);
      } else {
        missing.push(module);
      }
      continue;
    }
    installs.push({ module, tarball });
  }
  if (missing.length > 0) {
    throw new Error(
      `no tarball in the dist for ${missing.length} configured module(s): ${missing.join(', ')}`,
    );
  }

  const configured = new Set(modules);
  const added: string[] = [];
  for (const module of [...tarballNames.keys()].sort()) {
    if (configured.has(module) || DIST_EXCLUDED_MODULES.includes(module)) {
      continue;
    }
    installs.push({ module, tarball: tarballNames.get(module)! });
    added.push(module);
  }
  const droppedSet = new Set(dropped);
  return {
    installs,
    excluded,
    dropped,
    modules: [...modules.filter((module) => !droppedSet.has(module)), ...added],
  };
}

/** Tarball path by declared package name, for every archive in the dist. */
export function readTarballNames(tarballs: string[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const tarball of tarballs) {
    names.set(readTarballPackageName(tarball), tarball);
  }
  return names;
}

/** Tarball path by package name for archives containing the jsii assembly docgen requires. */
export function readJsiiTarballNames(tarballs: string[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const tarball of tarballs) {
    const result = spawnSync('tar', ['-tzf', tarball], {
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status !== 0) {
      const detail = (result.stderr || '').trim() || `exit ${result.status}`;
      throw new Error(`${path.basename(tarball)}: could not list archive (${detail})`);
    }
    if (!result.stdout.split('\n').includes('package/.jsii')) {
      continue;
    }
    const name = readTarballPackageName(tarball);
    if (names.has(name)) {
      throw new Error(`the dist contains more than one jsii tarball for ${name}`);
    }
    names.set(name, tarball);
  }
  return names;
}

/**
 * Names docgen reads beside each other in a module directory. `.jsii` is required even when the assembly is
 * compressed: jsii resolves `.jsii.gz` only through the small `.jsii` redirect file, and throws without it.
 */
const ASSEMBLY_FILE = '.jsii';
const TABLET_FILE = '.jsii.tabl.json.gz';

/** Check each installed module carries what docgen reads, at the candidate's version. */
export function verifyInstalledModules(
  packageRoot: string,
  modules: string[],
  version: string,
): void {
  const problems: string[] = [];
  for (const module of modules) {
    const dir = path.join(packageRoot, 'node_modules', module);
    if (!fs.existsSync(dir)) {
      problems.push(`${module}: not installed`);
      continue;
    }
    if (!fs.existsSync(path.join(dir, ASSEMBLY_FILE))) {
      problems.push(`${module}: no ${ASSEMBLY_FILE}`);
    }
    // loadTablet degrades silently to an empty tablet, so a missing one would publish untranslated examples.
    if (!fs.existsSync(path.join(dir, TABLET_FILE))) {
      problems.push(`${module}: no ${TABLET_FILE}, so examples would not be translated`);
    }
    const installed = installedVersion(dir);
    if (installed === undefined) {
      problems.push(`${module}: no readable version in package.json`);
    } else if (!versionMatches(installed, version)) {
      problems.push(`${module}: installed ${installed}, expected the candidate ${version}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`dist install verification failed:\n  ${problems.join('\n  ')}`);
  }
}

function installedVersion(moduleDir: string): string | undefined {
  const manifest = path.join(moduleDir, 'package.json');
  if (!fs.existsSync(manifest)) {
    return undefined;
  }
  const version = (JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { version?: unknown }).version;
  return typeof version === 'string' ? version : undefined;
}

/**
 * Compare on the release parts only. A candidate carries its own prerelease identifier under `BUMP_CANDIDATE`
 * (`2.269.0-rc.0`) while the alpha modules keep their separate `-alpha.N` one, so neither string contains the other.
 */
function versionMatches(installed: string, candidate: string): boolean {
  const parts = (version: string): string | undefined => {
    const match = version.trim().match(VERSION_PARSE_PATTERN);
    return match === null ? undefined : `${match[1]}.${match[2]}.${match[3]}`;
  };
  const installedParts = parts(installed);
  return installedParts !== undefined && installedParts === parts(candidate);
}
