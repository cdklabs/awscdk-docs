import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join } from 'path';
import {
  CDK_DIST_DIR_ENV,
  DIST_EXCLUDED_MODULES,
  distDirFromEnv,
  listDistTarballs,
  parseBuildJson,
  planDistInstall,
  readBuildJson,
  readJsiiTarballNames,
  readTarballNames,
  readTarballPackageName,
  verifyInstalledModules,
} from '../src/docgen/dist.js';

const TABLET_FILE = '.jsii.tabl.json.gz';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'dist-mode-'));
}

/** A dist root with a build.json and the named tarballs, each declaring its own package name. */
function fakeDist(dir: string, version: string, packages: Record<string, string>): string {
  mkdirSync(join(dir, 'js'), { recursive: true });
  writeFileSync(join(dir, 'build.json'), JSON.stringify({ version, commit: 'abc123' }));
  for (const [name, fileStem] of Object.entries(packages)) {
    const staging = mkdtempSync(join(tmpdir(), 'pack-'));
    mkdirSync(join(staging, 'package'));
    writeFileSync(join(staging, 'package', 'package.json'), JSON.stringify({ name, version }));
    writeFileSync(join(staging, 'package', '.jsii'), '{}');
    execFileSync('tar', ['-czf', join(dir, 'js', `${fileStem}.tgz`), '-C', staging, 'package']);
    rmSync(staging, { recursive: true, force: true });
  }
  return dir;
}

/** An installed module directory carrying whichever of the docgen inputs are asked for. */
function installModule(
  root: string,
  module: string,
  version: string,
  files: string[] = ['.jsii', TABLET_FILE],
): void {
  const dir = join(root, 'node_modules', module);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: module, version }));
  for (const file of files) {
    writeFileSync(join(dir, file), '');
  }
}

describe('dist mode is opt-in', () => {
  test('an unset or blank variable means normal mode', () => {
    expect(distDirFromEnv({})).toBeUndefined();
    expect(distDirFromEnv({ [CDK_DIST_DIR_ENV]: '' })).toBeUndefined();
    expect(distDirFromEnv({ [CDK_DIST_DIR_ENV]: '   ' })).toBeUndefined();
  });

  test('a relative dist dir is refused, whatever the working directory', () => {
    // Rejecting is what makes this checkable: the shard build reads the variable from its own workspace, so any
    // resolution here would depend on a cwd the test cannot vary meaningfully.
    for (const value of ['dist', './dist', '../dist']) {
      expect(() => distDirFromEnv({ [CDK_DIST_DIR_ENV]: value })).toThrow(
        /CDK_DIST_DIR must be an absolute path/,
      );
    }
  });

  test('equivalent absolute paths resolve to the same canonical directory', () => {
    const dir = scratch();
    const aliases = scratch();
    try {
      const alias = join(aliases, 'dist');
      symlinkSync(dir, alias, 'dir');
      expect(distDirFromEnv({ [CDK_DIST_DIR_ENV]: dir })).toBe(realpathSync(dir));
      expect(distDirFromEnv({ [CDK_DIST_DIR_ENV]: alias })).toBe(realpathSync(dir));
      expect(isAbsolute(distDirFromEnv({ [CDK_DIST_DIR_ENV]: alias })!)).toBe(true);
    } finally {
      rmSync(aliases, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unresolved absolute path is refused', () => {
    const dir = scratch();
    try {
      expect(() => distDirFromEnv({ [CDK_DIST_DIR_ENV]: join(dir, 'missing') })).toThrow(
        /CDK_DIST_DIR must resolve to an existing path/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('build.json is a trust boundary', () => {
  test('the candidate version is read with its commit', () => {
    expect(parseBuildJson('{"version":"2.269.0","commit":"deadbeef"}')).toEqual({
      version: '2.269.0',
      commit: 'deadbeef',
    });
  });

  test('a version that is not a semver version is refused, naming the file and field', () => {
    expect(() => parseBuildJson('{"version":"2.269"}', 'dist/build.json')).toThrow(
      /dist\/build\.json: "version" must be a semver version, got "2\.269"/,
    );
    expect(() => parseBuildJson('{"version":"latest"}')).toThrow(/must be a semver version/);
    expect(() => parseBuildJson('{}')).toThrow(/must be a semver version/);
  });

  test('a trailing-newline injection cannot pass as its own prefix', () => {
    expect(() => parseBuildJson('{"version":"2.269.0\\n../../etc"}')).toThrow(
      /must be a semver version/,
    );
  });

  test('malformed JSON and non-objects are refused rather than coerced', () => {
    expect(() => parseBuildJson('not json')).toThrow(/not valid JSON/);
    expect(() => parseBuildJson('[]')).toThrow(/must contain a JSON object/);
    expect(() => parseBuildJson('null')).toThrow(/must contain a JSON object/);
  });

  test('a dist with no build.json says so', () => {
    const dir = scratch();
    try {
      expect(() => readBuildJson(dir)).toThrow(/has no build\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('tarballs are matched by their declared package name', () => {
  test('a mangled file name does not decide the module', () => {
    const dir = scratch();
    try {
      fakeDist(dir, '2.269.0-alpha.0', {
        '@aws-cdk/aws-msk-alpha': 'aws-cdk-aws-msk-alpha-2.269.0-alpha.0',
      });
      const [tarball] = listDistTarballs(dir);
      expect(readTarballPackageName(tarball)).toBe('@aws-cdk/aws-msk-alpha');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a dist with no js directory says so', () => {
    const dir = scratch();
    try {
      expect(() => listDistTarballs(dir)).toThrow(/has no js\/ directory/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-jsii release tarballs are not treated as documented modules', () => {
    const dir = scratch();
    const staging = scratch();
    try {
      fakeDist(dir, '2.269.0', { 'aws-cdk-lib': 'aws-cdk-lib-2.269.0' });
      mkdirSync(join(staging, 'package'));
      writeFileSync(
        join(staging, 'package', 'package.json'),
        JSON.stringify({ name: 'aws-cdk', version: '2.269.0' }),
      );
      execFileSync('tar', ['-czf', join(dir, 'js', 'aws-cdk-2.269.0.tgz'), '-C', staging, 'package']);

      expect([...readJsiiTarballNames(listDistTarballs(dir)).keys()]).toEqual(['aws-cdk-lib']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(staging, { recursive: true, force: true });
    }
  });

  test('a scoped module resolves from its mangled file name, end to end', () => {
    const dir = scratch();
    try {
      // Both of these pack to a file name starting `aws-cdk-aws-msk-alpha`, so only the archive's own manifest
      // distinguishes them.
      fakeDist(dir, '2.269.0', {
        '@aws-cdk/aws-msk-alpha': 'aws-cdk-aws-msk-alpha-2.269.0-alpha.0',
        'aws-cdk-lib': 'aws-cdk-lib-2.269.0',
      });
      const names = readTarballNames(listDistTarballs(dir));
      expect([...names.keys()].sort()).toEqual(['@aws-cdk/aws-msk-alpha', 'aws-cdk-lib']);

      const plan = planDistInstall(['aws-cdk-lib', '@aws-cdk/aws-msk-alpha'], names);
      expect(plan.installs.map((i) => i.module)).toEqual(['aws-cdk-lib', '@aws-cdk/aws-msk-alpha']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('planning the install', () => {
  const tarballs = new Map([
    ['aws-cdk-lib', '/dist/js/aws-cdk-lib-2.269.0.tgz'],
    ['@aws-cdk/aws-msk-alpha', '/dist/js/aws-cdk-aws-msk-alpha-2.269.0-alpha.0.tgz'],
    ['constructs', '/dist/js/constructs-10.4.2.tgz'],
  ]);

  test('constructs is left to npm even when the dist carries it', () => {
    const plan = planDistInstall(['aws-cdk-lib', 'constructs', '@aws-cdk/aws-msk-alpha'], tarballs);
    expect(plan.excluded).toEqual(['constructs']);
    expect(plan.installs.map((i) => i.module)).toEqual(['aws-cdk-lib', '@aws-cdk/aws-msk-alpha']);
    expect(plan.modules).toEqual(['aws-cdk-lib', 'constructs', '@aws-cdk/aws-msk-alpha']);
    expect(DIST_EXCLUDED_MODULES).toContain('constructs');
  });

  test('an untracked jsii module is installed and added to the effective docgen modules', () => {
    const withNewModule = new Map(tarballs);
    withNewModule.set('@aws-cdk/aws-new-alpha', '/dist/js/aws-cdk-aws-new-alpha-2.269.0-alpha.0.tgz');

    const plan = planDistInstall(['aws-cdk-lib', 'constructs'], withNewModule);
    expect(plan.installs.map((entry) => entry.module)).toEqual([
      'aws-cdk-lib',
      '@aws-cdk/aws-msk-alpha',
      '@aws-cdk/aws-new-alpha',
    ]);
    expect(plan.modules).toEqual([
      'aws-cdk-lib',
      'constructs',
      '@aws-cdk/aws-msk-alpha',
      '@aws-cdk/aws-new-alpha',
    ]);
  });

  test('missing alpha modules are dropped while other modules remain installable', () => {
    const plan = planDistInstall(
      ['aws-cdk-lib', '@aws-cdk/aws-glue-alpha', 'constructs'],
      tarballs,
    );

    expect(plan.installs.map((entry) => entry.module)).toEqual([
      'aws-cdk-lib',
      '@aws-cdk/aws-msk-alpha',
    ]);
    expect(plan.excluded).toEqual(['constructs']);
    expect(plan.dropped).toEqual(['@aws-cdk/aws-glue-alpha']);
    expect(plan.modules).toEqual([
      'aws-cdk-lib',
      'constructs',
      '@aws-cdk/aws-msk-alpha',
    ]);
  });

  test('a stable module with no tarball fails loudly and never falls back to the pin', () => {
    expect(() => planDistInstall(['aws-cdk-lib', '@aws-cdk/cfn-property-mixins'], tarballs)).toThrow(
      /no tarball in the dist for 1 configured module\(s\): @aws-cdk\/cfn-property-mixins/,
    );
  });

  test('every uncovered stable module is named in one error, not just the first', () => {
    expect(() =>
      planDistInstall(['@aws-cdk/cfn-property-mixins', 'aws-cdk-lib', '@aws-cdk/cloud-assembly-schema'], tarballs),
    ).toThrow(/2 configured module\(s\): @aws-cdk\/cfn-property-mixins, @aws-cdk\/cloud-assembly-schema/);
  });
});

describe('verifying what docgen will read', () => {
  test('an assembly and a tablet at the candidate version passes, including the alpha suffix', () => {
    const root = scratch();
    try {
      installModule(root, 'aws-cdk-lib', '2.269.0');
      installModule(root, '@aws-cdk/aws-msk-alpha', '2.269.0-alpha.0');
      expect(() =>
        verifyInstalledModules(root, ['aws-cdk-lib', '@aws-cdk/aws-msk-alpha'], '2.269.0'),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a compressed assembly without its .jsii redirect fails, as docgen would', () => {
    const root = scratch();
    try {
      // jsii reaches .jsii.gz only through the small .jsii redirect file, and throws without it.
      installModule(root, 'aws-cdk-lib', '2.269.0', ['.jsii.gz', TABLET_FILE]);
      expect(() => verifyInstalledModules(root, ['aws-cdk-lib'], '2.269.0')).toThrow(
        /aws-cdk-lib: no \.jsii/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a .jsii redirect beside the compressed assembly passes, as the real tarballs ship', () => {
    const root = scratch();
    try {
      installModule(root, 'aws-cdk-lib', '2.269.0', ['.jsii', '.jsii.gz', TABLET_FILE]);
      expect(() => verifyInstalledModules(root, ['aws-cdk-lib'], '2.269.0')).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a missing tablet fails, because examples would silently stop being translated', () => {
    const root = scratch();
    try {
      installModule(root, 'aws-cdk-lib', '2.269.0', ['.jsii']);
      expect(() => verifyInstalledModules(root, ['aws-cdk-lib'], '2.269.0')).toThrow(
        /aws-cdk-lib: no \.jsii\.tabl\.json\.gz, so examples would not be translated/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a missing assembly fails', () => {
    const root = scratch();
    try {
      installModule(root, 'aws-cdk-lib', '2.269.0', [TABLET_FILE]);
      expect(() => verifyInstalledModules(root, ['aws-cdk-lib'], '2.269.0')).toThrow(
        /aws-cdk-lib: no \.jsii$/m,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a prerelease candidate accepts the alphas, which carry their own identifier', () => {
    const root = scratch();
    try {
      // Under BUMP_CANDIDATE the candidate is e.g. 2.269.0-rc.0 while the alphas stay on -alpha.N, so neither
      // string contains the other and only the release parts line up.
      installModule(root, 'aws-cdk-lib', '2.269.0-rc.0');
      installModule(root, '@aws-cdk/aws-msk-alpha', '2.269.0-alpha.0');
      installModule(root, '@aws-cdk/aws-ivs-alpha', '2.269.0-alpha.999');
      expect(() =>
        verifyInstalledModules(
          root,
          ['aws-cdk-lib', '@aws-cdk/aws-msk-alpha', '@aws-cdk/aws-ivs-alpha'],
          '2.269.0-rc.0',
        ),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a different release under a prerelease candidate is still caught', () => {
    const root = scratch();
    try {
      installModule(root, '@aws-cdk/aws-msk-alpha', '2.268.0-alpha.0');
      expect(() =>
        verifyInstalledModules(root, ['@aws-cdk/aws-msk-alpha'], '2.269.0-rc.0'),
      ).toThrow(/installed 2\.268\.0-alpha\.0, expected the candidate 2\.269\.0-rc\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a module with no readable version is a problem, not a skipped check', () => {
    const root = scratch();
    try {
      const dir = join(root, 'node_modules', 'aws-cdk-lib');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '.jsii'), '');
      writeFileSync(join(dir, TABLET_FILE), '');
      expect(() => verifyInstalledModules(root, ['aws-cdk-lib'], '2.269.0')).toThrow(
        /aws-cdk-lib: no readable version in package\.json/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the previous release surviving the install is caught, not documented as the candidate', () => {
    const root = scratch();
    try {
      installModule(root, 'aws-cdk-lib', '2.268.0');
      expect(() => verifyInstalledModules(root, ['aws-cdk-lib'], '2.269.0')).toThrow(
        /aws-cdk-lib: installed 2\.268\.0, expected the candidate 2\.269\.0/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an uninstalled module is reported, and every problem is aggregated', () => {
    const root = scratch();
    try {
      installModule(root, 'aws-cdk-lib', '2.269.0', ['.jsii']);
      expect(() =>
        verifyInstalledModules(root, ['aws-cdk-lib', '@aws-cdk/aws-msk-alpha'], '2.269.0'),
      ).toThrow(/aws-cdk-lib: no \.jsii\.tabl[\s\S]*@aws-cdk\/aws-msk-alpha: not installed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
