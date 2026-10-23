import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  alphaVersionForModule,
  CDK_PIN_FILE_KEYS,
  CDK_PIN_KEYS,
  CDK_PINS_FILE,
  formatCdkPins,
  isCdkPinKey,
  parseCdkPins,
  readCdkPins,
  withCdkPin,
  writeCdkPins,
} from '../src/docgen/pins.js';

/**
 * Both CDK version pins live in
 * projenrc/cdk-versions.json as structured data, so the nightly
 * cdk-version-check bot edits JSON instead of running a regex over
 * TypeScript source. The workflow's own assertions live in
 * test/freshness.test.ts, which owns that file.
 */
const ROOT = join(import.meta.dirname, '..');
const pinsPath = join(ROOT, CDK_PINS_FILE);
const projenrc = readFileSync(join(ROOT, '.projenrc.ts'), 'utf-8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

describe('cdk-versions.json pins file', () => {
  const pins = readCdkPins(pinsPath);

  test('declares the core pin, alpha default, and alpha holds in stable order', () => {
    expect(Object.keys(JSON.parse(readFileSync(pinsPath, 'utf-8')))).toEqual([...CDK_PIN_FILE_KEYS]);
    expect(pins.cdkAlphaOverrides).toEqual({});
  });

  test('the core pin is stable and every alpha pin has the alpha suffix', () => {
    expect(pins.awsCdkLib).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pins.cdkAlpha).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    for (const version of Object.values(pins.cdkAlphaOverrides)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    }
  });

  test('the generated package.json resolves each module through its own held pin', () => {
    expect(pkg.devDependencies['aws-cdk-lib']).toBe(pins.awsCdkLib);

    const alphas = Object.keys(pkg.devDependencies).filter((name) => name.endsWith('-alpha'));
    expect(alphas.length).toBeGreaterThan(0);
    for (const name of alphas) {
      expect(pkg.devDependencies[name]).toBe(alphaVersionForModule(pins, name));
    }
  });
});

describe('dependency upgrades leave the CDK pins alone', () => {
  // The upgrade tasks run under a release cooldown, so any of them touching a pinned CDK package could roll it
  // back to an older release. Asserted on the generated task definitions, the steps the upgrade workflows run.
  const tasks = JSON.parse(readFileSync(join(ROOT, '.projen', 'tasks.json'), 'utf-8')).tasks;
  const pins = readCdkPins(pinsPath);
  const pinned = Object.keys(pkg.devDependencies).filter(
    (name) => pkg.devDependencies[name] === pins.awsCdkLib || pkg.devDependencies[name] === pins.cdkAlpha,
  );
  const upgradeTasks = Object.keys(tasks).filter((name) => name.startsWith('upgrade'));

  test('finds the pinned packages and the upgrade tasks', () => {
    expect(pinned).toEqual(expect.arrayContaining(['aws-cdk-lib', '@aws-cdk/cfn-property-mixins']));
    expect(pinned.some((name) => name.endsWith('-alpha'))).toBe(true);
    expect(upgradeTasks).toEqual(expect.arrayContaining(['upgrade', 'upgrade-dev-deps']));
  });

  test.each(upgradeTasks)('%s never names a pinned CDK package', (task) => {
    const steps = JSON.stringify(tasks[task].steps ?? []);
    for (const name of pinned) {
      expect(steps).not.toMatch(new RegExp(`[",=]${name.replace(/[/\\-]/g, '\\$&')}[",]`));
    }
  });
});

describe('.projenrc.ts reads the pins instead of hardcoding them', () => {
  // Config shape with no produced-output counterpart throughout: the pinned
  // versions themselves are asserted above against the generated
  // package.json, but WHERE they are written down is a property of the source
  // file alone.
  test('imports the pins file', () => {
    expect(projenrc).toContain("from './projenrc/cdk-versions.json'");
  });

  test('holds no aws-cdk-lib version literal for a regex to target', () => {
    expect(projenrc).not.toMatch(/aws-cdk-lib@\d/);
  });

  test('holds no alpha version literal', () => {
    expect(projenrc).not.toMatch(/\d+\.\d+\.\d+-alpha\.\d+/);
  });
});

describe('cdk:pin task', () => {
  test('is defined, and forwards its arguments to the pins CLI', () => {
    // The workflow's call site is pinned in test/freshness.test.ts; this
    // catches the task itself disappearing, the way that suite already
    // guards docs:baseline.
    const tasks = JSON.parse(readFileSync(join(ROOT, '.projen', 'tasks.json'), 'utf-8'));
    const step = tasks.tasks['cdk:pin'].steps[0];
    expect(step.exec).toContain('src/docgen/pins-cli.ts');
    expect(step.receiveArgs).toBe(true);
  });
});

describe('cdk:pin CLI end to end', () => {
  // The file the nightly workflow actually invokes. Every helper below is
  // covered individually, but the wiring between them — argv order, the
  // non-zero exit, the no-op branch — is only covered by running it.
  // Spawns the source, not lib/, so there is no compile-ordering flake.
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  const cli = join(ROOT, 'src', 'docgen', 'pins-cli.ts');

  function run(args: string[], pins = { awsCdkLib: '2.268.0', cdkAlpha: '2.266.0-alpha.0', cdkAlphaOverrides: {} }) {
    const dir = mkdtempSync(join(tmpdir(), 'pins-cli-'));
    const file = join(dir, CDK_PINS_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeCdkPins(pins, file);
    const before = readFileSync(file, 'utf-8');
    // cwd is a temp dir, so the tsconfig cannot be discovered and has to be passed.
    const result = spawnSync(tsx, ['--tsconfig', join(ROOT, 'tsconfig.json'), cli, ...args], {
      cwd: dir,
      encoding: 'utf-8',
    });
    const after = readFileSync(file, 'utf-8');
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, out: `${result.stdout}${result.stderr}`, before, after };
  }

  test('a successful bump rewrites the pin and exits 0', () => {
    const r = run(['awsCdkLib', '2.269.0']);
    expect(r.status).toBe(0);
    expect(parseCdkPins(r.after)).toEqual({
      awsCdkLib: '2.269.0',
      cdkAlpha: '2.266.0-alpha.0',
      cdkAlphaOverrides: {},
    });
    expect(r.out).toContain('awsCdkLib 2.268.0 -> 2.269.0');
  });

  test('bumps the alpha pin too — the key is not hardcoded', () => {
    const r = run(['cdkAlpha', '2.269.0-alpha.0']);
    expect(r.status).toBe(0);
    expect(parseCdkPins(r.after).cdkAlpha).toBe('2.269.0-alpha.0');
  });

  test('a pin already at the requested version is a byte-identical no-op, still exiting 0', () => {
    const r = run(['awsCdkLib', '2.268.0']);
    expect(r.status).toBe(0);
    expect(r.after).toBe(r.before);
    expect(r.out).toContain('already at 2.268.0');
  });

  test('a bad value exits 1 and leaves the file untouched', () => {
    // The claim the workflow relies on: a broken pin fails the step
    // instead of being committed.
    const r = run(['awsCdkLib', 'latest']);
    expect(r.status).toBe(1);
    expect(r.after).toBe(r.before);
    expect(r.out).toContain('must be a semver version');
  });

  test('an unknown key exits 1 and names the valid keys', () => {
    const r = run(['awsCdkLibrary', '2.269.0']);
    expect(r.status).toBe(1);
    expect(r.after).toBe(r.before);
    expect(r.out).toContain('awsCdkLib, cdkAlpha');
  });

  test('a missing argument exits 1 with usage naming both keys', () => {
    const r = run(['awsCdkLib']);
    expect(r.status).toBe(1);
    expect(r.after).toBe(r.before);
    expect(r.out).toContain('usage: cdk:pin <awsCdkLib|cdkAlpha> <version>');
  });
});

describe('pins module', () => {
  test('uses a held pin only for its named alpha module', () => {
    const pins = parseCdkPins(JSON.stringify({
      awsCdkLib: '2.269.0',
      cdkAlpha: '2.269.0-alpha.0',
      cdkAlphaOverrides: { '@aws-cdk/aws-glue-alpha': '2.268.0-alpha.0' },
    }));
    expect(alphaVersionForModule(pins, '@aws-cdk/aws-glue-alpha')).toBe('2.268.0-alpha.0');
    expect(alphaVersionForModule(pins, '@aws-cdk/aws-ivs-alpha')).toBe('2.269.0-alpha.0');
    expect(() => parseCdkPins(JSON.stringify({
      ...pins,
      cdkAlphaOverrides: { 'not-an-alpha': '2.268.0-alpha.0' },
    }))).toThrow(/invalid alpha module override/);
  });

  test('round-trips through parse and format, normalizing key order', () => {
    const text = formatCdkPins({
      cdkAlpha: '2.266.0-alpha.0',
      awsCdkLib: '2.268.0',
      cdkAlphaOverrides: {},
    });
    expect(text).toBe('{\n  "awsCdkLib": "2.268.0",\n  "cdkAlpha": "2.266.0-alpha.0",\n  "cdkAlphaOverrides": {}\n}\n');
    expect(parseCdkPins(text)).toEqual({
      awsCdkLib: '2.268.0',
      cdkAlpha: '2.266.0-alpha.0',
      cdkAlphaOverrides: {},
    });
  });

  test('writeCdkPins emits exactly what formatCdkPins produces, and readCdkPins reads it back', () => {
    // The one mutating path in this change, and it runs unattended in CI.
    const dir = mkdtempSync(join(tmpdir(), 'pins-'));
    try {
      const file = join(dir, 'cdk-versions.json');
      const pins = { awsCdkLib: '2.269.0', cdkAlpha: '2.269.0-alpha.0', cdkAlphaOverrides: {} };
      writeCdkPins(pins, file);
      expect(readFileSync(file, 'utf-8')).toBe(formatCdkPins(pins));
      expect(readCdkPins(file)).toEqual(pins);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a rejected value leaves the file byte-for-byte untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pins-'));
    try {
      const file = join(dir, 'cdk-versions.json');
      const pins = { awsCdkLib: '2.268.0', cdkAlpha: '2.266.0-alpha.0', cdkAlphaOverrides: {} };
      writeCdkPins(pins, file);
      const before = readFileSync(file, 'utf-8');

      // Validation happens in withCdkPin, before writeCdkPins is reached,
      // so a bad pin can never be committed.
      expect(() => writeCdkPins(withCdkPin(readCdkPins(file), 'awsCdkLib', 'latest'), file)).toThrow(
        /must be a semver version/,
      );
      expect(readFileSync(file, 'utf-8')).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('withCdkPin replaces one pin and leaves the other alone', () => {
    const pins = { awsCdkLib: '2.268.0', cdkAlpha: '2.266.0-alpha.0', cdkAlphaOverrides: {} };
    expect(withCdkPin(pins, 'awsCdkLib', '2.269.0')).toEqual({
      awsCdkLib: '2.269.0',
      cdkAlpha: '2.266.0-alpha.0',
      cdkAlphaOverrides: {},
    });
  });

  test('rejects a value that is not a version, rather than writing it', () => {
    const pins = { awsCdkLib: '2.268.0', cdkAlpha: '2.266.0-alpha.0', cdkAlphaOverrides: {} };
    expect(() => withCdkPin(pins, 'awsCdkLib', 'latest')).toThrow(/must be a semver version/);
    expect(() => withCdkPin(pins, 'awsCdkLib', '')).toThrow(/must be a semver version/);
  });

  test('rejects a malformed or incomplete file loudly', () => {
    expect(() => parseCdkPins('[]')).toThrow(/must contain a JSON object/);
    expect(() => parseCdkPins('{"awsCdkLib":"2.268.0"}')).toThrow(/"cdkAlpha"/);
    expect(() => parseCdkPins('{"awsCdkLib":"v2","cdkAlpha":"2.266.0-alpha.0"}')).toThrow(/"awsCdkLib"/);
  });

  test('isCdkPinKey narrows an untrusted CLI argument', () => {
    expect(CDK_PIN_KEYS.every(isCdkPinKey)).toBe(true);
    expect(isCdkPinKey('awsCdkLibrary')).toBe(false);
  });
});
