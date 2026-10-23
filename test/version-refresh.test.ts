import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  alphaVersionFor,
  describeVersionBump,
  documentedAlphaModules,
  modulesMissingAlpha,
  planVersionBump,
  releasePartOf,
  renderWorkflowOutputs,
  resolveAlphaVersions,
} from '../src/docgen/version-bump.js';
import {
  buildVersionsData,
  buildVersionsJson,
  buildVersionSnapshot,
  packageVersions,
  Packument,
  parseVersionSnapshot,
  readVersionSnapshot,
  renderedVersions,
  snapshotPackuments,
  TRACKED_PACKAGES,
  trimPackument,
  VERSION_SNAPSHOT_FILE,
  writeVersionSnapshot,
} from '../src/docgen/versions.js';

/**
 * The version data the site renders is a committed
 * snapshot rather than a build-time registry fetch, and the nightly
 * refresh decides what moves through pure, testable functions.
 */
const ROOT = resolve(import.meta.dirname, '..');
const ALPHAS = ['@aws-cdk/aws-glue-alpha', '@aws-cdk/aws-ivs-alpha', '@aws-cdk/integ-tests-alpha'];

function packument(latest: string, time: Record<string, string>): Packument {
  return { 'dist-tags': { latest }, time };
}

/** A packument with many releases, of the shape the real registry returns. */
function fatPackument(latest: string, versions: string[]): Packument {
  const time: Record<string, string> = { created: '2018-01-01T00:00:00.000Z', modified: '2026-09-01T00:00:00.000Z' };
  versions.forEach((v, i) => {
    time[v] = new Date(Date.UTC(2020, 0, 1 + i)).toISOString();
  });
  time['3.0.0-rc.1'] = '2026-09-02T00:00:00.000Z';
  return packument(latest, time);
}

describe('committed snapshot trimming', () => {
  const plain = TRACKED_PACKAGES.find((p) => !p.majorOnly)!;
  const majorOnly = TRACKED_PACKAGES.find((p) => p.majorOnly)!;

  test('keeps only the versions the rendered rows read', () => {
    const full = fatPackument('2.10.0', ['2.10.0', '2.9.0', '2.8.0', '2.7.0', '1.4.0', '1.3.0']);
    const trimmed = trimPackument(plain, full);

    expect(Object.keys(trimmed.time)).toEqual(['2.10.0']);
    expect(trimmed['dist-tags'].latest).toBe('2.10.0');
    // Registry bookkeeping keys and pre-releases are dropped.
    expect(Object.keys(trimmed.time)).not.toContain('created');
    expect(Object.keys(trimmed.time)).not.toContain('3.0.0-rc.1');
  });

  test('for a major-only package keeps the newest release of the current major', () => {
    const full = fatPackument('54.22.0', ['54.22.0', '54.1.0', '53.28.0', '53.0.0', '52.2.0', '51.9.0']);
    const trimmed = trimPackument(majorOnly, full);
    expect(new Set(Object.keys(trimmed.time))).toEqual(new Set(['54.22.0']));
  });

  test.each(TRACKED_PACKAGES.map((p) => [p.name, p] as const))(
    'trimming is lossless for %s — the rendered rows are identical either way',
    (_name, pkg) => {
      // The trim mirrors the selection logic in packageVersions; this is
      // what makes that mirroring safe, rather than inspection.
      const full = fatPackument('54.22.0', [
        '54.22.0', '54.9.0', '54.0.0', '53.28.0', '53.1.0', '52.2.0', '52.0.0', '51.9.0', '50.0.0',
      ]);
      expect(packageVersions(pkg, trimPackument(pkg, full))).toEqual(packageVersions(pkg, full));
    },
  );

  test('renderedVersions falls back to the dist-tag when the packument has no stable timestamps', () => {
    expect(renderedVersions(plain, packument('9.9.9', {}))).toEqual(['9.9.9']);
  });

  test('page data and versions.json are identical whether built from full or trimmed packuments', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const full = new Map(
      TRACKED_PACKAGES.map((p) => [
        p.name,
        fatPackument('54.22.0', ['54.22.0', '54.9.0', '53.28.0', '52.2.0', '51.0.0']),
      ]),
    );
    const trimmed = snapshotPackuments(buildVersionSnapshot(full, now));
    expect(buildVersionsData(trimmed, now)).toEqual(buildVersionsData(full, now));
    expect(buildVersionsJson(trimmed, now)).toEqual(buildVersionsJson(full, now));
  });
});

describe('snapshot file', () => {
  test('the committed snapshot covers every tracked package and parses', () => {
    const snapshot = readVersionSnapshot(join(ROOT, VERSION_SNAPSHOT_FILE));
    expect(Object.keys(snapshot.packages).sort()).toEqual(TRACKED_PACKAGES.map((p) => p.name).sort());
    expect(Date.parse(snapshot.generatedAt)).not.toBeNaN();
    for (const pkg of TRACKED_PACKAGES) {
      const entry = snapshot.packages[pkg.name];
      expect(entry['dist-tags'].latest).toMatch(/^\d+\.\d+\.\d+$/);
      // Trimmed, not a raw packument: the real ones carry hundreds of entries.
      expect(Object.keys(entry.time).length).toBeLessThanOrEqual(4);
      expect(Object.keys(entry.time)).toContain(entry['dist-tags'].latest);
    }
  });

  test('the committed snapshot renders without throwing', () => {
    const snapshot = readVersionSnapshot(join(ROOT, VERSION_SNAPSHOT_FILE));
    const data = buildVersionsData(snapshotPackuments(snapshot), new Date(snapshot.generatedAt));
    expect(data.packages.length).toBe(TRACKED_PACKAGES.length + 1);
  });

  test('round-trips through write and read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snap-'));
    try {
      const file = join(dir, VERSION_SNAPSHOT_FILE);
      const snapshot = buildVersionSnapshot(
        new Map(TRACKED_PACKAGES.map((p) => [p.name, packument('1.2.3', { '1.2.3': '2026-01-01T00:00:00.000Z' })])),
        new Date('2026-02-03T04:05:06.000Z'),
      );
      writeVersionSnapshot(snapshot, file);
      expect(readVersionSnapshot(file)).toEqual(snapshot);
      expect(readFileSync(file, 'utf-8').endsWith('\n')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a snapshot the build could not render is rejected loudly, not half-rendered', () => {
    const good = JSON.stringify(buildVersionSnapshot(
      new Map(TRACKED_PACKAGES.map((p) => [p.name, packument('1.2.3', { '1.2.3': '2026-01-01T00:00:00.000Z' })])),
    ));
    expect(() => parseVersionSnapshot(good)).not.toThrow();

    expect(() => parseVersionSnapshot('[]')).toThrow(/must contain a JSON object/);
    expect(() => parseVersionSnapshot('{"packages":{}}')).toThrow(/"generatedAt"/);
    expect(() => parseVersionSnapshot('{"generatedAt":"nope","packages":{}}')).toThrow(/"generatedAt"/);
    expect(() => parseVersionSnapshot('{"generatedAt":"2026-01-01T00:00:00.000Z","packages":[]}')).toThrow(/"packages"/);
    expect(() => parseVersionSnapshot('{"generatedAt":"2026-01-01T00:00:00.000Z","packages":{}}')).toThrow(/aws-cdk-lib is missing or malformed/);

    const missingTime = JSON.parse(good);
    delete missingTime.packages['aws-cdk'].time;
    expect(() => parseVersionSnapshot(JSON.stringify(missingTime))).toThrow(/aws-cdk is missing or malformed/);
  });

  test('parseVersionSnapshot rejects a latest that is only prefixed by a version', () => {
    const good = JSON.stringify(buildVersionSnapshot(
      new Map(TRACKED_PACKAGES.map((p) => [p.name, packument('1.2.3', { '1.2.3': '2026-01-01T00:00:00.000Z' })])),
    ));
    expect(() => parseVersionSnapshot(good)).not.toThrow();

    for (const payload of [
      '2.268.0/../../elsewhere',
      '2.268.0 TRAILING-TEXT',
      '2.268.0; INERT-PAYLOAD-MARKER',
      '2.268.0\nforged=second-line',
      'latest',
    ]) {
      const poisoned = JSON.parse(good);
      poisoned.packages['aws-cdk-lib']['dist-tags'].latest = payload;
      expect(() => parseVersionSnapshot(JSON.stringify(poisoned))).toThrow(
        /dist-tags\.latest must be a semver version/,
      );
    }
  });

  test('buildVersionSnapshot refuses to write a snapshot with a package missing', () => {
    expect(() => buildVersionSnapshot(new Map())).toThrow(/missing packument for aws-cdk-lib/);
  });

  test('buildVersionSnapshot refuses to copy a malformed latest into the snapshot', () => {
    for (const pkg of TRACKED_PACKAGES) {
      const packuments = new Map(
        TRACKED_PACKAGES.map((p) => [
          p.name,
          packument(p.name === pkg.name ? '1.2.3 TRAILING-TEXT' : '1.2.3', { '1.2.3': '2026-01-01T00:00:00.000Z' }),
        ]),
      );
      expect(() => buildVersionSnapshot(packuments)).toThrow(
        new RegExp(`versions: ${pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} dist-tags\\.latest must be a semver version`),
      );
    }
  });

  test('trimPackument accepts the versions the registry actually publishes', () => {
    for (const good of ['2.268.0', '2.1141.0', '54.23.0', '2.268.0-alpha.0']) {
      const [pkg] = TRACKED_PACKAGES;
      expect(
        trimPackument(pkg, packument(good, { [good]: '2026-01-01T00:00:00.000Z' }))['dist-tags'].latest,
      ).toBe(good);
    }
  });
});

describe('alpha lockstep resolution', () => {
  test('the alpha release for a core version is the same version with an -alpha.0 suffix', () => {
    expect(alphaVersionFor('2.269.0')).toBe('2.269.0-alpha.0');
    expect(releasePartOf('2.266.0-alpha.0')).toBe('2.266.0');
  });

  test('bumps published modules, holds late modules, and drops gone modules', () => {
    const target = '2.269.0-alpha.0';
    const resolution = resolveAlphaVersions({
      modules: ALPHAS,
      upstream: [ALPHAS[0], ALPHAS[1]],
      published: new Map([
        [ALPHAS[0], [target]],
        [ALPHAS[1], ['2.268.0-alpha.0']],
      ]),
      targetCore: '2.269.0',
      currentDefault: '2.268.0-alpha.0',
      currentOverrides: {},
    });

    expect(resolution).toEqual({
      defaultVersion: target,
      overrides: { [ALPHAS[1]]: '2.268.0-alpha.0' },
      published: [ALPHAS[0]],
      late: [ALPHAS[1]],
      gone: [ALPHAS[2]],
      unknown: [],
    });
  });

  test('holds only an unknown module while known modules still bump', () => {
    const target = '2.269.0-alpha.0';
    const resolution = resolveAlphaVersions({
      modules: ALPHAS,
      upstream: ALPHAS,
      published: new Map([
        [ALPHAS[0], [target]],
        [ALPHAS[1], [target]],
      ]),
      targetCore: '2.269.0',
      currentDefault: '2.268.0-alpha.0',
      currentOverrides: { [ALPHAS[2]]: '2.267.0-alpha.0' },
    });

    expect(resolution.defaultVersion).toBe(target);
    expect(resolution.overrides).toEqual({ [ALPHAS[2]]: '2.267.0-alpha.0' });
    expect(resolution.published).toEqual([ALPHAS[0], ALPHAS[1]]);
    expect(resolution.unknown).toEqual([ALPHAS[2]]);
    expect(resolution.gone).toEqual([]);
  });

  test('an unreadable release-tag listing holds every pin and drops nothing', () => {
    const currentOverrides = { [ALPHAS[1]]: '2.267.0-alpha.0' };
    expect(resolveAlphaVersions({
      modules: ALPHAS,
      upstream: undefined,
      published: new Map(),
      targetCore: '2.269.0',
      currentDefault: '2.268.0-alpha.0',
      currentOverrides,
    })).toEqual({
      defaultVersion: '2.268.0-alpha.0',
      overrides: currentOverrides,
      published: [],
      late: [],
      gone: [],
      unknown: ALPHAS,
    });
  });

  test('removes an override when a late module catches up', () => {
    const target = '2.269.0-alpha.0';
    const resolution = resolveAlphaVersions({
      modules: ALPHAS,
      upstream: ALPHAS,
      published: new Map(ALPHAS.map((name) => [name, [target]])),
      targetCore: '2.269.0',
      currentDefault: target,
      currentOverrides: { [ALPHAS[2]]: '2.268.0-alpha.0' },
    });
    expect(resolution.overrides).toEqual({});
    expect(resolution.published).toEqual(ALPHAS);
  });

  test('derives the module list from the installed devDependencies, duplicating no list', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const modules = documentedAlphaModules(pkg.devDependencies);
    expect(modules.length).toBeGreaterThan(30);
    expect(modules).toContain('@aws-cdk/aws-glue-alpha');
    expect(modules.every((name) => name.endsWith('-alpha'))).toBe(true);
    // The non-alpha devDeps are not swept in.
    expect(modules).not.toContain('aws-cdk-lib');
    expect(modules).not.toContain('vitepress');
  });
});

describe('planVersionBump', () => {
  const base = {
    currentCore: '2.268.0',
    latestCore: '2.268.0',
    currentAlpha: '2.268.0-alpha.0',
    alphaTarget: '2.268.0-alpha.0',
    snapshotLatest: new Map([['aws-cdk', '2.1140.0']]),
    registryLatest: new Map([['aws-cdk', '2.1140.0']]),
  };

  test('nothing moved means no PR and a clean tree', () => {
    const plan = planVersionBump(base);
    expect(plan).toEqual({ core: undefined, alpha: undefined, snapshot: {}, changed: false });
    expect(describeVersionBump(plan)).toEqual([]);
  });

  test('a core release bumps the core pin', () => {
    const plan = planVersionBump({ ...base, latestCore: '2.269.0' });
    expect(plan.core).toBe('2.269.0');
    expect(plan.changed).toBe(true);
  });

  test('a tracked package release moves only the snapshot', () => {
    const plan = planVersionBump({ ...base, registryLatest: new Map([['aws-cdk', '2.1141.0']]) });
    expect(plan.core).toBeUndefined();
    expect(plan.snapshot).toEqual({ 'aws-cdk': { from: '2.1140.0', to: '2.1141.0' } });
    expect(plan.changed).toBe(true);
    expect(describeVersionBump(plan)).toEqual(['aws-cdk displayed version 2.1140.0 -> 2.1141.0']);
  });

  test('the alpha pin moves on its own when the alphas were lagging', () => {
    // Today's tree: core at 2.268.0, alphas pinned two minors behind.
    const plan = planVersionBump({ ...base, currentAlpha: '2.266.0-alpha.0' });
    expect(plan.alpha).toBe('2.268.0-alpha.0');
    expect(plan.core).toBeUndefined();
    expect(plan.changed).toBe(true);
  });

  test('the cursors may diverge: the core still bumps while the alphas are held back', () => {
    const plan = planVersionBump({
      ...base,
      latestCore: '2.269.0',
      currentAlpha: '2.268.0-alpha.0',
      // 2.269.0-alpha.0 is not published across every module.
      alphaTarget: '2.268.0-alpha.0',
    });
    expect(plan.core).toBe('2.269.0');
    expect(plan.alpha).toBeUndefined();
  });

  test('an absent alpha target never moves the pin', () => {
    expect(planVersionBump({ ...base, alphaTarget: undefined, currentAlpha: '2.200.0-alpha.0' }).alpha).toBeUndefined();
  });

  test('a module-level alpha change runs apply even when the default stays put', () => {
    const plan = planVersionBump({ ...base, alphaSetChanged: true });
    expect(plan.alpha).toBe(base.currentAlpha);
    expect(plan.changed).toBe(true);
    expect(renderWorkflowOutputs(plan)).toContain(`alpha=${base.currentAlpha}`);
  });

  test('never moves a pin backwards', () => {
    expect(planVersionBump({ ...base, latestCore: '2.267.0' }).core).toBeUndefined();
    expect(planVersionBump({ ...base, currentAlpha: '2.269.0-alpha.0' }).alpha).toBeUndefined();
  });

  test('a package absent from the snapshot counts as a change', () => {
    const plan = planVersionBump({ ...base, snapshotLatest: new Map() });
    expect(plan.snapshot).toEqual({ 'aws-cdk': { from: '(absent)', to: '2.1140.0' } });
    expect(plan.changed).toBe(true);
  });
});

describe('cdk-version-check nightly job', () => {
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'cdk-version-check.yml'), 'utf-8');

  test('plans, then applies, then updates the ledger — in that order', () => {
    // The ledger diffs the NEWLY installed release against the recorded shapes, so it must run after apply has
    // installed it; before apply it would only re-record the outgoing release.
    const plan = workflow.indexOf('versions:plan');
    const apply = workflow.indexOf('versions:apply');
    const ledger = workflow.indexOf('docs:baseline');
    expect(plan).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(plan);
    expect(ledger).toBeGreaterThan(apply);
  });

  test('every mutating step is gated, by its own if — not a neighbor\'s', () => {
    // Slice each step's own block so a deleted `if` cannot be masked by
    // the preceding step's one.
    const steps = workflow.split(/^      - name: /m).slice(1);
    const blockFor = (needle: string) => {
      const block = steps.find((s) => s.includes(needle));
      expect(block).toBeDefined();
      return block!;
    };

    expect(blockFor('docs:baseline')).toMatch(/if: steps\.detect\.outputs\.core != '' \|\| steps\.detect\.outputs\.alpha != ''/);
    for (const step of ['versions:apply', 'versions:pr-body', 'peter-evans/create-pull-request']) {
      expect(blockFor(step)).toContain("if: steps.detect.outputs.changed == 'true'");
    }
  });

  test('the ledger update is gated on a pin moving, not on the snapshot moving', () => {
    // A snapshot-only night installs nothing new, so the update would be a
    // no-op; gating it on the pins keeps the step out of those runs.
    const baseline = workflow.split(/^      - name: /m).slice(1).find((s) => s.includes('docs:baseline'))!;
    expect(baseline).not.toContain("changed == 'true'");
    expect(baseline).toContain("steps.detect.outputs.core != ''");
    expect(baseline).toContain("steps.detect.outputs.alpha != ''");
  });

  test('synthesizes package metadata without installing before refreshing the lockfile', () => {
    const applyStep = workflow.split(/^      - name: /m).slice(1).find((step) => step.includes('versions:apply'))!;
    const apply = applyStep.indexOf('versions:apply');
    const synth = applyStep.indexOf('npx projen --no-post');
    const install = applyStep.indexOf('npm install');
    expect(synth).toBeGreaterThan(apply);
    expect(install).toBeGreaterThan(synth);
  });

  test('opens one auto-merging PR on a branch not named after aws-cdk-lib alone', () => {
    const check = workflow.slice(workflow.indexOf('\n  check:\n'), workflow.indexOf('\n  sync-modules:\n'));
    expect(check).toContain('labels: auto-approve');
    expect(check).toContain('branch: chore/cdk-version-bot/refresh-cdk-versions');
    expect(workflow).not.toContain('update-aws-cdk-lib');
    expect((check.match(/peter-evans\/create-pull-request/g) ?? []).length).toBe(1);
  });

  test('no package list is restated in the workflow YAML', () => {
    expect(workflow).not.toContain('-alpha');
    expect(workflow).not.toContain('toolkit-lib');
  });

  test('alert-on-failure still covers the whole job', () => {
    expect(workflow).toContain('alert-on-failure');
    expect(workflow).toMatch(/alert-on-failure:\n\s+needs:\n\s+- check\n\s+- sync-modules\n/);
    expect(workflow).toContain('if: ${{ failure() }}');
  });

  test('the PR body carries the contributor statement the gate requires', () => {
    // Appended by the workflow, after the changelog section, so the
    // Require Contributor Statement check passes on the bot's own PR.
    expect(workflow).toContain('under the terms of the Apache 2.0 license');
    expect(workflow.indexOf('repos/aws/aws-cdk/releases/tags')).toBeLessThan(
      workflow.indexOf('under the terms of the Apache 2.0 license'),
    );
  });
});

describe('workflow outputs', () => {
  const base = { snapshot: {}, changed: true };

  test('renders the three keys a workflow step reads', () => {
    expect(renderWorkflowOutputs({ ...base, core: '2.269.0', alpha: '2.269.0-alpha.0' })).toBe(
      'changed=true\ncore=2.269.0\nalpha=2.269.0-alpha.0\n',
    );
  });

  test('an absent pin renders as empty, not as "undefined"', () => {
    expect(renderWorkflowOutputs({ ...base, changed: false })).toBe('changed=false\ncore=\nalpha=\n');
  });

  test('refuses to emit a version carrying anything beyond the version', () => {
    for (const payload of [
      '2.269.0 TRAILING-TEXT',
      '2.269.0; INERT-PAYLOAD-MARKER',
      '2.269.0/../../elsewhere',
      '2.269.0\nforged=second-line',
      '2.269.0\n',
      ' 2.269.0',
    ]) {
      expect(() => renderWorkflowOutputs({ ...base, core: payload })).toThrow(
        /\$GITHUB_OUTPUT "core" must be a semver version/,
      );
      expect(() => renderWorkflowOutputs({ ...base, alpha: payload })).toThrow(
        /\$GITHUB_OUTPUT "alpha" must be a semver version/,
      );
    }
  });

  test('every line it emits is a single key=value pair', () => {
    // GitHub honors the last occurrence of a key, so a forged line would win.
    const lines = renderWorkflowOutputs({ ...base, core: '2.269.0', alpha: '2.269.0-alpha.0' })
      .split('\n')
      .filter((l) => l !== '');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toMatch(/^[a-z]+=[^\n]*$/);
    }
  });

  test('the CLI has no second, unvalidated path to $GITHUB_OUTPUT', () => {
    const cli = readFileSync(resolve(ROOT, 'src/docgen/version-refresh-cli.ts'), 'utf-8');
    const appends = cli.match(/appendFileSync\([^)]*GITHUB_OUTPUT[^)]*\)/g) ?? [];
    expect(appends).toHaveLength(1);
    expect(appends[0]).toContain('renderWorkflowOutputs(bump)');
    expect(cli).not.toMatch(/GITHUB_OUTPUT,\s*`(changed|core|alpha)=/);
  });
});
