// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Union the per-shard `sitemap.xml` files VitePress writes into the complete site's sitemap.
//
// Each shard build renders a disjoint subset of pages and lists only those, so the merged site needs the union of
// every shard's `<url>` entries. The sitemap protocol caps one file at 50,000 URLs / 50 MB; past the URL cap the
// union is written as numbered `sitemap-N.xml` parts behind a `sitemap.xml` index, otherwise as one plain file.
'use strict';
const fs = require('fs');
const path = require('path');

/** Per-file URL cap from the sitemap protocol (https://www.sitemaps.org/protocol.html). */
const MAX_URLS_PER_FILE = 50000;

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const URLSET_OPEN = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
const INDEX_OPEN = '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

/**
 * Extract the `<url>…</url>` entries of one sitemap, keyed by their `<loc>` so the same page listed by two inputs
 * collapses to one entry. Entries are kept verbatim, so whatever else VitePress wrote per URL survives.
 */
function parseUrlEntries(xml) {
  const entries = new Map();
  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([\s\S]*?)<\/loc>/.exec(match[1]);
    if (!loc) continue;
    entries.set(loc[1].trim(), `<url>${match[1]}</url>`);
  }
  return entries;
}

/**
 * The site URL every `<loc>` was resolved against. VitePress writes the root page as the bare hostname, so it is
 * the one entry that prefixes all the others; without a root page, the longest common directory prefix stands in.
 */
function siteUrlOf(locs) {
  const root = locs.find((candidate) => locs.every((loc) => loc.startsWith(candidate)));
  if (root) return root;
  let prefix = locs[0] ?? '';
  for (const loc of locs) {
    while (!loc.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix.slice(0, prefix.lastIndexOf('/') + 1);
}

/**
 * Merge sitemap XML documents into the files to write: `[{ name, xml }]`. A union that fits one file is a single
 * `sitemap.xml`; a larger one becomes `sitemap-1.xml`, `sitemap-2.xml`, … plus a `sitemap.xml` index whose `<loc>`s
 * sit beside the pages under the site URL. Entries are sorted by `<loc>` so the output does not depend on shard order.
 */
function mergeSitemaps(xmls, maxPerFile = MAX_URLS_PER_FILE) {
  const union = new Map();
  for (const xml of xmls) {
    for (const [loc, entry] of parseUrlEntries(xml)) union.set(loc, entry);
  }
  const locs = [...union.keys()].sort();
  const entries = locs.map((loc) => union.get(loc));
  const urlset = (list) => `${XML_HEADER}\n${URLSET_OPEN}\n${list.join('\n')}\n</urlset>\n`;

  if (entries.length <= maxPerFile) {
    return [{ name: 'sitemap.xml', xml: urlset(entries) }];
  }
  const files = [];
  for (let i = 0; i < entries.length; i += maxPerFile) {
    files.push({ name: `sitemap-${files.length + 1}.xml`, xml: urlset(entries.slice(i, i + maxPerFile)) });
  }
  const siteUrl = siteUrlOf(locs);
  const index = files.map((f) => `<sitemap><loc>${new URL(f.name, siteUrl).href}</loc></sitemap>`);
  files.unshift({ name: 'sitemap.xml', xml: `${XML_HEADER}\n${INDEX_OPEN}\n${index.join('\n')}\n</sitemapindex>\n` });
  return files;
}

/** Read every shard's `sitemap.xml` (shards without one are skipped) and write the union into `outDir`. */
function writeMergedSitemap(shardDists, outDir) {
  const xmls = shardDists
    .map((dist) => path.join(dist, 'sitemap.xml'))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, 'utf-8'));
  if (xmls.length === 0) return 0;
  const files = mergeSitemaps(xmls);
  for (const { name, xml } of files) fs.writeFileSync(path.join(outDir, name), xml);
  return files.reduce((n, f) => n + parseUrlEntries(f.xml).size, 0);
}

module.exports = { MAX_URLS_PER_FILE, parseUrlEntries, siteUrlOf, mergeSitemaps, writeMergedSitemap };
