import { overviewReadme, renderOverviewPage, TypeEntry } from '../src/docgen/index.js';
import {
  assertOverviewsResolvable,
  DEFAULT_OVERVIEW,
  overviewFor,
  parseOverviews,
} from '../src/docgen/overviews.js';

const types: TypeEntry[] = [
  {
    name: 'Widget',
    kind: 'Class',
    summary: 'A widget.',
    link: '/v2/docs/fake.sub.Widget',
    type: {} as any,
  },
];

describe('parseOverviews', () => {
  test('absent config resolves every module to the README default', () => {
    const map = parseOverviews(undefined);
    expect(map.size).toBe(0);
    expect(overviewFor(map, 'aws-cdk-lib')).toEqual({ kind: 'readme' });
    expect(DEFAULT_OVERVIEW).toEqual({ kind: 'readme' });
  });

  test('each kind round-trips', () => {
    const map = parseOverviews({
      'aws-cdk-lib': { kind: 'readme' },
      'aws-cdk-lib.cx_api': { kind: 'none' },
      '@aws-cdk/aws-ec2-alpha': { kind: 'copy', from: 'aws-cdk-lib.aws_ec2' },
      '@aws-cdk/integ-tests-alpha': { kind: 'generated' },
    });
    expect(overviewFor(map, 'aws-cdk-lib')).toEqual({ kind: 'readme' });
    expect(overviewFor(map, 'aws-cdk-lib.cx_api')).toEqual({ kind: 'none' });
    expect(overviewFor(map, '@aws-cdk/aws-ec2-alpha')).toEqual({
      kind: 'copy',
      from: 'aws-cdk-lib.aws_ec2',
    });
    expect(overviewFor(map, '@aws-cdk/integ-tests-alpha')).toEqual({ kind: 'generated' });
    // An unconfigured module still defaults.
    expect(overviewFor(map, 'constructs')).toEqual({ kind: 'readme' });
  });

  test('rejects an unknown kind, naming the key', () => {
    expect(() => parseOverviews({ 'aws-cdk-lib': { kind: 'wat' } })).toThrow(
      /"overviews"\."aws-cdk-lib" has unknown kind "wat"/,
    );
  });

  test('rejects a non-object entry and a non-object overviews block', () => {
    expect(() => parseOverviews({ 'aws-cdk-lib': 'readme' })).toThrow(/"aws-cdk-lib" must be an object/);
    expect(() => parseOverviews([])).toThrow(/"overviews" must be an object/);
  });

  test('rejects copy without a usable from, and self-copy', () => {
    expect(() => parseOverviews({ a: { kind: 'copy' } })).toThrow(/"a" is a "copy" and needs a non-empty "from"/);
    expect(() => parseOverviews({ a: { kind: 'copy', from: '   ' } })).toThrow(/non-empty "from"/);
    expect(() => parseOverviews({ a: { kind: 'copy', from: 'a' } })).toThrow(/"a" copies from itself/);
  });

  test('rejects a copy chained onto another copy (one hop only)', () => {
    expect(() =>
      parseOverviews({
        a: { kind: 'copy', from: 'b' },
        b: { kind: 'copy', from: 'c' },
      }),
    ).toThrow(/"a" copies from "b", which is itself a "copy" entry/);
  });

  test('rejects an unresolvable key and an unresolvable copy source', () => {
    const ids = ['aws-cdk-lib', 'aws-cdk-lib.aws_s3'];
    const roots = ['aws-cdk-lib'];
    expect(() =>
      assertOverviewsResolvable(parseOverviews({ 'aws-cdk-lib.typo': { kind: 'none' } }), ids, roots),
    ).toThrow(/"aws-cdk-lib\.typo" does not name a documented module or submodule/);
    expect(() =>
      assertOverviewsResolvable(
        parseOverviews({ 'aws-cdk-lib.aws_s3': { kind: 'copy', from: 'nope' } }),
        ids,
        roots,
      ),
    ).toThrow(/copies from "nope", which is not a documented module/);
    // A valid map passes.
    expect(() =>
      assertOverviewsResolvable(parseOverviews({ 'aws-cdk-lib.aws_s3': { kind: 'none' } }), ids, roots),
    ).not.toThrow();
  });

  test('rejects kind "generated" on a submodule (package-root shape only)', () => {
    expect(() =>
      assertOverviewsResolvable(
        parseOverviews({ 'aws-cdk-lib.aws_s3': { kind: 'generated' } }),
        ['aws-cdk-lib', 'aws-cdk-lib.aws_s3'],
        ['aws-cdk-lib'],
      ),
    ).toThrow(/only available for package roots/);
  });
});

describe('overviewReadme dispatch', () => {
  test('readme uses the module own README; none drops it; copy takes the source', () => {
    // `readme` and `copy` both show the markdown the caller resolved —
    // which module that came from is decided before this call.
    expect(overviewReadme({ kind: 'readme' }, '# Own')).toBe('# Own');
    expect(overviewReadme({ kind: 'copy', from: 'x' }, '# Other')).toBe('# Other');
    expect(overviewReadme({ kind: 'none' }, '# Own')).toBeUndefined();
  });
});

describe('renderOverviewPage', () => {
  test('README body precedes extra sections, which precede the type list', () => {
    const page = renderOverviewPage({
      title: 'aws-cdk-lib',
      types,
      readme: '# AWS CDK\n\nLibrary prose.',
      sections: ['## Submodules', '', '- [aws_s3](/v2/docs/aws-cdk-lib.aws_s3-readme)', ''],
    });
    expect(page.startsWith('# AWS CDK')).toBe(true);
    // README-backed pages keep the right-hand outline.
    expect(page.startsWith('---')).toBe(false);
    const prose = page.indexOf('Library prose.');
    const subs = page.indexOf('## Submodules');
    const list = page.indexOf('## Types');
    expect(prose).toBeGreaterThan(0);
    expect(subs).toBeGreaterThan(prose);
    expect(list).toBeGreaterThan(subs);
  });

  test('without a README the page is table-only and suppresses the outline', () => {
    const page = renderOverviewPage({ title: 'aws-cdk-lib', types });
    expect(page.startsWith('---\noutline: false\n---\n\n')).toBe(true);
    expect(page).toContain('# aws-cdk-lib');
    expect(page).toContain('| Name | Kind | Summary |');
  });

  test('extra sections still render on the table-only variant', () => {
    const page = renderOverviewPage({
      title: 'aws-cdk-lib',
      types,
      sections: ['::: info Separate package', ':::', ''],
    });
    expect(page).toContain('::: info Separate package');
  });
});
