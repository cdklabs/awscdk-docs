import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { jest } from '@jest/globals';
import { runCli, scratchDir } from './cli-run.js';

const index = await import('../src/docgen/index.js');
const dist = await import('../src/docgen/dist.js');

type Config = { modules: string[] };
const generateDocs = jest.fn<(config: Config, options: Record<string, string>) => string[]>();
const updateHistoryLedger = jest.fn<
  (config: Config, ledgerFile: string, root: string, releasedAt: (name: string, version: string) => string | undefined) =>
  { introduced: number; changed: number; seeded: number }
>();
const generateThirdPartyLicenses = jest.fn<(root: string) => Promise<string>>();
/** Package names the dist tarballs declare, keyed by tarball path. Stands in for listing each archive with `tar`. */
let tarballNames: Map<string, string>;

jest.unstable_mockModule('../src/docgen/index.js', () => ({ ...index, generateDocs, updateHistoryLedger }));
jest.unstable_mockModule('../src/docgen/third-party-licenses.js', () => ({ generateThirdPartyLicenses }));
jest.unstable_mockModule('../src/docgen/dist.js', () => ({
  ...dist,
  readJsiiTarballNames: (tarballs: string[]) =>
    new Map(tarballs.filter((t) => tarballNames.has(t)).map((t) => [tarballNames.get(t)!, t])),
}));

const CLI = '../src/docgen/cli.js';
const MODULES = ['aws-cdk-lib', 'constructs', '@aws-cdk/aws-one-alpha', '@aws-cdk/aws-two-alpha'];

let dir: string;

const run = (args: string[], env: Record<string, string | undefined> = {}) =>
  runCli(CLI, { cwd: dir, args, env: { CDK_DIST_DIR: undefined, ...env } });

beforeEach(() => {
  dir = scratchDir('docgen-cli-');
  writeFileSync(join(dir, 'docgen.config.json'), JSON.stringify({ modules: MODULES }));
  tarballNames = new Map();
  generateDocs.mockReset().mockReturnValue(['a.md', 'b.md', 'c.md']);
  updateHistoryLedger.mockReset().mockReturnValue({ introduced: 2, changed: 1, seeded: 0 });
  generateThirdPartyLicenses.mockReset().mockResolvedValue(join(dir, 'THIRD_PARTY_LICENSES'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A dist dir whose `js/` folder holds one tarball per named package. */
function makeDist(packages: string[]): string {
  const distDir = join(dir, 'dist');
  mkdirSync(join(distDir, 'js'), { recursive: true });
  for (const [i, name] of packages.entries()) {
    const tarball = join(distDir, 'js', `pkg-${i}.tgz`);
    writeFileSync(tarball, '');
    tarballNames.set(tarball, name);
  }
  return distDir;
}

describe('docgen cli', () => {
  test('generates the configured modules into the site layout and reports the count', async () => {
    const result = await run([]);

    expect(result.exitCode).toBeUndefined();
    const [config, options] = generateDocs.mock.calls[0];
    expect(config.modules).toEqual(MODULES);
    expect(options).toEqual({
      outDir: join(dir, 'docs', 'v2'),
      publicDir: join(dir, 'docs', 'public'),
      overviewFile: join(dir, 'docs', 'v2', 'index.md'),
      overviewSourceFile: join(dir, 'docs', 'aws-construct-library.md'),
      agentOutDir: join(dir, 'dist-agent-markdown'),
      ledgerFile: join(dir, 'docgen.baseline.json'),
    });
    expect(result.stdout).toBe(`docgen: generated 3 files for ${MODULES.join(', ')}`);
  });

  test('a dist drops the alpha modules it lacks and adds the new jsii modules it supplies', async () => {
    const distDir = makeDist(['aws-cdk-lib', '@aws-cdk/aws-one-alpha', '@aws-cdk/aws-new-alpha']);

    const result = await run([], { CDK_DIST_DIR: distDir });

    expect(generateDocs.mock.calls[0][0].modules).toEqual([
      'aws-cdk-lib',
      'constructs',
      '@aws-cdk/aws-one-alpha',
      '@aws-cdk/aws-new-alpha',
    ]);
    expect(result.stdout).toContain('for aws-cdk-lib, constructs, @aws-cdk/aws-one-alpha, @aws-cdk/aws-new-alpha');
  });

  test('a dist missing a stable module fails before generating anything', async () => {
    const distDir = makeDist(['@aws-cdk/aws-one-alpha']);

    const result = await run([], { CDK_DIST_DIR: distDir });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('docgen: no tarball in the dist for 1 configured module(s): aws-cdk-lib');
    expect(generateDocs).not.toHaveBeenCalled();
  });

  test('--update-ledger dates changes by the release times in the committed snapshot', async () => {
    writeFileSync(join(dir, 'versions.snapshot.json'), JSON.stringify({
      generatedAt: '2026-01-02T00:00:00.000Z',
      packages: Object.fromEntries(['aws-cdk-lib', 'aws-cdk', '@aws-cdk/toolkit-lib', '@aws-cdk/cloud-assembly-schema']
        .map((name) => [name, { 'dist-tags': { latest: '2.5.0' }, 'time': { '2.5.0': `${name} published` } }])),
    }));

    const result = await run(['--update-ledger']);

    expect(generateDocs).not.toHaveBeenCalled();
    const [config, ledgerFile, root, releasedAt] = updateHistoryLedger.mock.calls[0];
    expect(config.modules).toEqual(MODULES);
    expect([ledgerFile, root]).toEqual([join(dir, 'docgen.baseline.json'), dir]);
    expect(releasedAt('aws-cdk-lib', '2.5.0')).toBe('aws-cdk-lib published');
    expect(releasedAt('aws-cdk-lib', '2.4.0')).toBeUndefined();
    expect(releasedAt('constructs', '10.0.0')).toBeUndefined();
    expect(result.stdout).toBe(`docgen: ledger ${join(dir, 'docgen.baseline.json')} — 2 introduced, 1 changed, 0 seeded`);
  });

  test('--update-ledger without a snapshot leaves every change undated', async () => {
    await run(['--update-ledger']);

    const releasedAt = updateHistoryLedger.mock.calls[0][3];
    expect(releasedAt('aws-cdk-lib', '2.5.0')).toBeUndefined();
  });

  test('--third-party-licenses writes the license file and nothing else', async () => {
    const result = await run(['--third-party-licenses']);

    expect(generateThirdPartyLicenses).toHaveBeenCalledWith(dir);
    expect(generateDocs).not.toHaveBeenCalled();
    expect(updateHistoryLedger).not.toHaveBeenCalled();
    expect(result.stdout).toBe(`docgen: wrote ${join(dir, 'THIRD_PARTY_LICENSES')}`);
  });

  test('a bad config fails with the docgen prefix', async () => {
    writeFileSync(join(dir, 'docgen.config.json'), JSON.stringify({ modules: 'aws-cdk-lib' }));

    const result = await run([]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(`docgen: ${join(dir, 'docgen.config.json')}: "modules" must be an array of package names`);
  });
});
