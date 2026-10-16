#!/usr/bin/env node
// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Verify a shard's VitePress build actually rendered its pages.
//
// A VitePress build can lose its render process to a heap OOM and still exit 0, and the merged site's page-count
// guard only catches that after every shard has run, hiding which shard died. This script runs inside each
// shard, right after the build, and fails the shard itself when its output is incomplete.
//
// Expected page count is derived from the shard's own pruned source tree: VitePress renders one HTML page per
// markdown page, so the number of .md files under docs/ (minus srcExclude'd trees: adr/** always, spike/** under
// SHARD_BUILD) is the floor for the .html files that must exist in the dist. Self-scales with shard count.
'use strict';
const fs = require('fs');
const path = require('path');

const EXCLUDED = new Set(['.vitepress', 'adr', 'spike']);

function countFiles(dir, ext, skipTopLevel) {
  let count = 0;
  const walk = (d, depth) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (depth === 0 && skipTopLevel && skipTopLevel.has(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        count++;
      }
    }
  };
  walk(dir, 0);
  return count;
}

function main() {
  const root = process.cwd();
  const docsDir = path.join(root, 'docs');
  // The built site follows DOCS_BASE, so ask for the directory rather
  // than assuming the flat dist.
  const distDir = path.join(root, require('./site-paths.cjs').distDir());

  if (!fs.existsSync(distDir)) {
    throw new Error(`shard-verify: dist not found at ${distDir} — the VitePress build produced no output (likely an OOM-killed build process)`);
  }

  const expected = countFiles(docsDir, '.md', EXCLUDED);
  const actual = countFiles(distDir, '.html');

  // eslint-disable-next-line no-console
  console.log(`shard-verify: ${actual} HTML pages rendered for ${expected} markdown source pages`);

  if (actual < expected) {
    throw new Error(
      `shard-verify: only ${actual} HTML pages in dist but ${expected} markdown pages in the pruned source tree — ` +
      'the build lost pages (a render/bundle worker most likely died on a heap OOM without failing the exit code). ' +
      'Failing this shard so the merge does not assemble an incomplete site.',
    );
  }
}

main();
