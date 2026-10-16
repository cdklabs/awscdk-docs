import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
const require = createRequire(import.meta.url);

const ROOT = resolve(import.meta.dirname, '..');
const MERGE = join(ROOT, 'scripts', 'merge-shards.cjs');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MAX_URLS_PER_FILE, mergeSitemaps, parseUrlEntries, siteUrlOf } = require(join(ROOT, 'scripts', 'sitemap-merge.cjs')) as {
  MAX_URLS_PER_FILE: number;
  parseUrlEntries: (xml: string) => Map<string, string>;
  siteUrlOf: (locs: string[]) => string;
  mergeSitemaps: (xmls: string[], maxPerFile?: number) => { name: string; xml: string }[];
};

const SITE = 'https://docs.aws.amazon.com/cdk/api/';

/** A sitemap the way VitePress writes one: one `<url>` per rendered page, resolved against the hostname. */
function sitemap(paths: string[], site = SITE): string {
  const urls = paths.map((p) => `<url><loc>${new URL(p, site).href}</loc></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

const locsOf = (xml: string) => [...parseUrlEntries(xml).keys()];

describe('sitemap union', () => {
  test('unions disjoint shard sitemaps and collapses the pages every shard lists', () => {
    // Every shard renders the home page and the package overview; only the member pages are disjoint.
    const shardA = sitemap(['', 'v2/docs/aws-cdk-lib-readme.html', 'v2/docs/aws-cdk-lib.aws_sqs.Queue.html']);
    const shardB = sitemap(['', 'v2/docs/aws-cdk-lib-readme.html', 'v2/docs/aws-cdk-lib.aws_sns.Topic.html']);

    const files = mergeSitemaps([shardA, shardB]);

    expect(files.map((f) => f.name)).toEqual(['sitemap.xml']);
    expect(locsOf(files[0].xml)).toEqual([
      `${SITE}`,
      `${SITE}v2/docs/aws-cdk-lib-readme.html`,
      `${SITE}v2/docs/aws-cdk-lib.aws_sns.Topic.html`,
      `${SITE}v2/docs/aws-cdk-lib.aws_sqs.Queue.html`,
    ]);
    expect(files[0].xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(files[0].xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  test('is independent of shard order', () => {
    const a = sitemap(['', 'v2/docs/b.html']);
    const b = sitemap(['', 'v2/docs/a.html']);
    expect(mergeSitemaps([a, b])).toEqual(mergeSitemaps([b, a]));
  });

  test('keeps whatever else a URL entry carries', () => {
    const xml = `<urlset><url><loc>${SITE}v2/docs/a.html</loc><lastmod>2026-09-13</lastmod></url></urlset>`;
    expect(mergeSitemaps([xml])[0].xml).toContain(`<url><loc>${SITE}v2/docs/a.html</loc><lastmod>2026-09-13</lastmod></url>`);
  });

  test('past the per-file URL cap the union becomes numbered parts behind a sitemap index', () => {
    const paths = ['', ...Array.from({ length: 7 }, (_, i) => `v2/docs/p${i}.html`)];
    const files = mergeSitemaps([sitemap(paths)], 3);

    expect(files.map((f) => f.name)).toEqual(['sitemap.xml', 'sitemap-1.xml', 'sitemap-2.xml', 'sitemap-3.xml']);
    expect(files[0].xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(files[0].xml).toContain(`<sitemap><loc>${SITE}sitemap-1.xml</loc></sitemap>`);
    expect(files[0].xml).toContain(`<sitemap><loc>${SITE}sitemap-3.xml</loc></sitemap>`);
    expect(files[0].xml).not.toContain('<url>');

    const partLocs = files.slice(1).map((f) => locsOf(f.xml));
    expect(partLocs.map((l) => l.length)).toEqual([3, 3, 2]);
    expect(partLocs.flat().sort()).toEqual(paths.map((p) => new URL(p, SITE).href).sort());
  });

  test('the default cap is the sitemap protocol limit', () => {
    expect(MAX_URLS_PER_FILE).toBe(50000);
  });

  test('the site URL is the root page entry, or the common directory when there is none', () => {
    expect(siteUrlOf([`${SITE}v2/docs/a.html`, SITE, `${SITE}versions.html`])).toBe(SITE);
    expect(siteUrlOf([`${SITE}v2/docs/a.html`, `${SITE}v2/docs/b.html`])).toBe(`${SITE}v2/docs/`);
  });
});

describe('merge-shards sitemap', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sitemap-merge-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function shard(name: string, pages: string[]): string {
    const dist = join(tmp, name);
    mkdirSync(join(dist, 'v2', 'docs'), { recursive: true });
    for (const p of pages) writeFileSync(join(dist, p), '<html></html>');
    writeFileSync(join(dist, 'hashmap.json'), '{}');
    writeFileSync(join(dist, 'sitemap.xml'), sitemap(['', ...pages]));
    return dist;
  }

  test('the merged site carries one sitemap listing every shard page exactly once', () => {
    const a = shard('a', ['v2/docs/aws-cdk-lib.aws_sqs.Queue.html']);
    const b = shard('b', ['v2/docs/aws-cdk-lib.aws_sns.Topic.html']);
    const out = join(tmp, 'docs', '.vitepress', 'dist');

    const log = execFileSync('node', [MERGE, out, a, b], { cwd: tmp }).toString();

    expect(locsOf(readFileSync(join(out, 'sitemap.xml'), 'utf-8'))).toEqual([
      SITE,
      `${SITE}v2/docs/aws-cdk-lib.aws_sns.Topic.html`,
      `${SITE}v2/docs/aws-cdk-lib.aws_sqs.Queue.html`,
    ]);
    expect(existsSync(join(out, 'sitemap-1.xml'))).toBe(false);
    expect(log).toContain('3 sitemap URLs');
  });

  test('shards without a sitemap merge as before', () => {
    const a = shard('a', ['v2/docs/x.html']);
    rmSync(join(a, 'sitemap.xml'));
    const out = join(tmp, 'docs', '.vitepress', 'dist');

    const log = execFileSync('node', [MERGE, out, a], { cwd: tmp }).toString();

    expect(existsSync(join(out, 'sitemap.xml'))).toBe(false);
    expect(log).toContain('0 sitemap URLs');
  });
});
