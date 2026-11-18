import * as fs from 'node:fs';
import * as path from 'node:path';
import { pageFile, VERSIONS_ROUTE } from '../src/site-routes.js';

/**
 * Raw anchors the theme renders from STORED page links must name the served
 * file (`.html`), not the bare link. VitePress's client router adds the suffix
 * on an in-page click, which hid the gap; a middle-click, "open in new tab" or
 * a copied link sends the bare path to the host, which answers with `404.html`
 * and a `404` title until the client swaps the page in.
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
  });

  // The theme cannot be unit-tested through VitePress's `withBase`, so pin the
  // call sites by source: each anchor built from a stored link goes through the
  // theme's `pageHref()`, and none reaches for `withBase` on such a link again.
  describe('theme call sites', () => {
    const theme = path.join(import.meta.dirname, '..', 'docs', '.vitepress', 'theme');
    const read = (file: string) => fs.readFileSync(path.join(theme, file), 'utf-8');

    test('pageHref is withBase over pageFile', () => {
      const source = read('page-href.ts');
      expect(source).toContain('import { pageFile } from "../../../src/site-routes"');
      expect(source).toContain('return withBase(pageFile(link));');
    });

    test.each([
      ['ApiSidebarItem.vue', ':href="pageHref(node.link || \'\')"'],
      ['FavoritesList.vue', 'return pageHref(entry.path);'],
      ['NavFilter.vue', 'await router.go(pageHref(target.link));'],
      ['VersionBadge.vue', ':href="pageHref(VERSIONS_ROUTE)"'],
      ['NotFound.vue', ':href="pageHref(item.link)"'],
    ])('%s builds its page href through pageHref()', (file, call) => {
      const source = read(file);
      expect(source).toContain('import { pageHref } from "./page-href";');
      expect(source).toContain(call);
      expect(source).not.toMatch(/withBase\((node\.link|entry\.path|target\.link|item\.link|VERSIONS_ROUTE)/);
    });

    test('no theme component hand-rolls the .html suffix any more', () => {
      for (const file of fs.readdirSync(theme).filter((name) => name.endsWith('.vue'))) {
        expect(read(file)).not.toMatch(/`\$\{[^}]+\}\.html`/);
      }
    });
  });
});
