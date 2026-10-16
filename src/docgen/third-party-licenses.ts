import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

export const THIRD_PARTY_LICENSES_FILE = 'THIRD_PARTY_LICENSES';

export interface LicenseCheckerRecord {
  readonly licenses?: unknown;
  readonly repository?: unknown;
  readonly path?: unknown;
  readonly [key: string]: unknown;
}

export type LicenseCheckerReport = Readonly<Record<string, LicenseCheckerRecord>>;

interface LicenseEntry {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly repository?: string;
}

function packageIdentity(id: string): { name: string; version: string } {
  const separator = id.lastIndexOf('@');
  if (separator <= 0 || separator === id.length - 1) {
    throw new Error(`license-checker returned an invalid package identifier: ${id}`);
  }
  return { name: id.slice(0, separator), version: id.slice(separator + 1) };
}

function licenseName(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const names = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (names.length > 0) {
      return names.join(', ');
    }
  }
  return 'UNKNOWN';
}

function repositoryUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
    return undefined;
  }
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

// Platform builds (esbuild, rollup, pagefind binaries) differ per machine, so they would make the file churn.
function isPlatformSpecific(record: LicenseCheckerRecord): boolean {
  if (typeof record.path !== 'string') {
    return false;
  }
  const manifest = join(record.path, 'package.json');
  if (!existsSync(manifest)) {
    return false;
  }
  const { os, cpu } = JSON.parse(readFileSync(manifest, 'utf8')) as { os?: unknown; cpu?: unknown };
  return Array.isArray(os) || Array.isArray(cpu);
}

function entries(report: LicenseCheckerReport): LicenseEntry[] {
  return Object.entries(report)
    .filter(([, record]) => !isPlatformSpecific(record))
    .map(([id, record]) => ({
      ...packageIdentity(id),
      license: licenseName(record.licenses),
      repository: repositoryUrl(record.repository),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
}

export function renderThirdPartyLicenses(report: LicenseCheckerReport): string {
  const lines = [
    'THIRD-PARTY LICENSES',
    '',
    'The AWS CDK API Reference uses code and assets from the packages listed below.',
    '',
  ];
  for (const entry of entries(report)) {
    lines.push(`${entry.name}@${entry.version}`, `  License: ${entry.license}`);
    if (entry.repository) {
      lines.push(`  Repository: ${entry.repository}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function collectProductionLicenses(
  packageRoot: string,
  checkerFile = createRequire(import.meta.url).resolve('license-checker/bin/license-checker'),
): LicenseCheckerReport {
  const output = execFileSync(
    process.execPath,
    [checkerFile, '--production', '--json', '--excludePrivatePackages'],
    { cwd: packageRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(output) as LicenseCheckerReport;
}

export function generateThirdPartyLicenses(packageRoot: string, checkerFile?: string): string {
  const outputFile = join(packageRoot, THIRD_PARTY_LICENSES_FILE);
  writeFileSync(outputFile, renderThirdPartyLicenses(collectProductionLicenses(packageRoot, checkerFile)));
  return outputFile;
}
