import * as spec from '@jsii/spec';
import { submoduleDir, upstreamReadmeUrl } from '../src/docgen/provenance.js';

/**
 * Upstream README provenance. The footer's edit link must reach the file a
 * reader who spotted a typo in a service README can actually edit, not this
 * repo's `src/docgen`.
 *
 * These run against the real installed assemblies rather than hand-built
 * fixtures, because the whole point of the change is that the provenance
 * comes from the assembly's own metadata: a fixture asserting an assumed
 * shape passes while the derivation is wrong for the packages the
 * site actually documents.
 */
const load = (dir: string): spec.Assembly =>
  spec.loadAssemblyFromPath(`node_modules/${dir}`, false, [...spec.ALL_SPEC_FEATURES]);

const cdkLib = load('aws-cdk-lib');
const alpha = load('@aws-cdk/aws-bedrock-alpha');

const CDK_LIB_PREFIX = 'https://github.com/aws/aws-cdk/blob/HEAD/packages/aws-cdk-lib';

describe('submodule source directory from symbolId', () => {
  test('strips the symbol and the declaring file', () => {
    expect(submoduleDir('aws-s3/index:')).toBe('aws-s3');
    expect(submoduleDir('aws-s3/lib/mixins/index:')).toBe('aws-s3/lib/mixins');
  });

  test('a submodule declared at the package root yields no directory', () => {
    expect(submoduleDir('index:')).toBe('');
  });

  test('no symbolId means no derivable directory', () => {
    expect(submoduleDir(undefined)).toBeUndefined();
  });

  test('a directory that is not plain path data yields no directory', () => {
    expect(submoduleDir('../../etc/index:')).toBeUndefined();
    expect(submoduleDir('aws-s3/./lib/index:')).toBeUndefined();
    expect(submoduleDir('aws-s3\\lib/index:')).toBeUndefined();
    expect(submoduleDir('aws-s3?x=1/index:')).toBeUndefined();
    expect(submoduleDir('aws s3/index:')).toBeUndefined();
  });
});

describe('upstream README URL', () => {
  test('a submodule resolves through its symbolId, not a name convention', () => {
    expect(upstreamReadmeUrl(cdkLib, 'aws-cdk-lib.aws_s3')).toBe(`${CDK_LIB_PREFIX}/aws-s3/README.md`);
    // Underscores-to-hyphens would produce `custom_resources`; the real
    // directory is `custom-resources`, and symbolId is what knows that.
    expect(upstreamReadmeUrl(cdkLib, 'aws-cdk-lib.custom_resources')).toBe(
      `${CDK_LIB_PREFIX}/custom-resources/README.md`,
    );
  });

  test('the package root resolves to the package README', () => {
    expect(upstreamReadmeUrl(cdkLib, 'aws-cdk-lib')).toBe(`${CDK_LIB_PREFIX}/README.md`);
  });

  test('an alpha package follows its own repository directory', () => {
    expect(upstreamReadmeUrl(alpha, alpha.name)).toBe(
      'https://github.com/aws/aws-cdk/blob/HEAD/packages/@aws-cdk/aws-bedrock-alpha/README.md',
    );
  });

  test('a submodule with no README gets no link rather than a guess', () => {
    // Structural submodules exist as documented pages but carry no README
    // upstream — a derived path for one would 404.
    expect(upstreamReadmeUrl(cdkLib, 'aws-cdk-lib.aws_s3.mixins')).toBeUndefined();
    expect(upstreamReadmeUrl(cdkLib, 'aws-cdk-lib.interfaces.alexa_ask')).toBeUndefined();
  });

  test('an unknown module id resolves to nothing', () => {
    expect(upstreamReadmeUrl(cdkLib, 'aws-cdk-lib.no_such_submodule')).toBeUndefined();
  });

  test('a repository directory that is not plain path data yields no link', () => {
    for (const directory of ['packages/../../evil', 'packages/@aws-cdk/x?y', 'a\\b', 'a#b', 'a b']) {
      const hostile = { ...alpha, repository: { ...alpha.repository, directory } } as spec.Assembly;
      expect(upstreamReadmeUrl(hostile, alpha.name)).toBeUndefined();
    }
  });

  test('an assembly with no repository URL yields no link', () => {
    const orphan = { ...cdkLib, repository: undefined } as unknown as spec.Assembly;
    expect(upstreamReadmeUrl(orphan, 'aws-cdk-lib.aws_s3')).toBeUndefined();
  });

  test('a repository URL that is not plainly https yields no link', () => {
    // `repository.url` is package metadata that ends up bound into an href,
    // and Vue does not sanitize a bound href — so this fails closed into the
    // no-link path rather than rendering whatever a package declares.
    const withUrl = (url: string): spec.Assembly =>
      ({ ...cdkLib, repository: { ...cdkLib.repository, url } } as unknown as spec.Assembly);
    const rejected = [
      'javascript:alert(1)//github.com/aws/aws-cdk',
      'git@github.com:aws/aws-cdk.git',
      'ssh://git@github.com/aws/aws-cdk.git',
      'github:aws/aws-cdk',
      'http://github.com/aws/aws-cdk',
      'https://github.com/aws/aws-cdk" onmouseover="x',
      'https://github.com/aws/aws-cdk?x=1',
    ];
    for (const url of rejected) {
      expect(upstreamReadmeUrl(withUrl(url), 'aws-cdk-lib.aws_s3')).toBeUndefined();
      expect(upstreamReadmeUrl(withUrl(url), 'aws-cdk-lib')).toBeUndefined();
    }
    // The forms that are accepted, including the `git+`/`.git` decorations.
    expect(upstreamReadmeUrl(withUrl('git+https://github.com/aws/aws-cdk.git'), 'aws-cdk-lib')).toBe(
      `${CDK_LIB_PREFIX}/README.md`,
    );
  });

  test('every derived directory is one the assembly declares a README for', () => {
    // The guard against the derivation silently drifting: every
    // readme-bearing submodule must produce a URL, and no other one may.
    const subs = Object.entries(cdkLib.submodules ?? {});
    const withReadme = subs.filter(([, sub]) => sub.readme?.markdown);
    expect(withReadme.length).toBeGreaterThan(300);
    for (const [fqn, sub] of subs) {
      const url = upstreamReadmeUrl(cdkLib, fqn);
      if (sub.readme?.markdown) {
        expect(url).toMatch(/^https:\/\/github\.com\/aws\/aws-cdk\/blob\/HEAD\/packages\/aws-cdk-lib\/.+\/README\.md$/);
      } else {
        expect(url).toBeUndefined();
      }
    }
  });
});
