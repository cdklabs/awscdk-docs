import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateThirdPartyLicenses, renderThirdPartyLicenses } from '../src/docgen/third-party-licenses.js';

describe('THIRD_PARTY_LICENSES', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cdk-docs-licenses-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('lists packages in name order with license and repository, without local paths', () => {
    const text = renderThirdPartyLicenses({
      'vitepress@1.6.4': {
        licenses: 'MIT',
        path: '/workspace/node_modules/vitepress',
        repository: 'https://github.com/vuejs/vitepress',
      },
      '@shikijs/engine-javascript@2.1.0': {
        licenses: ['MIT'],
        licenseFile: '/workspace/node_modules/@shikijs/engine-javascript/LICENSE',
      },
    });

    expect(text).toContain('@shikijs/engine-javascript@2.1.0\n  License: MIT\n\n');
    expect(text).toContain('vitepress@1.6.4\n  License: MIT\n  Repository: https://github.com/vuejs/vitepress\n');
    expect(text.indexOf('@shikijs/engine-javascript')).toBeLessThan(text.indexOf('vitepress'));
    expect(text).not.toContain('/workspace');
  });

  test('writes the file at the package root from the production report, skipping platform builds', () => {
    writeFileSync(join(root, 'package.json'), '{"private":true}');
    const platformDir = join(root, 'node_modules', '@esbuild', 'linux-x64');
    mkdirSync(platformDir, { recursive: true });
    writeFileSync(join(platformDir, 'package.json'), JSON.stringify({ name: '@esbuild/linux-x64', os: ['linux'], cpu: ['x64'] }));

    const checkerDir = join(root, 'node_modules', 'license-checker', 'bin');
    mkdirSync(checkerDir, { recursive: true });
    const checker = join(checkerDir, 'license-checker');
    writeFileSync(
      checker,
      [
        "const production = process.argv.includes('--production');",
        `const report = { 'vitepress@1.6.4': { licenses: 'MIT' }, '@esbuild/linux-x64@0.21.5': { licenses: 'MIT', path: ${JSON.stringify(platformDir)} } };`,
        "if (!production) report['jest@30.5.2'] = { licenses: 'MIT' };",
        'process.stdout.write(JSON.stringify(report));',
      ].join('\n'),
    );
    chmodSync(checker, 0o755);

    const file = generateThirdPartyLicenses(root, checker);
    const text = readFileSync(file, 'utf-8');

    expect(file).toBe(join(root, 'THIRD_PARTY_LICENSES'));
    expect(text).toContain('vitepress@1.6.4\n  License: MIT\n');
    expect(text).not.toContain('jest');
    expect(text).not.toContain('@esbuild/linux-x64');
  });
});
