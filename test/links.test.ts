import * as spec from '@jsii/spec';
import { buildTypeIndex } from '../src/docgen/constructs.js';
import { renderInheritanceChain } from '../src/docgen/layout.js';
import { pageHref, siteBase } from '../src/docgen/links.js';
import { inlineMethodSignature, LinkResolver } from '../src/docgen/signatures.js';

/**
 * Canonical hrefs for raw-HTML cross-reference anchors (see
 * the markdown-rendering ADR). VitePress applies the site `base` and the `.html` suffix to
 * markdown links but not to raw HTML, so anchors emitted as HTML must
 * build the final href themselves via pageHref().
 */
describe('canonical raw-HTML hrefs', () => {
  const originalBase = process.env.DOCS_BASE;

  afterEach(() => {
    if (originalBase === undefined) {
      delete process.env.DOCS_BASE;
    } else {
      process.env.DOCS_BASE = originalBase;
    }
  });

  describe('siteBase', () => {
    test('defaults to the domain root, mirroring config.mts', () => {
      delete process.env.DOCS_BASE;
      expect(siteBase()).toBe('/');
    });

    test('reads DOCS_BASE, the same variable config.mts uses', () => {
      process.env.DOCS_BASE = '/cdk-docs/';
      expect(siteBase()).toBe('/cdk-docs/');
    });

    test('normalizes a missing leading or trailing slash', () => {
      process.env.DOCS_BASE = 'cdk-docs';
      expect(siteBase()).toBe('/cdk-docs/');
    });

    test('refuses a base that is not a URL path prefix', () => {
      for (const raw of ['../etc', '/cdk/../api/', '/cdk/./api/', 'cdk\\api', '/cdk//api/', '/cdk api/', '/cdk?x=1', '/cdk#a', 'https://example.com/cdk/']) {
        process.env.DOCS_BASE = raw;
        expect(() => siteBase()).toThrow('DOCS_BASE');
      }
      process.env.DOCS_BASE = '/cdk/api/v2.1_x~y/';
      expect(siteBase()).toBe('/cdk/api/v2.1_x~y/');
    });
  });

  describe('pageHref', () => {
    test('appends .html so the href matches the generated page file', () => {
      delete process.env.DOCS_BASE;
      expect(pageHref('/api/modules/ts/constructs/core/Construct'))
        .toBe('/api/modules/ts/constructs/core/Construct.html');
    });

    test('prefixes the site base under a sub-path deployment', () => {
      process.env.DOCS_BASE = '/cdk-docs/';
      expect(pageHref('/api/modules/ts/aws-cdk-lib/aws-codebuild/BitBucketSourceCredentialsProps'))
        .toBe('/cdk-docs/api/modules/ts/aws-cdk-lib/aws-codebuild/BitBucketSourceCredentialsProps.html');
    });

    test('directory-style links keep their trailing slash, no .html', () => {
      process.env.DOCS_BASE = '/cdk-docs/';
      expect(pageHref('/api/modules/ts/aws-cdk-lib/')).toBe('/cdk-docs/api/modules/ts/aws-cdk-lib/');
    });

    test.each([
      '//evil.example/x',
      '/\\evil.example/x',
      'https://evil.example/x',
      'javascript:alert(1)',
      '/v2/docs/a?x=1',
      '/v2/docs/a#frag',
      '/v2/docs/a b',
    ])('refuses %s', (link) => {
      delete process.env.DOCS_BASE;
      expect(() => pageHref(link)).toThrow(/not a site-relative page link/);
    });
  });

  // Fixture: a derived class with an inherited base in another assembly
  // and a related props struct — the two link kinds this covers.
  const linkFor: LinkResolver = (fqn) => ({
    'constructs.Construct': '/api/modules/ts/constructs/core/Construct',
    'lib.WidgetProps': '/api/modules/ts/lib/core/WidgetProps',
  }[fqn]);

  test('signature type links carry base + .html, never a bare domain path', () => {
    process.env.DOCS_BASE = '/cdk-docs/';
    const html = inlineMethodSignature({
      name: 'of',
      static: true,
      parameters: [{ name: 'props', type: { fqn: 'lib.WidgetProps' } }],
    } as spec.Method, { linkFor });
    expect(html).toContain(
      '<a class="sig-type" href="/cdk-docs/api/modules/ts/lib/core/WidgetProps.html">WidgetProps</a>',
    );
    expect(html).not.toContain('href="/api/');
  });

  test('inheritance-chain links to an inherited base carry base + .html', () => {
    process.env.DOCS_BASE = '/cdk-docs/';
    const base: spec.ClassType = {
      fqn: 'constructs.Construct',
      kind: spec.TypeKind.Class,
      name: 'Construct',
      assembly: 'constructs',
    } as spec.ClassType;
    const derived: spec.ClassType = {
      fqn: 'lib.Widget',
      kind: spec.TypeKind.Class,
      name: 'Widget',
      assembly: 'lib',
      base: 'constructs.Construct',
    } as spec.ClassType;
    const index = buildTypeIndex([
      { name: 'constructs', types: { [base.fqn]: base } } as unknown as spec.Assembly,
      { name: 'lib', types: { [derived.fqn]: derived } } as unknown as spec.Assembly,
    ]);
    const chain = renderInheritanceChain(derived, index, linkFor).join('\n');
    expect(chain).toContain(
      '<a class="chain-item" href="/cdk-docs/api/modules/ts/constructs/core/Construct.html">Construct</a>',
    );
    expect(chain).not.toContain('href="/api/');
  });
});
