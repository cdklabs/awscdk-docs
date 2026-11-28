import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { VERSION_PARSE_PATTERN } from '../src/docgen/version-format.js';
import { compareVersionsDesc } from '../src/docgen/versions.js';

const ROOT = resolve(import.meta.dirname, '..');
const releasePath = resolve(ROOT, '.github/workflows/deploy-and-release.yml');
const docsBuildPath = resolve(ROOT, '.github/workflows/docs-build.yml');

describe('workflow credentials and permissions', () => {
  // Config shape: token permissions and secret use have no runtime output to assert on.
  const content = readFileSync(releasePath, 'utf-8');
  const s3Job = content.slice(content.indexOf('  release_docs_awscdk-docs:'));
  const buildJob = (path: string) => {
    const workflow = readFileSync(path, 'utf-8');
    const start = workflow.indexOf('\n  build:\n');
    expect(start).toBeGreaterThan(-1);
    const rest = workflow.slice(start + 1);
    // The job ends at the next job or the next top-level key.
    const next = rest.slice(1).search(/\n(?: {2})?[A-Za-z0-9_-]+:\n/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };

  test('the build job only reads repository contents', () => {
    expect(buildJob(releasePath)).toMatch(/\n {4}permissions:\n {6}contents: read\n {4}steps:\n/);
  });

  test('the PR build only builds: one build job, no release, publish or secrets', () => {
    const workflow = readFileSync(docsBuildPath, 'utf-8');
    const jobs = workflow.slice(workflow.indexOf('\njobs:\n') + 7).match(/^ {2}[A-Za-z0-9_-]+:$/gm);
    expect(jobs).toEqual(['  build:']);
    expect(workflow).not.toContain('environment:');
    expect(workflow).not.toContain('id-token');
    expect(workflow).not.toContain('secrets.');
  });

  // The PR build is what every merge is gated on; the release build is what gets published.
  test('the PR build job is identical to the release workflow build job', () => {
    expect(buildJob(docsBuildPath)).toContain('\n    name: build-docs\n');
    expect(buildJob(docsBuildPath)).toBe(buildJob(releasePath));
  });

  test('the S3 publish job runs in the release environment with OIDC permissions', () => {
    expect(s3Job).toContain('environment: release');
    expect(s3Job).toContain('id-token: write');
    expect(s3Job).toContain('aws-actions/configure-aws-credentials');
  });

  test('the bucket comes from an environment var', () => {
    expect(s3Job).toContain('${{ vars.DOCS_BUCKET_NAME }}');
  });

  test('the publishing role is assumed via the account role (two-step chain)', () => {
    // The publishing role trusts the account role, not the OIDC provider, so a direct assume fails.
    const firstHop = s3Job.indexOf('${{ vars.AWS_ROLE_TO_ASSUME_FOR_ACCOUNT }}');
    const secondHop = s3Job.indexOf('${{ vars.PUBLISH_CDK_REF_DOCS_ROLE_ARN }}');
    expect(firstHop).toBeGreaterThan(-1);
    expect(firstHop).toBeLessThan(secondHop);
    expect(s3Job).toContain('role-chaining: true');
  });

  test('the credential and upload steps are unreachable off main', () => {
    const jobStart = s3Job.indexOf('  release_docs_awscdk-docs:');
    const condition = s3Job.indexOf('if: needs.release.outputs.tag_exists');
    expect(s3Job).toContain(
      "if: needs.release.outputs.tag_exists != 'true' && !inputs.dry_run && github.ref == 'refs/heads/main'",
    );
    expect(condition).toBeGreaterThan(jobStart);
    expect(condition).toBeLessThan(s3Job.indexOf('aws-actions/configure-aws-credentials'));
    expect(condition).toBeLessThan(s3Job.indexOf('aws s3api put-object'));
    expect(s3Job.slice(jobStart, condition)).not.toContain('steps:');
  });
});

describe('the site zip contract', () => {
  // Config shape: the zip name is a contract between the build job and the publish job, read off both.
  const content = readFileSync(releasePath, 'utf-8');
  const s3Job = content.slice(content.indexOf('  release_docs_awscdk-docs:'));

  test('the build job packages the verified site as the docs-site artifact', () => {
    const buildJob = content.slice(content.indexOf('\n  build:\n'), content.indexOf('\n  deploy:\n'));
    // Packaging comes after the build, which ends by verifying the merged site, so S3 never gets an unverified site.
    expect(buildJob.indexOf('docs:build:ci')).toBeGreaterThan(-1);
    expect(buildJob.indexOf('docs:build:ci')).toBeLessThan(
      buildJob.indexOf('Package docs site for S3 publishing'),
    );
    expect(buildJob).toContain('cdk-docs-site.zip');
    expect(buildJob).toContain('name: docs-site');
  });

  test('the published zip name matches what the build job packages', () => {
    expect(s3Job).toContain('ARTIFACT: dist/cdk-docs-site.zip');
    expect(s3Job).toContain('--body "$ARTIFACT"');
  });
});

describe('the documented version is parsed before any S3 write', () => {
  const content = readFileSync(releasePath, 'utf-8');
  const s3Job = content.slice(content.indexOf('  release_docs_awscdk-docs:'));

  // The job checks out nothing, so these tests execute the validator embedded in the generated workflow, with
  // the pattern that workflow carries.
  const validator = s3Job.slice(
    s3Job.indexOf('if ! node -e "') + 'if ! node -e "'.length,
    s3Job.indexOf('" "$CDK_VERSION"; then'),
  );
  const pattern = s3Job.match(/VERSION_PATTERN: (.+)/)?.[1];

  const check = (version: string) =>
    spawnSync('node', ['-e', validator, version], {
      env: { ...process.env, VERSION_PATTERN: pattern },
      encoding: 'utf-8',
    }).status;

  test('the validator uses the shared pattern rather than a pattern of its own', () => {
    expect(pattern).toBe(VERSION_PARSE_PATTERN.source);
    expect(validator).toContain('process.env.VERSION_PATTERN');
  });

  test.each(['2.269.0', 'v2.269.0', '2.269.0-rc.0'])('a documented version of %s passes', (version) => {
    expect(check(version)).toBe(0);
  });

  test.each(['not-a-version', '2.269', '2.269.0.1', '2.269.0 ', '../../../latest-awscdk-docs'])(
    'a documented version of %s fails the step',
    (version) => {
      expect(check(version)).toBe(1);
    },
  );

  // Config shape: the version becomes an S3 key, so the check must run before the key is built or written.
  test('the parse precedes the object key and both writes', () => {
    const parse = s3Job.indexOf('if ! node -e "');
    expect(parse).toBeGreaterThan(-1);
    expect(parse).toBeLessThan(s3Job.indexOf('S3_PATH="$DOCS_STREAM/'));
    expect(parse).toBeLessThan(s3Job.indexOf('aws s3api put-object'));
    expect(parse).toBeLessThan(s3Job.indexOf('aws s3 cp - "s3://$BUCKET_NAME/$LATEST"'));
  });
});

describe('the embedded marker comparison agrees with compareVersionsDesc', () => {
  const content = readFileSync(releasePath, 'utf-8');
  const s3Job = content.slice(content.indexOf('  release_docs_awscdk-docs:'));

  // The job checks out nothing, so the comparison runs from a script embedded at synth time. These tests
  // execute that exact script out of the generated workflow, with the pattern the workflow itself carries.
  const script = s3Job.slice(
    s3Job.indexOf('MARKER_ORDER=$(node -e "') + 'MARKER_ORDER=$(node -e "'.length,
    s3Job.indexOf('" "$CDK_VERSION" "$EXISTING_VERSION" "$MARKER_EXISTS")'),
  );
  const pattern = s3Job.match(/VERSION_PATTERN: (.+)/)?.[1];

  function order(current: string, existing: string, markerExists = 'true'): { out: string; status: number | null } {
    const res = spawnSync('node', ['-e', script, current, existing, markerExists], {
      env: { ...process.env, VERSION_PATTERN: pattern },
      encoding: 'utf-8',
    });
    return { out: res.stdout.trim(), status: res.status };
  }

  // The verdict the embedded script must agree with, derived from the shared comparator rather than
  // re-stated as literals, so the embedded copy cannot drift from the module's semantics.
  function expected(current: string, existing: string): string {
    const cmp = compareVersionsDesc(current, existing);
    return cmp < 0 ? 'newer' : cmp > 0 ? 'older' : 'equal';
  }

  test('the embedded pattern is the validated one from the version-format module', () => {
    expect(pattern).toBe(VERSION_PARSE_PATTERN.source);
  });

  test('first publish: no existing marker always writes', () => {
    expect(order('2.269.0', '', 'false')).toEqual({ out: 'absent', status: 0 });
  });

  test.each([
    ['2.269.0', '2.268.1'],
    ['2.269.0', '2.269.0'],
    ['2.268.0', '2.268.1'],
    ['2.269.0-rc.0', '2.269.0'],
    ['3.0.0', '2.999.9'],
  ])('the embedded verdict for %s against %s matches compareVersionsDesc', (current, existing) => {
    expect(order(current, existing)).toEqual({ out: expected(current, existing), status: 0 });
  });

  test('a current version that does not parse fails the job rather than guessing', () => {
    const res = spawnSync('node', ['-e', script, 'not-a-version', '2.269.0', 'true'], {
      env: { ...process.env, VERSION_PATTERN: pattern },
      encoding: 'utf-8',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('not a valid version: not-a-version');
  });

  test('an existing marker with no parseable version is reported so the write can self-heal it', () => {
    expect(order('2.269.0', 'garbage')).toEqual({ out: 'invalid', status: 0 });
    // A marker that exists but has no version= line takes the same path, not the silent first-publish one.
    expect(order('2.269.0', '', 'true')).toEqual({ out: 'invalid', status: 0 });
  });
});
