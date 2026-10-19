import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { gzipSync } from 'zlib';
import { CDK_DIST_DIR_ENV } from '../src/docgen/dist.js';

const ROOT = resolve(import.meta.dirname, '..');
const TABLET_FILE = '.jsii.tabl.json.gz';

/** A tarball shaped like `npm pack` output, carrying what docgen reads beside the manifest. */
function packModule(jsDir: string, name: string, version: string, fileStem: string): void {
  const staging = mkdtempSync(join(tmpdir(), 'pack-'));
  const pkg = join(staging, 'package');
  const fqn = `${name}.Widget`;
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, version }));
  writeFileSync(join(pkg, '.jsii'), JSON.stringify({
    schema: 'jsii/0.10.0',
    name,
    version,
    license: 'Apache-2.0',
    description: 'Dist fixture',
    homepage: 'https://example.com',
    repository: { type: 'git', url: 'https://example.com/repo.git' },
    author: { name: 'Test', roles: ['author'] },
    jsiiVersion: '5.9.0',
    targets: { js: { npm: name } },
    types: {
      [fqn]: { assembly: name, fqn, kind: 'class', name: 'Widget', docs: { summary: 'A new widget.' } },
    },
    fingerprint: 'fixture',
  }));
  writeFileSync(join(pkg, TABLET_FILE), gzipSync(JSON.stringify({
    version: '2',
    toolVersion: '5.9.0',
    snippets: {},
  })));
  execFileSync('tar', ['-czf', join(jsDir, `${fileStem}.tgz`), '-C', staging, 'package']);
  rmSync(staging, { recursive: true, force: true });
}

/** A throwaway package root with its own docgen config, plus a dist beside it. */
function scaffold(modules: string[], version: string, packed: Array<[string, string]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dist-cli-'));
  writeFileSync(join(dir, 'docgen.config.json'), `${JSON.stringify({ modules }, null, 2)}\n`);
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'scratch', version: '0.0.0', private: true }, null, 2)}\n`,
  );
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'aws-construct-library.md'), '# Construct Library\n');
  const jsDir = join(dir, 'dist', 'js');
  mkdirSync(jsDir, { recursive: true });
  writeFileSync(join(dir, 'dist', 'build.json'), JSON.stringify({ version, commit: 'abc123' }));
  for (const [name, stem] of packed) {
    packModule(jsDir, name, name.endsWith('-alpha') ? `${version}-alpha.0` : version, stem);
  }
  return dir;
}

describe('docs:dist:install task', () => {
  test('is defined and execs the dist-install CLI', () => {
    // Guards the task itself disappearing or being re-pointed, the way cdk:pin is already guarded.
    const tasks = JSON.parse(readFileSync(join(ROOT, '.projen', 'tasks.json'), 'utf-8'));
    expect(tasks.tasks['docs:dist:install'].steps[0].exec).toContain('src/docgen/dist-install-cli.ts');
  });
});

describe('dist install CLI end to end', () => {
  // Every helper is unit-covered, but the wiring is only covered by running it: that --no-save leaves the manifest
  // untouched, that verification runs AFTER the install, and that a bad configuration exits non-zero. The
  // install-failed branch is not covered — see the ADR.
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  const cli = join(ROOT, 'src', 'docgen', 'dist-install-cli.ts');
  const docgenCli = join(ROOT, 'src', 'docgen', 'cli.ts');

  function run(cwd: string, env: Record<string, string | undefined>) {
    // cwd is a temp dir, so the tsconfig cannot be discovered and has to be passed.
    const result = spawnSync(tsx, ['--tsconfig', join(ROOT, 'tsconfig.json'), cli], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }

  test('installs tracked and new dist tarballs without changing the manifest', () => {
    const dir = scaffold(
      ['aws-cdk-lib', '@aws-cdk/aws-msk-alpha', 'constructs'],
      '2.269.0',
      [
        ['aws-cdk-lib', 'aws-cdk-lib-2.269.0'],
        ['@aws-cdk/aws-msk-alpha', 'aws-cdk-aws-msk-alpha-2.269.0-alpha.0'],
        ['@aws-cdk/aws-new-alpha', 'aws-cdk-aws-new-alpha-2.269.0-alpha.0'],
      ],
    );
    try {
      const manifestBefore = readFileSync(join(dir, 'package.json'), 'utf-8');
      const { status, out } = run(dir, { [CDK_DIST_DIR_ENV]: join(dir, 'dist') });

      expect(out).toContain('installed 3 module(s) at 2.269.0');
      expect(out).toContain('left constructs to npm');
      expect(status).toBe(0);

      // --no-save: the manifest is what `npm ci` reads, so a saved dependency would break reproducibility.
      expect(readFileSync(join(dir, 'package.json'), 'utf-8')).toBe(manifestBefore);

      const installed = join(dir, 'node_modules', '@aws-cdk', 'aws-msk-alpha');
      expect(JSON.parse(readFileSync(join(installed, 'package.json'), 'utf-8')).version).toBe('2.269.0-alpha.0');
      expect(readFileSync(join(installed, TABLET_FILE)).length).toBeGreaterThan(0);
      const added = join(dir, 'node_modules', '@aws-cdk', 'aws-new-alpha');
      expect(JSON.parse(readFileSync(join(added, 'package.json'), 'utf-8')).version).toBe('2.269.0-alpha.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test('docgen generates pages for a jsii module supplied only by the dist', () => {
    const dir = scaffold([], '2.269.0', [
      ['@aws-cdk/aws-new-alpha', 'aws-cdk-aws-new-alpha-2.269.0-alpha.0'],
    ]);
    try {
      expect(run(dir, { [CDK_DIST_DIR_ENV]: join(dir, 'dist') }).status).toBe(0);
      const result = spawnSync(tsx, ['--tsconfig', join(ROOT, 'tsconfig.json'), docgenCli], {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, [CDK_DIST_DIR_ENV]: join(dir, 'dist') },
      });

      expect(result.status).toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('@aws-cdk/aws-new-alpha');
      expect(existsSync(join(dir, 'docs', 'v2', 'docs', '@aws-cdk_aws-new-alpha.Widget.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test('a module the dist does not pack fails after nothing is installed', () => {
    const dir = scaffold(['aws-cdk-lib', '@aws-cdk/aws-ivs-alpha'], '2.269.0', [
      ['aws-cdk-lib', 'aws-cdk-lib-2.269.0'],
    ]);
    try {
      const { status, out } = run(dir, { [CDK_DIST_DIR_ENV]: join(dir, 'dist') });
      expect(out).toContain('@aws-cdk/aws-ivs-alpha');
      expect(status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('an unset variable exits non-zero rather than doing nothing quietly', () => {
    const dir = scaffold(['aws-cdk-lib'], '2.269.0', [['aws-cdk-lib', 'aws-cdk-lib-2.269.0']]);
    try {
      const { status, out } = run(dir, { [CDK_DIST_DIR_ENV]: undefined });
      expect(out).toContain(`${CDK_DIST_DIR_ENV} is not set`);
      expect(status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('a relative variable is refused before anything is installed', () => {
    const dir = scaffold(['aws-cdk-lib'], '2.269.0', [['aws-cdk-lib', 'aws-cdk-lib-2.269.0']]);
    try {
      const { status, out } = run(dir, { [CDK_DIST_DIR_ENV]: 'dist' });
      expect(out).toContain('must be an absolute path');
      expect(status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
