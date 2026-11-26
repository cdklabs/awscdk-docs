import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { jest } from '@jest/globals';
import { runCli, scratchDir } from './cli-run.js';

const upstream = jest.fn<(coreVersion: string) => Promise<string[]>>();
const registry = jest.fn<(url: string) => Promise<unknown>>();
const assemblyTypes = new Map<string, number>();

jest.unstable_mockModule('../src/docgen/alpha-module-source.js', () => ({ fetchUpstreamAlphaModules: upstream }));
jest.unstable_mockModule('../src/docgen/versions.js', () => ({ fetchJson: registry }));
jest.unstable_mockModule('../src/docgen/index.js', () => ({
  loadAssembly: (dir: string) => {
    const name = dir.split('node_modules/')[1];
    const count = assemblyTypes.get(name) ?? 0;
    return { types: Object.fromEntries(Array.from({ length: count }, (_, i) => [`${name}.T${i}`, {}])) };
  },
}));

const CLI = '../src/docgen/module-sync-cli.js';
const CORE = '2.300.0';
const ALPHA = '2.300.0-alpha.0';
const KEPT = '@aws-cdk/aws-kept-alpha';
const GONE = '@aws-cdk/aws-gone-alpha';
const NEW = '@aws-cdk/aws-new-alpha';
const LATE = '@aws-cdk/aws-late-alpha';

let dir: string;
let planFile: string;

function writeRepo(modules: string[]): void {
  mkdirSync(join(dir, 'projenrc'), { recursive: true });
  writeFileSync(
    join(dir, 'projenrc', 'cdk-versions.json'),
    `${JSON.stringify({ awsCdkLib: CORE, cdkAlpha: ALPHA, cdkAlphaOverrides: {} }, null, 2)}\n`,
  );
  writeFileSync(join(dir, 'docgen.config.json'), `${JSON.stringify({ modules }, null, 2)}\n`);
}

function readModules(): string[] {
  return JSON.parse(readFileSync(join(dir, 'docgen.config.json'), 'utf-8')).modules;
}

const run = (args: string[], env: Record<string, string> = {}) =>
  runCli(CLI, { cwd: dir, args, env: { CDK_MODULE_PLAN_FILE: planFile, GITHUB_OUTPUT: undefined, ...env } });

beforeEach(() => {
  dir = scratchDir('module-sync-cli-');
  planFile = join(dir, 'plan.json');
  assemblyTypes.clear();
  upstream.mockResolvedValue([KEPT, NEW, LATE]);
  registry.mockImplementation(async (url) => {
    const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', ''));
    return { time: name === NEW ? { [ALPHA]: '2026-01-01T00:00:00.000Z' } : { '2.299.0-alpha.0': '2025-12-01' } };
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('module-sync-cli --plan', () => {
  test('plans additions, holds and removals against the pinned release, and counts the removed pages', async () => {
    writeRepo(['aws-cdk-lib', 'constructs', KEPT, GONE]);
    assemblyTypes.set(GONE, 4);
    const outputs = join(dir, 'github-output');

    const result = await run(['--plan'], { GITHUB_OUTPUT: outputs });

    expect(result.exitCode).toBeUndefined();
    expect(upstream).toHaveBeenCalledWith(CORE);
    const plan = JSON.parse(readFileSync(planFile, 'utf-8'));
    expect(plan).toEqual({
      plan: { changed: true, additions: [NEW], held: [LATE], removals: [GONE] },
      coreVersion: CORE,
      alphaVersion: ALPHA,
      removalPages: { [GONE]: 5 },
      summary: [`add ${NEW}`, `remove ${GONE}`],
    });
    expect(result.stdout).toContain(`module-sync: changes detected against aws-cdk v${CORE}`);
    expect(result.stdout).toContain(`module-sync: holding 1 module(s) not yet published at ${ALPHA}: ${LATE}`);
    expect(readFileSync(outputs, 'utf-8')).toBe(`changed=true\nadditions=${NEW}\nremovals=${GONE}\n`);
  });

  test('asks the registry only about modules the config does not document yet', async () => {
    writeRepo(['aws-cdk-lib', KEPT, LATE]);

    await run(['--plan']);

    expect(registry.mock.calls.map(([url]) => url)).toEqual([`https://registry.npmjs.org/${NEW}`]);
  });

  test('reports that the documented modules match the release', async () => {
    writeRepo(['aws-cdk-lib', KEPT, NEW, LATE]);

    const result = await run(['--plan']);

    expect(result.stdout).toBe(`module-sync: documented modules match aws-cdk v${CORE}`);
  });

  test('fails with a sanitized message when the release listing cannot be read', async () => {
    writeRepo(['aws-cdk-lib', KEPT]);
    upstream.mockRejectedValue(new Error('GET listing: HTTP 503\n::error::forged'));

    const result = await run(['--plan']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^module-sync: GET listing: HTTP 503/);
    expect(result.stderr).not.toContain('\n::error::');
  });

  test('rejects a config whose modules entry is not a list', async () => {
    writeRepo([]);
    writeFileSync(join(dir, 'docgen.config.json'), '{"modules": "aws-cdk-lib"}\n');

    const result = await run(['--plan']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('module-sync: docgen.config.json: "modules" must be an array');
  });
});

describe('module-sync-cli --apply', () => {
  test('rewrites the config from the plan with no network call', async () => {
    writeRepo(['aws-cdk-lib', 'constructs', KEPT, GONE]);
    assemblyTypes.set(GONE, 2);
    await run(['--plan']);
    upstream.mockClear();
    registry.mockClear();

    const result = await run(['--apply']);

    expect(upstream).not.toHaveBeenCalled();
    expect(registry).not.toHaveBeenCalled();
    expect(readModules()).toContain(NEW);
    expect(readModules()).not.toContain(GONE);
    expect(readModules()).not.toContain(LATE);
    expect(result.stdout).toBe(`module-sync: applied\n  add ${NEW}\n  remove ${GONE}`);
  });

  test('leaves the config untouched when the plan moved nothing', async () => {
    writeRepo(['aws-cdk-lib', KEPT, NEW, LATE]);
    await run(['--plan']);
    const before = readFileSync(join(dir, 'docgen.config.json'), 'utf-8');

    const result = await run(['--apply']);

    expect(result.stdout).toBe('module-sync: nothing to apply');
    expect(readFileSync(join(dir, 'docgen.config.json'), 'utf-8')).toBe(before);
  });
});

describe('module-sync-cli --pr-body', () => {
  test('lists what moved, the pages each removal deletes and what is held back', async () => {
    writeRepo(['aws-cdk-lib', KEPT, GONE, '@aws-cdk/aws-other-gone-alpha']);
    assemblyTypes.set(GONE, 9);
    assemblyTypes.set('@aws-cdk/aws-other-gone-alpha', 1);
    await run(['--plan']);

    const { stdout } = await run(['--pr-body']);

    expect(stdout).toContain(`the packages aws-cdk v${CORE} ships`);
    expect(stdout).toContain(`## What moved\n\n- add ${NEW}\n- remove ${GONE}`);
    expect(stdout).toContain(`Each addition is pinned at \`${ALPHA}\``);
    expect(stdout).toContain('**12 pages** in total');
    expect(stdout).toContain(`- \`${GONE}\`: 10 pages\n- \`@aws-cdk/aws-other-gone-alpha\`: 2 pages`);
    expect(stdout).toContain(`## Held back\n\nThese modules ship in v${CORE} but have not published \`${ALPHA}\``);
    expect(stdout).toContain(`- \`${LATE}\``);
  });

  test('leaves out the sections that have nothing to list', async () => {
    upstream.mockResolvedValue([KEPT, NEW]);
    writeRepo(['aws-cdk-lib', KEPT]);
    await run(['--plan']);

    const { stdout } = await run(['--pr-body']);

    expect(stdout).toContain(`- add ${NEW}`);
    expect(stdout).not.toContain('## Pages this removes');
    expect(stdout).not.toContain('## Held back');
  });

  test('refuses a plan whose versions are not valid', async () => {
    writeFileSync(
      planFile,
      JSON.stringify({ plan: { changed: false, additions: [], held: [], removals: [] }, coreVersion: '2.1.0\nx', alphaVersion: ALPHA, removalPages: {}, summary: [] }),
    );

    const result = await run(['--pr-body']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('plan "coreVersion"');
  });
});

test('module-sync-cli without a mode prints its usage and fails', async () => {
  const result = await run([]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe('module-sync: usage: module-sync-cli --plan | --apply | --pr-body');
});
