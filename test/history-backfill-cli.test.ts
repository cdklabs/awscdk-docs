import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { jest } from '@jest/globals';
import { runCli, scratchDir } from './cli-run.js';

const backfill = await import('../src/docgen/history-backfill.js');

/** Types each made-up release ships, keyed by version; a type's stability stands in for its shape. */
let releaseTypes: Record<string, Record<string, string>>;
const loaded: string[] = [];

function assembly(version: string) {
  const types = Object.fromEntries(Object.entries(releaseTypes[version]).map(([fqn, stability]) => [
    fqn,
    { assembly: 'aws-cdk-lib', fqn, kind: 'class', name: fqn.split('.').at(-1), docs: { stability } },
  ]));
  return { name: 'aws-cdk-lib', version, types };
}

jest.unstable_mockModule('../src/docgen/history-backfill.js', () => ({
  ...backfill,
  seedHistoryLedger: (releases: Parameters<typeof backfill.seedHistoryLedger>[0]) =>
    backfill.seedHistoryLedger(releases, async (release) => {
      loaded.push(release.version);
      return assembly(release.version) as never;
    }),
}));

const CLI = '../src/docgen/history-backfill-cli.js';
const realFetch = globalThis.fetch;
const VERSIONS = ['2.10.0', '2.11.0', '2.12.0', '2.13.0'];

let dir: string;
let fetchMock: jest.Mock<(url: string) => Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }>>;
let out: string[];

function packument() {
  return {
    versions: Object.fromEntries(VERSIONS.map((v) => [v, { dist: { tarball: `https://registry.example/aws-cdk-lib-${v}.tgz` } }])),
    time: Object.fromEntries(VERSIONS.map((v, i) => [v, `2026-0${i + 1}-01T00:00:00.000Z`])),
  };
}

async function run(args: string[]) {
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => void out.push(String(chunk)) || true);
  const stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => void out.push(`ERR ${String(chunk)}`) || true);
  try {
    return await runCli(CLI, { cwd: dir, args });
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

const summary = () => JSON.parse(out.filter((line) => !line.startsWith('ERR ')).join(''));
const ledger = () => JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf-8'));

beforeEach(() => {
  dir = scratchDir('history-backfill-cli-');
  out = [];
  loaded.length = 0;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { 'aws-cdk-lib': '2.12.0' } }));
  releaseTypes = {
    '2.10.0': { 'aws-cdk-lib.Old': 'stable' },
    '2.11.0': { 'aws-cdk-lib.Old': 'stable', 'aws-cdk-lib.Added': 'experimental' },
    '2.12.0': { 'aws-cdk-lib.Old': 'stable', 'aws-cdk-lib.Added': 'stable' },
    '2.13.0': { 'aws-cdk-lib.Old': 'deprecated' },
  };
  fetchMock = jest.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => packument() }));
  (globalThis as Record<string, unknown>).fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

describe('history-backfill-cli', () => {
  test('seeds the ledger up to the pinned release and prints a summary', async () => {
    const result = await run(['--output', 'ledger.json']);

    expect(result.exitCode).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('https://registry.npmjs.org/aws-cdk-lib');
    expect(loaded).toEqual(['2.10.0', '2.11.0', '2.12.0']);
    expect(out.filter((line) => line.startsWith('ERR backfill:'))).toEqual(
      ['2.10.0', '2.11.0', '2.12.0'].map((v) => `ERR backfill: ${v}\n`),
    );
    expect(ledger().versions).toEqual(['2.10.0', '2.11.0', '2.12.0']);
    expect(ledger().types['aws-cdk-lib.Added'].slice(0, 3)).toEqual([1, 2, '2026-03-01T00:00:00.000Z']);
    expect(ledger().types['aws-cdk-lib.Old'].slice(0, 3)).toEqual([null, null, null]);
    expect(summary()).toMatchObject({
      firstVersion: '2.10.0',
      lastVersion: '2.12.0',
      releases: 3,
      coverage: { currentTypes: 2, introducedTypes: 1, changedTypes: 1 },
      bytes: readFileSync(join(dir, 'ledger.json')).length,
    });
  });

  test('--target and --releases pick the window', async () => {
    await run(['--output', 'ledger.json', '--target', '2.13.0', '--releases', '2']);

    expect(loaded).toEqual(['2.12.0', '2.13.0']);
    expect(summary()).toMatchObject({ firstVersion: '2.12.0', lastVersion: '2.13.0', releases: 2 });
  });

  test('keeps the rows of other assemblies already in the output ledger', async () => {
    writeFileSync(join(dir, 'ledger.json'), JSON.stringify({
      fingerprintVersion: 1,
      versions: ['1.0.0'],
      types: { 'constructs.Construct': [0, 0, '2025-01-01T00:00:00.000Z', 'abc'] },
      readmes: {},
    }));

    await run(['--output', 'ledger.json']);

    const merged = ledger();
    const row = merged.types['constructs.Construct'];
    expect(merged.versions[row[0]]).toBe('1.0.0');
    expect(row.slice(2)).toEqual(['2025-01-01T00:00:00.000Z', 'abc']);
    expect(merged.types['aws-cdk-lib.Added']).toBeDefined();
  });

  test('fails when the registry read fails, writing nothing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) });

    const result = await run(['--output', 'ledger.json']);

    expect(result.exitCode).toBe(1);
    expect(out.join('')).toContain('failed to fetch aws-cdk-lib packument: 503 Service Unavailable');
    expect(loaded).toEqual([]);
    expect(existsSync(join(dir, 'ledger.json'))).toBe(false);
  });

  test.each([
    [['--output'], 'usage: scripts/backfill-version-history.sh'],
    [['output', 'ledger.json'], 'usage: scripts/backfill-version-history.sh'],
    [['--releases', '3'], '--output is required'],
  ])('rejects bad arguments %j before any network call', async (args, message) => {
    const result = await run(args);

    expect(result.exitCode).toBe(1);
    expect(out.join('')).toContain(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('without --target it needs aws-cdk-lib pinned in package.json', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({}));

    const result = await run(['--output', 'ledger.json']);

    expect(result.exitCode).toBe(1);
    expect(out.join('')).toContain('aws-cdk-lib must be pinned in package.json or supplied with --target');
  });
});
