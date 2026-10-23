import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fetchUpstreamAlphaModules } from '../src/docgen/alpha-module-source.js';
import { generateDocs, loadConfig } from '../src/docgen/index.js';
import {
  ALPHA_MODULE_PATTERN,
  alphaModulesOf,
  applyModuleSync,
  describeModuleSync,
  modulePageCount,
  planModuleSync,
  renderModuleOutputs,
  upstreamAlphaModules,
} from '../src/docgen/module-sync.js';
import { alphaVersionForModule } from '../src/docgen/pins.js';

const ROOT = resolve(import.meta.dirname, '..');
const ALPHA = '2.270.0-alpha.0';

const listing = (...names: string[]) => names.map((name) => ({ name, type: 'dir' }));

describe('alpha module names', () => {
  test('the pattern admits only scoped -alpha package names', () => {
    expect(ALPHA_MODULE_PATTERN.test('@aws-cdk/aws-glue-alpha')).toBe(true);
    expect(ALPHA_MODULE_PATTERN.test('@aws-cdk/integ-tests-alpha')).toBe(true);
    expect(ALPHA_MODULE_PATTERN.test('@aws-cdk/cfn-property-mixins')).toBe(false);
    expect(ALPHA_MODULE_PATTERN.test('aws-cdk-lib')).toBe(false);
    expect(ALPHA_MODULE_PATTERN.test('@aws-cdk/aws-glue-alpha\nchanged=false')).toBe(false);
    expect(ALPHA_MODULE_PATTERN.source.endsWith('$')).toBe(true);
  });

  test('alphaModulesOf keeps only the alpha entries of a module list', () => {
    expect(alphaModulesOf(['aws-cdk-lib', 'constructs', '@aws-cdk/aws-ivs-alpha', '@aws-cdk/cfn-property-mixins']))
      .toEqual(['@aws-cdk/aws-ivs-alpha']);
  });
});

describe('the upstream listing', () => {
  test('yields the sorted alpha directories and ignores files and non-alpha packages', () => {
    const entries = [
      ...listing('aws-ivs-alpha', 'cfn-property-mixins', 'aws-glue-alpha', 'region-info'),
      { name: 'README.md', type: 'file' },
    ];
    expect(upstreamAlphaModules(entries)).toEqual(['@aws-cdk/aws-glue-alpha', '@aws-cdk/aws-ivs-alpha']);
  });

  test('the shared reader uses the requested release tag', async () => {
    let requested = '';
    const modules = await fetchUpstreamAlphaModules('2.269.0', undefined, async (input) => {
      requested = String(input);
      return new Response(JSON.stringify(listing('aws-glue-alpha')), { status: 200 });
    });
    expect(requested).toContain('ref=v2.269.0');
    expect(modules).toEqual(['@aws-cdk/aws-glue-alpha']);
  });

  test('the shared reader rejects a failed tag read', async () => {
    await expect(fetchUpstreamAlphaModules('2.269.0', undefined, async () => new Response('', { status: 404 })))
      .rejects.toThrow(/HTTP 404/);
  });

  test.each([
    ['an error object', { message: 'Not Found' }],
    ['an empty array', []],
    ['a listing with no alpha packages', listing('cfn-property-mixins', 'region-info')],
  ])('refuses %s instead of reading it as "no alpha modules"', (_what, value) => {
    // Every one of these would otherwise plan the removal of every documented module.
    expect(() => upstreamAlphaModules(value)).toThrow(/aws-cdk package listing/);
  });
});

describe('planModuleSync', () => {
  const documented = ['@aws-cdk/aws-glue-alpha', '@aws-cdk/aws-ivs-alpha'];

  test('reports nothing when the lists match', () => {
    const plan = planModuleSync({ documented, upstream: documented, published: new Map(), alphaVersion: ALPHA });
    expect(plan).toEqual({ changed: false, additions: [], held: [], removals: [] });
  });

  test('adds a new upstream module only once it has published the pinned alpha version', () => {
    const upstream = [...documented, '@aws-cdk/aws-dsql-alpha', '@aws-cdk/aws-s3tables-alpha', '@aws-cdk/aws-new-alpha'];
    const published = new Map([
      ['@aws-cdk/aws-dsql-alpha', ['2.269.0-alpha.0', ALPHA]],
      ['@aws-cdk/aws-s3tables-alpha', ['2.269.0-alpha.0']],
    ]);
    const plan = planModuleSync({ documented, upstream, published, alphaVersion: ALPHA });
    expect(plan.additions).toEqual(['@aws-cdk/aws-dsql-alpha']);
    // Not published at the pin, and never published at all, are both held rather than added or dropped.
    expect(plan.held).toEqual(['@aws-cdk/aws-new-alpha', '@aws-cdk/aws-s3tables-alpha']);
    expect(plan.removals).toEqual([]);
    expect(plan.changed).toBe(true);
  });

  test('removes a documented module the release no longer ships', () => {
    const plan = planModuleSync({
      documented, upstream: ['@aws-cdk/aws-ivs-alpha'], published: new Map(), alphaVersion: ALPHA,
    });
    expect(plan.removals).toEqual(['@aws-cdk/aws-glue-alpha']);
    expect(plan.changed).toBe(true);
  });

  test('a held module alone does not count as a change', () => {
    const plan = planModuleSync({
      documented, upstream: [...documented, '@aws-cdk/aws-new-alpha'], published: new Map(), alphaVersion: ALPHA,
    });
    expect(plan.held).toEqual(['@aws-cdk/aws-new-alpha']);
    expect(plan.changed).toBe(false);
  });
});

describe('applyModuleSync', () => {
  const config = JSON.stringify({
    modules: ['aws-cdk-lib', 'constructs', '@aws-cdk/cfn-property-mixins', '@aws-cdk/aws-glue-alpha', '@aws-cdk/aws-ivs-alpha'],
    includeKinds: { '@aws-cdk/cfn-property-mixins': ['Mixin'] },
    languages: ['ts', 'python'],
  }, null, 2);

  test('rewrites only the alpha entries, keeping the fixed modules and every other key', () => {
    const plan = planModuleSync({
      documented: ['@aws-cdk/aws-glue-alpha', '@aws-cdk/aws-ivs-alpha'],
      upstream: ['@aws-cdk/aws-ivs-alpha', '@aws-cdk/aws-dsql-alpha'],
      published: new Map([['@aws-cdk/aws-dsql-alpha', [ALPHA]]]),
      alphaVersion: ALPHA,
    });
    const next = JSON.parse(applyModuleSync(config, plan));
    expect(next.modules).toEqual([
      'aws-cdk-lib', 'constructs', '@aws-cdk/cfn-property-mixins', '@aws-cdk/aws-dsql-alpha', '@aws-cdk/aws-ivs-alpha',
    ]);
    expect(next.includeKinds).toEqual({ '@aws-cdk/cfn-property-mixins': ['Mixin'] });
    expect(next.languages).toEqual(['ts', 'python']);
  });

  test('is the identity for an unchanged plan', () => {
    const plan = { changed: false, additions: [], held: [], removals: [] };
    expect(applyModuleSync(config, plan)).toBe(config);
  });

  test('the real config round-trips through an unchanged plan unmodified', () => {
    const text = readFileSync(resolve(ROOT, 'docgen.config.json'), 'utf-8');
    const plan = { changed: false, additions: [], held: [], removals: [] };
    expect(applyModuleSync(text, plan)).toBe(text);
  });
});

describe('reporting', () => {
  const plan = {
    changed: true,
    additions: ['@aws-cdk/aws-dsql-alpha'],
    held: ['@aws-cdk/aws-new-alpha'],
    removals: ['@aws-cdk/aws-glue-alpha'],
  };

  test('describes each move on its own line', () => {
    expect(describeModuleSync(plan)).toEqual(['add @aws-cdk/aws-dsql-alpha', 'remove @aws-cdk/aws-glue-alpha']);
  });

  test('renders validated workflow outputs', () => {
    expect(renderModuleOutputs(plan))
      .toBe('changed=true\nadditions=@aws-cdk/aws-dsql-alpha\nremovals=@aws-cdk/aws-glue-alpha\n');
    // A name that is not an alpha module never reaches $GITHUB_OUTPUT, where a newline would forge a second line.
    expect(() => renderModuleOutputs({ ...plan, additions: ['@aws-cdk/aws-x-alpha\nchanged=false'] }))
      .toThrow(/not an alpha module name/);
  });

  test('a module accounts for one page per type plus its README', () => {
    expect(modulePageCount({ types: { 'a.B': {}, 'a.C': {} } })).toBe(3);
    expect(modulePageCount({})).toBe(1);
  });
});

describe('the documented module list has one source', () => {
  const config = JSON.parse(readFileSync(resolve(ROOT, 'docgen.config.json'), 'utf-8'));
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  const pins = JSON.parse(readFileSync(resolve(ROOT, 'projenrc/cdk-versions.json'), 'utf-8'));

  test('every alpha module in docgen.config.json is a devDependency at the alpha pin, and no other alpha is', () => {
    // package.json is projen output derived from docgen.config.json, so editing the config and re-running projen is
    // the whole of adding or removing a module.
    const documented = alphaModulesOf(config.modules);
    const installed = Object.keys(pkg.devDependencies).filter((name) => ALPHA_MODULE_PATTERN.test(name)).sort();
    expect(installed).toEqual([...documented].sort());
    for (const name of documented) {
      expect(pkg.devDependencies[name]).toBe(alphaVersionForModule(pins, name));
    }
  });
});

describe('cdk-version-check workflow module sync', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/cdk-version-check.yml'), 'utf-8');
  const job = (name: string) => {
    const match = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`).exec(workflow);
    expect(match).not.toBeNull();
    return match![1];
  };

  test('a sync-modules job plans, applies and opens its own PR', () => {
    const sync = job('sync-modules');
    expect(sync).toContain('run: npx projen modules:plan');
    expect(sync).toContain('npx projen modules:apply');
    expect(sync).toContain('npx projen --no-post');
    expect(sync).toContain('npx projen modules:pr-body');
    expect(sync).toContain('branch: chore/cdk-version-bot/sync-modules');
    expect(sync).toContain('token: ${{ secrets.PROJEN_GITHUB_TOKEN }}');
  });

  test('the module sync updates the version-history ledger after applying the new module list', () => {
    // Workflow step ordering has no runtime output to assert on.
    const sync = job('sync-modules');
    expect(sync).toContain('run: npx projen docs:baseline');
    expect(sync.indexOf('docs:baseline')).toBeGreaterThan(sync.indexOf('modules:apply'));
    const baseline = sync.split(/^      - name: /m).slice(1).find((s) => s.includes('docs:baseline'))!;
    expect(baseline).toContain('if: steps.modules.outputs.changed == \'true\'');
  });

  test('the module sync PR is not auto-approved, unlike the version bump', () => {
    // A list change adds or deletes a whole module's pages, so a human merges it.
    expect(job('sync-modules')).not.toContain('auto-approve');
    expect(job('check')).toContain('labels: auto-approve');
  });

  test('the module sync PR body carries the contributor statement the gate reads', () => {
    expect(job('sync-modules')).toContain(
      'By submitting this pull request, I confirm that my contribution is made under the terms of the Apache 2.0 license.',
    );
  });

  test('a failure of either job files the alert issue', () => {
    const alert = job('alert-on-failure');
    expect(alert).toMatch(/needs:\n\s+- check\n\s+- sync-modules/);
  });
});


describe('building after removal', () => {
  test('the generated tree contains no page, sidebar, or search entry for a removed module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'module-removal-'));
    try {
      const configText = JSON.stringify({ modules: ['constructs', '@aws-cdk/aws-glue-alpha'], languages: ['ts'] }, null, 2);
      const plan = {
        changed: true,
        additions: [],
        held: [],
        removals: ['@aws-cdk/aws-glue-alpha'],
      };
      const configFile = join(dir, 'docgen.config.json');
      writeFileSync(configFile, applyModuleSync(configText, plan));
      const outDir = join(dir, 'out');
      const agentOutDir = join(dir, 'agent');
      const publicDir = join(dir, 'public');

      generateDocs(loadConfig(configFile), {
        outDir,
        agentOutDir,
        publicDir,
        packageRoot: ROOT,
        languages: ['ts'],
      });

      const output = [outDir, agentOutDir, publicDir]
        .flatMap((root) => readdirSync(root, { recursive: true })
          .map(String)
          .filter((name) => statSync(join(root, name)).isFile())
          .map((name) => readFileSync(join(root, name), 'utf-8')))
        .join('\n');
      expect(output).not.toContain('aws-glue-alpha');
      expect(output).toContain('constructs');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
