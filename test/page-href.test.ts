import { jest } from '@jest/globals';
import { pageFile, VERSIONS_ROUTE } from '../src/site-routes.js';

/**
 * The host answers an extensionless path with `404.html`, so every anchor
 * built from a stored page link names the `.html` file: `pageFile` is the one
 * suffix rule, and the theme's `pageHref` is VitePress's `withBase` over it.
 */
describe('page links the theme renders as raw anchors', () => {
  describe('pageFile', () => {
    test('appends .html to a stored page link', () => {
      expect(pageFile('/v2/docs/aws-cdk-lib.aws_sqs.Queue')).toBe('/v2/docs/aws-cdk-lib.aws_sqs.Queue.html');
      expect(pageFile(VERSIONS_ROUTE)).toBe('/versions.html');
    });

    test('leaves directory-style, empty and already-suffixed links alone', () => {
      expect(pageFile('/v2/')).toBe('/v2/');
      expect(pageFile('/')).toBe('/');
      expect(pageFile('')).toBe('');
      expect(pageFile('/versions.html')).toBe('/versions.html');
    });

    test('puts .html before a fragment or query, which stay as they are', () => {
      expect(pageFile('/v2/docs/aws-cdk-lib.aws_sqs.Queue#fifo')).toBe('/v2/docs/aws-cdk-lib.aws_sqs.Queue.html#fifo');
      expect(pageFile('/v2/docs/aws-cdk-lib.aws_sqs.Queue?lang=python')).toBe('/v2/docs/aws-cdk-lib.aws_sqs.Queue.html?lang=python');
      expect(pageFile('/v2/docs/aws-cdk-lib.aws_sqs.Queue.html#fifo')).toBe('/v2/docs/aws-cdk-lib.aws_sqs.Queue.html#fifo');
      expect(pageFile('/v2/#top')).toBe('/v2/#top');
    });
  });

  describe('theme pageHref', () => {
    // The theme module resolves the site base through VitePress's `withBase`,
    // so a stand-in with a sub-path base shows both halves of the href.
    beforeAll(() => {
      jest.unstable_mockModule('vitepress', () => ({
        withBase: (path: string) => `/cdk/api${path}`,
      }));
    });

    test('prefixes the base and names the page file', async () => {
      const { pageHref } = await import('../docs/.vitepress/theme/page-href.js');
      expect(pageHref('/v2/docs/aws-cdk-lib.aws_sqs.Queue')).toBe('/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Queue.html');
      expect(pageHref(VERSIONS_ROUTE)).toBe('/cdk/api/versions.html');
      expect(pageHref('/v2/')).toBe('/cdk/api/v2/');
      expect(pageHref('/v2/docs/aws-cdk-lib.aws_sqs.Queue#fifo')).toBe('/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Queue.html#fifo');
    });
  });
});
