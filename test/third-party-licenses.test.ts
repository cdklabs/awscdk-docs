import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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

  test('writes the file at the package root from the production report, skipping platform builds', async () => {
    const pkg = (dir: string, manifest: Record<string, unknown>) => {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'package.json'), JSON.stringify(manifest));
    };
    pkg('.', {
      name: 'fixture',
      version: '0.0.0',
      private: true,
      dependencies: { 'vitepress': '1.6.4', '@esbuild/linux-x64': '0.21.5' },
      devDependencies: { jest: '30.5.2' },
    });
    pkg('node_modules/vitepress', { name: 'vitepress', version: '1.6.4', license: 'MIT' });
    pkg('node_modules/@esbuild/linux-x64', {
      name: '@esbuild/linux-x64',
      version: '0.21.5',
      license: 'MIT',
      os: ['linux'],
      cpu: ['x64'],
    });
    pkg('node_modules/jest', { name: 'jest', version: '30.5.2', license: 'MIT' });

    const file = await generateThirdPartyLicenses(root);
    const text = readFileSync(file, 'utf-8');

    expect(file).toBe(join(root, 'THIRD_PARTY_LICENSES'));
    expect(text).toContain('vitepress@1.6.4\n  License: MIT\n');
    expect(text).not.toContain('jest');
    expect(text).not.toContain('@esbuild/linux-x64');
    expect(text).not.toContain('fixture');
  });
});
