#!/usr/bin/env node
// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Overlay docgen's agent-oriented Markdown twins and render the hand-written homepage twin into a built site.
//
// The twins are a site-root-relative tree of `.md` files (`v2/docs/<page>.md`) mirroring the `.html` pages, kept
// outside `docs/` so VitePress never compiles them. This is the one step that puts them in a site: the shard merge
// calls it after combining the shards, and the e2e/a11y fixture builds call it after their single-shot build.
//
// Usage: node scripts/agent-markdown-overlay.cjs <agentDir> <siteDir>
'use strict';
const fs = require('fs');
const path = require('path');

function copyOverlay(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`agent markdown overlay refuses symbolic link: ${src}`);
    }
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyOverlay(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function countFiles(dir, ext) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name), ext);
    else if (e.name.endsWith(ext)) n++;
  }
  return n;
}

function homepageTwin() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.md'), 'utf-8');
  const body = source.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  return `# AWS CDK API Reference\n\n${body}\n`;
}

/** Overlay docgen's twins, render the homepage twin, and return the total `.md` file count. */
function overlayAgentMarkdown(agentDir, siteDir) {
  if (!fs.existsSync(agentDir)) throw new Error(`agent markdown dir not found: ${agentDir}`);
  copyOverlay(agentDir, siteDir);
  fs.writeFileSync(path.join(siteDir, 'index.md'), homepageTwin());
  return countFiles(agentDir, '.md') + 1;
}

if (require.main === module) {
  const [agentDir, siteDir] = process.argv.slice(2).filter((a) => a !== '--');
  if (!agentDir || !siteDir) throw new Error('Usage: agent-markdown-overlay.cjs <agentDir> <siteDir>');
  const n = overlayAgentMarkdown(agentDir, siteDir);
  // eslint-disable-next-line no-console
  console.log(`overlaid ${n} Markdown twins onto ${siteDir}`);
}

module.exports = { copyOverlay, countFiles, overlayAgentMarkdown };
