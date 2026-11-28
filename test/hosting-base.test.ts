import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import { siteBase as docgenSiteBase } from '../src/docgen/links.js';
const require = createRequire(import.meta.url);

const ROOT = resolve(import.meta.dirname, '..');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sitePaths = require('../scripts/site-paths.cjs') as {
  DIST_ROOT: string;
  siteBase: (env?: Record<string, string | undefined>) => string;
  distDir: (env?: Record<string, string | undefined>) => string;
  outDir: (env?: Record<string, string | undefined>) => string;
};

/**
 * The site is published as a zip served from a sub-path
 * (https://docs.aws.amazon.com/cdk/api/) whose
 * target takes no loose files at the artifact root. Both facts come from ONE
 * string: `DOCS_BASE` places the site in URL space (`base`) and on disk
 * (`outDir`), so the folder tree mirrors the hosted path and the two cannot
 * drift. These tests pin the derivation, that every build step which needs
 * the site root actually uses it, and that the artifact root stays clean.
 *
 * Config shape throughout: the derivation itself is exercised as produced
 * output below, but a path only one build step still writes by hand renders
 * identically until the day the site moves.
 */
describe('hosted path derivation', () => {
  const hosted = { DOCS_BASE: '/cdk/api/preview-docs/' };

  test('an unset DOCS_BASE keeps the domain root and the flat dist', () => {
    expect(sitePaths.siteBase({})).toBe('/');
    expect(sitePaths.distDir({})).toBe('docs/.vitepress/dist');
    expect(sitePaths.outDir({})).toBe('.vitepress/dist');
  });

  test('the hosted path places both the URL and the output directory', () => {
    expect(sitePaths.siteBase(hosted)).toBe('/cdk/api/preview-docs/');
    expect(sitePaths.distDir(hosted)).toBe('docs/.vitepress/dist/cdk/api/preview-docs');
    expect(sitePaths.outDir(hosted)).toBe('.vitepress/dist/cdk/api/preview-docs');
  });

  test('a base missing its slashes is normalized, never pasted into a path', () => {
    const sloppy = { DOCS_BASE: 'cdk/api/preview-docs' };
    expect(sitePaths.siteBase(sloppy)).toBe('/cdk/api/preview-docs/');
    expect(sitePaths.distDir(sloppy)).toBe('docs/.vitepress/dist/cdk/api/preview-docs');
    // No doubled or trailing separators, whatever the input shape.
    expect(sitePaths.distDir({ DOCS_BASE: '/cdk/' })).toBe('docs/.vitepress/dist/cdk');
  });

  test('a base that is not a URL path prefix is refused before it names a directory', () => {
    for (const raw of ['../etc', '/cdk/../api/', '/cdk/./api/', 'cdk\\api', '/cdk//api/', '/cdk api/', '/cdk?x=1', '/cdk#a', 'https://example.com/cdk/']) {
      expect(() => sitePaths.siteBase({ DOCS_BASE: raw })).toThrow('DOCS_BASE');
      expect(() => sitePaths.distDir({ DOCS_BASE: raw })).toThrow('DOCS_BASE');
    }
    expect(sitePaths.siteBase({ DOCS_BASE: '/cdk/api/v2.1_x~y/' })).toBe('/cdk/api/v2.1_x~y/');
  });

  // docgen prefixes the raw-HTML hrefs it emits with its own copy of this
  // normalization (src/docgen/links.ts, the markdown-rendering ADR).
  // The two must agree or generated deep links land beside the built pages.
  test('docgen and the build agree on what the base is', () => {
    const original = process.env.DOCS_BASE;
    try {
      for (const raw of ['/', '/cdk/api/preview-docs/', 'cdk/api/preview-docs', '/cdk-docs/']) {
        process.env.DOCS_BASE = raw;
        expect(docgenSiteBase()).toBe(sitePaths.siteBase({ DOCS_BASE: raw }));
      }
      delete process.env.DOCS_BASE;
      expect(docgenSiteBase()).toBe(sitePaths.siteBase({}));
    } finally {
      if (original === undefined) delete process.env.DOCS_BASE;
      else process.env.DOCS_BASE = original;
    }
  });

  test('the VitePress config takes both base and outDir from the derivation', () => {
    const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
    expect(config).toContain('base: sitePaths.siteBase()');
    expect(config).toContain('outDir: sitePaths.outDir()');
    // The Pagefind preload resolves against the same base, not a second copy
    // of the env read (a stale copy would 404 the search engine module).
    expect(config).toContain('`${sitePaths.siteBase()}pagefind/pagefind.js`');
    expect(config).not.toContain('process.env.DOCS_BASE ?? "/"');
  });
});

describe('build scripts follow the hosted path', () => {
  // The sharded build and the verifier derive the site directory from DOCS_BASE
  // instead of a literal, so changing the hosted path in one place cannot leave
  // a step pointing at the old directory.
  test('merging, indexing and verification all use the derived site directory', () => {
    const shardBuild = readFileSync(resolve(ROOT, 'scripts/local-shard-build.sh'), 'utf-8');
    expect(shardBuild).toContain('REL_DIST="$(node -p "require(\'./scripts/site-paths.cjs\').distDir()")"');
    expect(shardBuild).toContain('npx pagefind --site "$REL_DIST"');
    expect(shardBuild).toContain('bash scripts/verify-site.sh');
    const verifySite = readFileSync(resolve(ROOT, 'scripts/verify-site.sh'), 'utf-8');
    expect(verifySite).toContain("require('./scripts/site-paths.cjs').distDir()");
    expect(verifySite).toContain('test -f "$SITE_DIST/index.html"');
    expect(verifySite).toContain('test -f "$SITE_DIST/hashmap.json"');
    expect(verifySite).toContain('test -d "$SITE_DIST/pagefind"');
  });

  test('site verification refuses an artifact root with anything beside the hosted tree', () => {
    const verifySite = readFileSync(resolve(ROOT, 'scripts/verify-site.sh'), 'utf-8');
    expect(verifySite).toContain('[ "$(ls -A "$DIST_ROOT")" = "$ROOT_ENTRY" ] ||');
  });

  test('the shard verifier looks in the site directory, the preview server at the tree root', () => {
    // The verifier counts rendered pages, which live at dist/<base>; the
    // server must expose the tree root or a base-prefixed URL cannot resolve.
    expect(readFileSync(resolve(ROOT, 'scripts/shard-verify.cjs'), 'utf-8'))
      .toContain("require('./site-paths.cjs').distDir()");
    expect(readFileSync(resolve(ROOT, 'scripts/e2e-serve.cjs'), 'utf-8'))
      .toContain("require('./site-paths.cjs').DIST_ROOT");
  });
});
