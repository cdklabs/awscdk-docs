import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { jest } from '@jest/globals';
import { runCli, scratchDir } from './cli-run.js';

const versions = await import('../src/docgen/versions.js');

const upstream = jest.fn<(coreVersion: string) => Promise<string[]>>();
const registry = jest.fn<(url: string) => Promise<unknown>>();

jest.unstable_mockModule('../src/docgen/alpha-module-source.js', () => ({ fetchUpstreamAlphaModules: upstream }));
jest.unstable_mockModule('../src/docgen/versions.js', () => ({
  ...versions,
  fetchJson: registry,
  fetchPackuments: () => versions.fetchPackuments(registry),
}));

const CLI = '../src/docgen/version-refresh-cli.js';
const CORE = '2.300.0';
const ALPHA = '2.300.0-alpha.0';
const NEXT_CORE = '2.301.0';
const NEXT_ALPHA = '2.301.0-alpha.0';
const READY = '@aws-cdk/aws-ready-alpha';
const LATE = '@aws-cdk/aws-late-alpha';
const GONE = '@aws-cdk/aws-gone-alpha';
const ALPHAS = [GONE, LATE, READY];

let dir: string;
let planFile: string;
/** `dist-tags.latest` the mocked registry reports, by package. */
let latest: Map<string, string>;
/** Alpha versions the mocked registry lists, by module. */
let alphaVersions: Map<string, string[]>;

function packument(version: string) {
  return { 'dist-tags': { latest: version }, 'time': { [version]: '2026-01-01T00:00:00.000Z' } };
}

function writeRepo(): void {
  mkdirSync(join(dir, 'projenrc'), { recursive: true });
  writeFileSync(
    join(dir, 'projenrc', 'cdk-versions.json'),
    `${JSON.stringify({ awsCdkLib: CORE, cdkAlpha: ALPHA, cdkAlphaOverrides: {} }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ devDependencies: { 'aws-cdk-lib': CORE, ...Object.fromEntries(ALPHAS.map((name) => [name, ALPHA])) } }),
  );
  writeFileSync(join(dir, 'docgen.config.json'), `${JSON.stringify({ modules: ['aws-cdk-lib', ...ALPHAS] }, null, 2)}\n`);
  const packages = Object.fromEntries(versions.TRACKED_PACKAGES.map((pkg) => [pkg.name, packument(pkg.name === 'aws-cdk-lib' ? CORE : '1.0.0')]));
  writeFileSync(join(dir, 'versions.snapshot.json'), JSON.stringify({ generatedAt: '2026-01-01T00:00:00.000Z', packages }));
}

const readJson = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf-8'));

const run = (args: string[], env: Record<string, string> = {}) =>
  runCli(CLI, { cwd: dir, args, env: { CDK_VERSION_PLAN_FILE: planFile, GITHUB_OUTPUT: undefined, ...env } });

beforeEach(() => {
  dir = scratchDir('version-refresh-cli-');
  planFile = join(dir, 'plan.json');
  writeRepo();
  latest = new Map(versions.TRACKED_PACKAGES.map((pkg) => [pkg.name, pkg.name === 'aws-cdk-lib' ? NEXT_CORE : '1.0.0']));
  alphaVersions = new Map([[READY, [ALPHA, NEXT_ALPHA]], [LATE, [ALPHA]]]);
  upstream.mockResolvedValue([LATE, READY]);
  registry.mockImplementation(async (url) => {
    const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', ''));
    const tracked = latest.get(name);
    if (tracked) {
      return packument(tracked);
    }
    const listed = alphaVersions.get(name);
    if (!listed) {
      throw new Error(`GET ${url}: HTTP 404`);
    }
    return { time: Object.fromEntries(listed.map((version) => [version, '2026-01-01T00:00:00.000Z'])) };
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('version-refresh-cli --plan', () => {
  test('moves the core and alpha pins, holds a late module and drops a gone one', async () => {
    const outputs = join(dir, 'github-output');

    const result = await run(['--plan'], { GITHUB_OUTPUT: outputs });

    expect(result.exitCode).toBeUndefined();
    expect(upstream).toHaveBeenCalledWith(NEXT_CORE);
    const plan = JSON.parse(readFileSync(planFile, 'utf-8'));
    expect(plan.plan).toEqual({
      core: NEXT_CORE,
      alpha: NEXT_ALPHA,
      snapshot: { 'aws-cdk-lib': { from: CORE, to: NEXT_CORE } },
      changed: true,
    });
    expect(plan.alphaResolution).toMatchObject({
      defaultVersion: NEXT_ALPHA,
      overrides: { [LATE]: ALPHA },
      late: [LATE],
      gone: [GONE],
      unknown: [],
    });
    expect(plan.snapshot.packages['aws-cdk-lib']['dist-tags'].latest).toBe(NEXT_CORE);
    expect(plan.summary).toEqual([
      `aws-cdk-lib pin -> ${NEXT_CORE}`,
      `alpha modules pin -> ${NEXT_ALPHA}`,
      `aws-cdk-lib displayed version ${CORE} -> ${NEXT_CORE}`,
      `hold ${LATE} at its current alpha pin`,
      `remove ${GONE}; folder missing at aws-cdk v${NEXT_CORE}`,
    ]);
    expect(result.stdout).toContain('version-refresh: changes detected');
    expect(result.stdout).toContain(`version-refresh: holding 1 late module pin(s): ${LATE}`);
    expect(result.stdout).toContain(`version-refresh: dropping 1 gone module(s): ${GONE}`);
    expect(readFileSync(outputs, 'utf-8')).toBe(`changed=true\ncore=${NEXT_CORE}\nalpha=${NEXT_ALPHA}\n`);
  });

  test('holds every alpha pin when the release tag listing cannot be read', async () => {
    upstream.mockRejectedValue(new Error('GET listing: HTTP 503'));

    const result = await run(['--plan']);

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain('version-refresh: release-tag module list unavailable — holding alpha pins: GET listing: HTTP 503');
    const plan = JSON.parse(readFileSync(planFile, 'utf-8'));
    expect(plan.plan.core).toBe(NEXT_CORE);
    expect(plan.plan.alpha).toBeUndefined();
    expect(plan.alphaResolution).toMatchObject({ defaultVersion: ALPHA, gone: [], unknown: ALPHAS });
    expect(result.stdout).toContain(`version-refresh: holding 3 unknown module pin(s): ${ALPHAS.join(', ')}`);
  });

  test('holds only the module whose registry read failed', async () => {
    alphaVersions.delete(LATE);

    const result = await run(['--plan']);

    expect(result.stdout).toContain(`version-refresh: registry data unavailable for ${LATE} — holding its pin: GET`);
    const plan = JSON.parse(readFileSync(planFile, 'utf-8'));
    expect(plan.alphaResolution).toMatchObject({
      defaultVersion: NEXT_ALPHA,
      overrides: { [LATE]: ALPHA },
      late: [],
      unknown: [LATE],
    });
  });

  test('reports that nothing moved when the registry matches the pins and the snapshot', async () => {
    latest.set('aws-cdk-lib', CORE);
    upstream.mockResolvedValue(ALPHAS);
    alphaVersions.set(GONE, [ALPHA]);
    const outputs = join(dir, 'github-output');

    const result = await run(['--plan'], { GITHUB_OUTPUT: outputs });

    expect(result.stdout).toBe('version-refresh: nothing moved');
    expect(JSON.parse(readFileSync(planFile, 'utf-8')).plan.changed).toBe(false);
    expect(readFileSync(outputs, 'utf-8')).toBe('changed=false\ncore=\nalpha=\n');
  });
});

describe('version-refresh-cli --apply', () => {
  test('writes the pins, the snapshot and the module list from the plan with no network call', async () => {
    await run(['--plan']);
    upstream.mockClear();
    registry.mockClear();

    const result = await run(['--apply']);

    expect(upstream).not.toHaveBeenCalled();
    expect(registry).not.toHaveBeenCalled();
    expect(readJson('projenrc/cdk-versions.json')).toEqual({
      awsCdkLib: NEXT_CORE,
      cdkAlpha: NEXT_ALPHA,
      cdkAlphaOverrides: { [LATE]: ALPHA },
    });
    expect(readJson('versions.snapshot.json').packages['aws-cdk-lib']['dist-tags'].latest).toBe(NEXT_CORE);
    expect(readJson('docgen.config.json').modules).toEqual(['aws-cdk-lib', LATE, READY]);
    expect(result.stdout).toMatch(/^version-refresh: applied\n {2}aws-cdk-lib pin -> 2\.301\.0\n/);
  });

  test('keeps the core pin when only the alpha set changed', async () => {
    latest.set('aws-cdk-lib', CORE);
    alphaVersions.set(READY, [ALPHA]);
    alphaVersions.set(LATE, [ALPHA]);
    await run(['--plan']);

    await run(['--apply']);

    expect(readJson('projenrc/cdk-versions.json')).toEqual({ awsCdkLib: CORE, cdkAlpha: ALPHA, cdkAlphaOverrides: {} });
    expect(readJson('docgen.config.json').modules).toEqual(['aws-cdk-lib', LATE, READY]);
  });

  test('leaves every file untouched when the plan moved nothing', async () => {
    latest.set('aws-cdk-lib', CORE);
    upstream.mockResolvedValue(ALPHAS);
    alphaVersions.set(GONE, [ALPHA]);
    await run(['--plan']);
    const files = ['projenrc/cdk-versions.json', 'versions.snapshot.json', 'docgen.config.json'];
    const before = files.map((file) => readFileSync(join(dir, file), 'utf-8'));

    const result = await run(['--apply']);

    expect(result.stdout).toBe('version-refresh: nothing to apply');
    expect(files.map((file) => readFileSync(join(dir, file), 'utf-8'))).toEqual(before);
  });
});

describe('version-refresh-cli --pr-body', () => {
  test('lists what moved, the ledger note, held pins and removed modules', async () => {
    await run(['--plan']);

    const { stdout } = await run(['--pr-body']);

    expect(stdout).toContain(`## What moved\n\n- aws-cdk-lib pin -> ${NEXT_CORE}\n- alpha modules pin -> ${NEXT_ALPHA}`);
    expect(stdout).toContain(`The version-history ledger was updated from v${NEXT_CORE}`);
    expect(stdout).toContain(`## Alpha pins held back\n\nThese modules still exist in aws-cdk v${NEXT_CORE}`);
    expect(stdout).toContain(`## Alpha modules removed\n\nThese modules are removed because their folders are missing under \`packages/@aws-cdk\` at aws-cdk v${NEXT_CORE}`);
    expect(stdout).toContain(`- \`${GONE}\``);
    expect(stdout).not.toContain('## Alpha pins unchanged after failed reads');
  });

  test('names the modules whose reads failed and leaves out the empty sections', async () => {
    upstream.mockRejectedValue(new Error('GET listing: HTTP 503'));
    latest.set('aws-cdk-lib', CORE);
    latest.set('aws-cdk', '1.0.1');
    await run(['--plan']);

    const { stdout } = await run(['--pr-body']);

    expect(stdout).toContain('- aws-cdk displayed version 1.0.0 -> 1.0.1');
    expect(stdout).toContain('## Alpha pins unchanged after failed reads\n\nRelease-tag or registry data could not be read for these modules.');
    expect(stdout).toContain(ALPHAS.map((name) => `- \`${name}\``).join('\n'));
    expect(stdout).not.toContain('version-history ledger');
    expect(stdout).not.toContain('## Alpha pins held back');
    expect(stdout).not.toContain('## Alpha modules removed');
  });
});

test('version-refresh-cli without a mode prints its usage and fails', async () => {
  const result = await run([]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe('version-refresh: usage: version-refresh-cli --plan | --apply | --pr-body');
});
