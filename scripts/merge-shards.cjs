#!/usr/bin/env node
// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Merge per-shard VitePress dist trees into one complete site.
//
// Usage: node scripts/merge-shards.cjs <outDir> [--agent-markdown <dir>] <shardDist...>
//
// Each shard's dist contains its rendered HTML pages, its per-page hydration chunks and the shared
// theme/framework chunks. Shared chunks are content-hashed and byte-identical across shards, so they overlay
// harmlessly; per-page chunks and HTML pages are disjoint, so overlay = union.
//
// Two files must be actively merged rather than overlaid, because each shard writes only its own subset:
// `hashmap.json`, which VitePress fetches at runtime to resolve the lazy chunk for client-side navigation, and
// `sitemap.xml`, which lists the shard's rendered pages (see scripts/sitemap-merge.cjs for the union).
//
// `--agent-markdown <dir>` overlays the agent-oriented Markdown twins docgen wrote (a site tree of `.md` files
// beside the `.html` pages they mirror) exactly once, after the shards. They never pass through VitePress, so this
// is the only step that puts them in the site.
'use strict';
const fs = require('fs');
const path = require('path');
const { copyOverlay, countFiles, overlayAgentMarkdown } = require('./agent-markdown-overlay.cjs');
const { writeMergedSitemap } = require('./sitemap-merge.cjs');
const { DIST_ROOT } = require('./site-paths.cjs');

/** Manifest keys that would write to the object prototype instead of the record. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Resolve a path the way containment checks need: symlink-free, even for a
 * path that does not exist yet (the out dir, before mkdirSync creates it).
 * Walks up to the nearest existing ancestor, realpaths that, and rejoins the
 * missing tail — otherwise a cwd reached through a symlink (e.g. macOS's
 * /var -> /private/var tmpdir) makes an outDir beneath it compare as
 * outside DIST_ROOT, because only one side of the comparison was resolved.
 */
function realpathEvenIfMissing(target) {
  let ancestor = target;
  const tail = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break; // reached the filesystem root
    tail.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...tail);
}

/** The out directory must be the dist root or sit beneath it: it is recursively deleted first. */
function containedOutDir(outDir) {
  const root = realpathEvenIfMissing(path.resolve(DIST_ROOT));
  const resolved = realpathEvenIfMissing(path.resolve(outDir));
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing to merge into ${outDir}: outside ${DIST_ROOT}`);
  }
  return resolved;
}

/** Union one shard's hashmap into the merged record, refusing prototype-shaped keys. */
function unionHashmap(merged, shardHashmap) {
  for (const [key, value] of Object.entries(shardHashmap)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`refusing hashmap.json key ${JSON.stringify(key)}`);
    merged[key] = value;
  }
}

function main() {
  // projen's receiveArgs forwards the CLI `--` separator through to argv;
  // drop any bare `--` tokens so they aren't mistaken for a shard dir.
  const args = process.argv.slice(2).filter((a) => a !== '--');
  let agentMarkdownDir;
  const flag = args.indexOf('--agent-markdown');
  if (flag !== -1) {
    agentMarkdownDir = args[flag + 1];
    if (!agentMarkdownDir) throw new Error('--agent-markdown needs a directory');
    args.splice(flag, 2);
  }
  const [outDirArg, ...shardDists] = args;
  if (!outDirArg || shardDists.length === 0) {
    throw new Error('Usage: merge-shards.cjs <outDir> [--agent-markdown <dir>] <shardDist...>');
  }
  const outDir = containedOutDir(outDirArg);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const mergedHashmap = Object.create(null);
  let totalHtml = 0;

  for (const dist of shardDists) {
    if (!fs.existsSync(dist)) throw new Error(`shard dist not found: ${dist}`);

    // Union hashmap.json rather than overlaying it.
    const hm = path.join(dist, 'hashmap.json');
    if (fs.existsSync(hm)) {
      unionHashmap(mergedHashmap, JSON.parse(fs.readFileSync(hm, 'utf-8')));
    }

    // Overlay everything else (skip the two actively merged files).
    for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
      if (entry.name === 'hashmap.json' || entry.name === 'sitemap.xml') continue;
      const src = path.join(dist, entry.name);
      const dest = path.join(outDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        copyOverlay(src, dest);
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  }

  fs.writeFileSync(path.join(outDir, 'hashmap.json'), JSON.stringify(mergedHashmap));
  const totalSitemapUrls = writeMergedSitemap(shardDists, outDir);

  const totalMarkdown = agentMarkdownDir ? overlayAgentMarkdown(agentMarkdownDir, outDir) : 0;

  totalHtml = countFiles(outDir, '.html');

  // eslint-disable-next-line no-console
  console.log(
    `merged ${shardDists.length} shards -> ${outDir}: ` +
      `${Object.keys(mergedHashmap).length} hashmap entries, ${totalHtml} HTML pages, ${totalSitemapUrls} sitemap URLs` +
      (agentMarkdownDir ? `, ${totalMarkdown} Markdown twins` : ''),
  );
}

main();
