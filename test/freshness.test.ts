import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { injectBadges, isNewerVersion } from '../src/docgen/freshness.js';
import { addedInBadge, emptyLedger, FINGERPRINT_VERSION, loadLedger, writeLedger } from '../src/docgen/history.js';
import { generateDocs, loadConfig, updateHistoryLedger } from '../src/docgen/index.js';

const ROOT = resolve(import.meta.dirname, '..');

describe('version detection', () => {
  test('detects a newer patch, minor, and major release', () => {
    expect(isNewerVersion('2.263.0', '2.263.1')).toBe(true);
    expect(isNewerVersion('2.263.0', '2.264.0')).toBe(true);
    expect(isNewerVersion('2.263.0', '3.0.0')).toBe(true);
  });

  test('same or older versions are not newer', () => {
    expect(isNewerVersion('2.263.0', '2.263.0')).toBe(false);
    expect(isNewerVersion('2.263.0', '2.262.5')).toBe(false);
    expect(isNewerVersion('2.263.0', '1.999.0')).toBe(false);
  });

  test('tolerates v-prefix and pre-release suffixes', () => {
    expect(isNewerVersion('v2.263.0', '2.264.0')).toBe(true);
    expect(isNewerVersion('2.263.0', '2.264.0-alpha.1')).toBe(true);
  });

  test('rejects garbage versions', () => {
    expect(() => isNewerVersion('latest', '2.264.0')).toThrow(/Invalid version/);
  });

  test('rejects a candidate that only starts with a version', () => {
    for (const payload of [
      '2.264.0 TRAILING-TEXT',
      '2.264.0; INERT-PAYLOAD-MARKER',
      '2.264.0/../../elsewhere',
      '2.264.0\nforged=second-line',
    ]) {
      expect(() => isNewerVersion('2.263.0', payload)).toThrow(/Invalid version/);
    }
  });

  test('surrounding whitespace is still tolerated, because the parse trims', () => {
    // The raw, untrimmed value is what renderWorkflowOutputs rejects.
    expect(isNewerVersion('2.263.0', ' 2.264.0\n')).toBe(true);
  });
});

describe('badge generation', () => {
  test('added-in badge is a tip badge', () => {
    // `api-badge` is the H1 alignment opt-in, not a color: this badge shares
    // the line box with the kind badge and the source chip.
    expect(addedInBadge('2.264.0')).toBe('<Badge type="tip" class="api-badge" text="Added in v2.264.0" />');
  });

  test('injectBadges appends badges to the H1 line only', () => {
    const md = '# Bucket <Badge type="info" class="api-badge" text="Class" />\n\nSummary.\n\n## Props\n';
    const out = injectBadges(md, [addedInBadge('2.264.0')]);
    expect(out).toContain('# Bucket <Badge type="info" class="api-badge" text="Class" /> <Badge type="tip" class="api-badge" text="Added in v2.264.0" />');
    expect(out).toContain('\n## Props');
  });

  test('injectBadges is a no-op without badges or without an H1', () => {
    expect(injectBadges('# Title\n', [])).toBe('# Title\n');
    expect(injectBadges('plain text\n', [addedInBadge('2.264.0')])).toBe('plain text\n');
  });
});

describe('ledger update task', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'freshness-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('updateHistoryLedger records every configured module and dates from the release time when given', () => {
    const file = join(dir, 'ledger.json');
    const summary = updateHistoryLedger(loadConfig(join(ROOT, 'docgen.config.json')), file, ROOT,
      (name, version) => (name === 'constructs' ? `${version}-published` : undefined));
    expect(summary.changed).toBe(0);
    expect(summary.introduced).toBeGreaterThan(20000);
    const ledger = loadLedger(file)!;
    expect(ledger.types['aws-cdk-lib.aws_s3.Bucket']).toBeDefined();
    expect(ledger.types['@aws-cdk/cfn-property-mixins.aws_lambda.CfnFunctionPropsMixin']).toBeDefined();
    expect(ledger.types['@aws-cdk/cfn-property-mixins.aws_lambda.CfnFunctionMixinProps']).toBeUndefined();
    const construct = ledger.types['constructs.Construct'];
    expect(ledger.versions[construct[0]!]).toMatch(/^10\./);
    expect(construct[2]).toMatch(/^10\..*-published$/);
    // The aws-cdk-lib rows had no release time, so they carry the run's clock.
    expect(Date.parse(ledger.types['aws-cdk-lib.aws_s3.Bucket'][2]!)).not.toBeNaN();
  });

  test('checked-in ledger is on the current fingerprint definition and up to date with the install', () => {
    const committed = join(ROOT, 'docgen.baseline.json');
    const ledger = loadLedger(committed)!;
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    expect(ledger.fingerprintVersion).toBe(FINGERPRINT_VERSION);
    expect(ledger.versions).toContain(pkg.devDependencies['aws-cdk-lib']);
    expect(ledger.types['aws-cdk-lib.aws_s3.Bucket'][3]).toMatch(/^[0-9a-f]{12}$/);
    // The build never writes the ledger, so the repo copy has to already match the install: updating a copy of it
    // records nothing and leaves the bytes as they are.
    const copy = join(dir, 'committed-copy.json');
    copyFileSync(committed, copy);
    expect(updateHistoryLedger(loadConfig(join(ROOT, 'docgen.config.json')), copy, ROOT)).toEqual({ introduced: 0, changed: 0, seeded: 0 });
    expect(readFileSync(copy, 'utf-8')).toBe(readFileSync(committed, 'utf-8'));
  });
});

describe('badges in generated pages', () => {
  let outDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'freshness-docs-'));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a type introduced in the documented minor line is badged; the package/version badge is gone', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'constructs', 'package.json'), 'utf-8'));
    const minor = pkg.version.split('.').slice(0, 2).join('.');
    const ledgerFile = join(outDir, 'ledger.json');
    const ledger = emptyLedger();
    ledger.versions.push(`${minor}.0`, '10.0.0');
    ledger.types['constructs.Node'] = [0, 0, '2026-09-01T00:00:00.000Z', 'aaaaaaaaaaaa'];
    ledger.types['constructs.Construct'] = [1, 1, '2020-01-01T00:00:00.000Z', 'bbbbbbbbbbbb'];
    writeLedger(ledgerFile, ledger);

    generateDocs({ modules: ['constructs'] }, { outDir, packageRoot: ROOT, ledgerFile, languages: ['ts'] });

    // Flat historical layout: root types have no submodule segment, so `constructs.Construct` ->
    // docs/constructs.Construct.md. The badge carries no package or version tag: the package is in the
    // breadcrumb and the version is site-wide.
    const constructPage = readFileSync(join(outDir, 'docs', 'constructs.Construct.md'), 'utf-8');
    expect(constructPage).not.toMatch(/<Badge type="info" text="constructs v/);
    expect(constructPage).not.toContain('Added in v');
    expect(constructPage).toContain('<dt class="type-metadata-label">Type last changed</dt>'
      + '<dd class="type-metadata-value"><span class="type-metadata-changed" data-pagefind-ignore>v10.0.0 · 1 Jan 2020</span></dd>');
    expect(constructPage).toContain('cdkDocsIntroducedIn: "10.0.0"');
    expect(constructPage).toContain('cdkDocsLastChangedAt: "2020-01-01T00:00:00.000Z"');

    const nodePage = readFileSync(join(outDir, 'docs', 'constructs.Node.md'), 'utf-8');
    expect(nodePage).toContain(`<Badge type="tip" class="api-badge" text="Added in v${minor}.0" />`);
  });

  test('a ledger that lags the documented release renders unknown for what it does not record, never a guess', () => {
    // The dist-mode read contract: a candidate build reads whatever the last nightly committed, typically one
    // release behind, and must not attribute an unrecorded type to any release. `Construct` is recorded in an older
    // minor; `Node` is not recorded at all.
    // Outside outDir, which the build cleans, so the file can be checked afterwards.
    const ledgerFile = join(outDir, '..', 'lagging-ledger.json');
    const ledger = emptyLedger();
    ledger.versions.push('10.0.0');
    ledger.types['constructs.Construct'] = [0, 0, '2020-01-01T00:00:00.000Z', 'bbbbbbbbbbbb'];
    writeLedger(ledgerFile, ledger);

    generateDocs({ modules: ['constructs'] }, { outDir, packageRoot: ROOT, ledgerFile, languages: ['ts'] });

    const nodePage = readFileSync(join(outDir, 'docs', 'constructs.Node.md'), 'utf-8');
    expect(nodePage).not.toContain('Added in v');
    expect(nodePage).not.toContain('Type last changed');
    expect(nodePage).not.toContain('cdkDocs');
    // The recorded type keeps its older history and is not badged as new in the documented minor.
    const constructPage = readFileSync(join(outDir, 'docs', 'constructs.Construct.md'), 'utf-8');
    expect(constructPage).not.toContain('Added in v');
    expect(constructPage).toContain('cdkDocsLastChangedIn: "10.0.0"');
    // The build did not touch the ledger.
    expect(loadLedger(ledgerFile)).toEqual(JSON.parse(JSON.stringify(ledger)));
    rmSync(ledgerFile);
  });

  test('without a ledger, pages carry no badge, no history row and no history frontmatter', () => {
    generateDocs({ modules: ['constructs'] }, { outDir, packageRoot: ROOT, languages: ['ts'] });
    const nodePage = readFileSync(join(outDir, 'docs', 'constructs.Node.md'), 'utf-8');
    expect(nodePage).not.toMatch(/<Badge type="info" text="constructs v/);
    expect(nodePage).not.toContain('Added in v');
    expect(nodePage).not.toContain('Type last changed');
    expect(nodePage).not.toContain('cdkDocs');
  });
});

describe('cdk-version-check workflow', () => {
  const workflowPath = resolve(ROOT, '.github/workflows/cdk-version-check.yml');
  const content = () => readFileSync(workflowPath, 'utf-8');

  // Config shape with no produced-output counterpart: this workflow runs on a
  // clock and files an issue, so nothing it does reaches the built site.
  test('workflow exists and is projen-managed', () => {
    expect(existsSync(workflowPath)).toBe(true);
    expect(content()).toContain('Generated by projen');
  });

  // Same absence of an observable: when a workflow fires is settled entirely
  // by its triggers.
  test('runs on a daily schedule and manual dispatch', () => {
    expect(content()).toContain('schedule');
    expect(content()).toContain('cron: 0 6 * * *');
    expect(content()).toContain('workflow_dispatch');
  });

  test('detects releases from the npm registry', () => {
    // Detection belongs to the planning task: the registry query and the
    // isNewerVersion comparison are unit-tested pure functions in
    // src/docgen/version-bump.ts rather than shell in this workflow.
    expect(content()).toContain('npx projen versions:plan');
  });

  test('updates the ledger after bumping', () => {
    const c = content();
    expect(c).toContain('npx projen docs:baseline');
    // The ledger diffs the NEW release against the recorded shapes, so the update has to follow the apply step
    // that installs it.
    expect(c.indexOf('docs:baseline')).toBeGreaterThan(c.indexOf('versions:apply'));
  });

  test('bumps the pins as structured data and re-synthesizes', () => {
    const c = content();
    expect(c).toContain('npx projen versions:apply');
    expect(c).toContain('npx projen --no-post');
    // The pins are not literals in .projenrc.ts, so nothing may rewrite that
    // file with a regex.
    expect(c).not.toContain('sed -i');
    // The apply phase edits them through the validating pins module.
    const cli = readFileSync(resolve(ROOT, 'src/docgen/version-refresh-cli.ts'), 'utf-8');
    expect(cli).toContain('withCdkPin');
    expect(cli).toContain('writeCdkPins');
  });

  test('opens a PR with the changelog summary', () => {
    const c = content();
    expect(c).toContain('peter-evans/create-pull-request');
    expect(c).toContain('repos/aws/aws-cdk/releases/tags');
  });

  test('alerts on pipeline failure via a GitHub issue', () => {
    const c = content();
    expect(c).toContain('alert-on-failure');
    expect(c).toContain('if: ${{ failure() }}');
    expect(c).toContain('gh issue create');
  });
});

describe('projen integration', () => {
  const tasksJson = JSON.parse(readFileSync(join(ROOT, '.projen/tasks.json'), 'utf-8'));

  // The ledger this task writes is asserted above against the checked-in file
  // and the installed version. What is pinned here is the command that writes
  // it, which the ledger itself does not record.
  test('docs:baseline task is defined', () => {
    expect(tasksJson.tasks['docs:baseline']).toBeDefined();
    expect(tasksJson.tasks['docs:baseline'].steps[0].exec).toBe('tsx src/docgen/cli.ts --update-ledger');
  });
});

