#!/usr/bin/env node
// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Prune the generated API docs down to a single build shard.
//
// The full VitePress SPA build holds Rollup's entire per-page chunk graph in memory; that graph is superlinear
// in page count, so the full ~21k-page site needs ~30GB and OOMs on standard CI runners. We therefore build the
// site in parallel shards and merge the dist trees (see scripts/merge-shards.cjs).
//
// Shard assignment balances by page count, not service count: CDK services are wildly unequal, so a
// round-robin-by-name split leaves one shard with far more pages than the lightest, and the bundle phase is
// superlinear in page count. Instead we bin-pack: services sorted by page count descending are greedily
// assigned to the shard with the fewest total pages (LPT scheduling). The assignment is a pure function of the
// generated tree and SHARD_TOTAL, so every shard job computes the same plan: shards stay disjoint and their
// union is the full service set.
//
// This script keeps only the prune units assigned to this shard, deleting the rest. Pages live in the flat
// `docs/v2/docs/` layout; a prune unit is either one aws-cdk-lib service (every `aws-cdk-lib.<submodule>.*`
// page plus the `…<submodule>-readme` overview, with package-root types as the `core` unit) or all pages of a
// standalone module. Oversized units from either source are split below before they are assigned to shards.
//
// Units larger than the ideal per-shard mean (ceil(totalPages / SHARD_TOTAL)) are split into near-equal
// sub-units of at most that many pages before assignment, so the LPT floor is never a single oversized unit.
// Splitting is safe because a unit is only a set of independent page files: docs:merge unions disjoint page
// sets, the complete sidebar/symbols data ships with every shard, and cross-page links are plain hrefs.
// Sub-units are derived from the lexicographically sorted file list, so the plan stays a pure function of the
// generated tree and SHARD_TOTAL. Everything else — hand-written pages, the package overview, and the complete
// api-sidebar assets and type-summaries.json — is left intact in every shard.
//
// Env: SHARD_INDEX (0-based), SHARD_TOTAL (>=1).
'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Prune-unit key for a generated page file name in the flat `docs/v2/docs/` layout:
 * `<docId>[.<submodule>].<Type>.md` or `<docId>[.<submodule>]-readme.md`.
 *
 *  - standalone modules (anything but aws-cdk-lib) are atomic: every page of the package maps to the docId;
 *  - aws-cdk-lib pages map to `aws-cdk-lib/<submodule>` — the submodule is the run of leading lowercase
 *    snake_case segments (type names are PascalCase, so case separates them). Dotted structural submodules
 *    (`interfaces.aws_s3`) keep their full dotted name, so each stays its own service-sized unit;
 *  - aws-cdk-lib root types map to `aws-cdk-lib/core`;
 *  - the aws-cdk-lib package readme maps to null: it stays in every shard.
 */
function unitFor(fileName) {
  const base = fileName.replace(/\.md$/, '').replace(/-readme$/, '');
  const dot = base.indexOf('.');
  const docId = dot < 0 ? base : base.slice(0, dot);
  if (docId !== 'aws-cdk-lib') {
    return docId;
  }
  if (dot < 0) {
    return null; // aws-cdk-lib-readme.md — the package overview.
  }
  const submodule = [];
  for (const seg of base.slice(dot + 1).split('.')) {
    if (!/^[a-z][a-z0-9_]*$/.test(seg)) {
      break;
    }
    submodule.push(seg);
  }
  return submodule.length > 0 ? `aws-cdk-lib/${submodule.join('.')}` : 'aws-cdk-lib/core';
}

/**
 * Assign services to shards balancing total page count (greedy longest-first /
 * LPT). Deterministic: services are ordered by page count descending with name
 * as the tie-break, and ties between equally-loaded shards go to the lowest
 * shard index — so every shard job independently computes the same plan.
 *
 * @param {{name: string, pages: number}[]} services
 * @param {number} total number of shards
 * @returns {number[]} shard index per service (parallel to `services`)
 */
function assignShards(services, total) {
  const order = [...services.keys()].sort((a, b) =>
    services[b].pages - services[a].pages || services[a].name.localeCompare(services[b].name));
  const load = new Array(total).fill(0);
  const assignment = new Array(services.length);
  for (const i of order) {
    let target = 0;
    for (let s = 1; s < total; s++) {
      if (load[s] < load[target]) target = s;
    }
    assignment[i] = target;
    load[target] += services[i].pages;
  }
  return assignment;
}

/**
 * Split units larger than `cap` pages into near-equal sub-units of at most `cap` pages each, so the LPT
 * bin-pack floor is never a single oversized unit. Deterministic: `files` must arrive sorted, sub-units take
 * contiguous slices in that order and are named `<name>#<i>`, so every shard job computes the same split.
 *
 * @param {{name: string, files: string[]}[]} units sorted-file units
 * @param {number} cap max pages per (sub-)unit, >= 1
 * @returns {{name: string, files: string[]}[]}
 */
function splitOversized(units, cap) {
  /** @type {{name: string, files: string[]}[]} */
  const out = [];
  for (const unit of units) {
    if (unit.files.length <= cap) {
      out.push(unit);
      continue;
    }
    const parts = Math.ceil(unit.files.length / cap);
    const base = Math.floor(unit.files.length / parts);
    let extra = unit.files.length - base * parts;
    let offset = 0;
    for (let i = 0; i < parts; i++) {
      const size = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      out.push({ name: `${unit.name}#${i}`, files: unit.files.slice(offset, offset + size) });
      offset += size;
    }
  }
  return out;
}

function main() {
  const index = Number(process.env.SHARD_INDEX);
  const total = Number(process.env.SHARD_TOTAL);
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
    throw new Error(`Invalid SHARD_INDEX=${process.env.SHARD_INDEX} / SHARD_TOTAL=${process.env.SHARD_TOTAL}`);
  }
  const root = process.cwd();
  const docsDir = path.join(root, 'docs', 'v2', 'docs');
  if (!fs.existsSync(path.join(docsDir, 'aws-cdk-lib-readme.md'))) {
    throw new Error(`Generated docs not found at ${docsDir}; run docs:generate first`);
  }

  // Group the flat page files into prune units.
  /** @type {Map<string, string[]>} unit -> page file names */
  const byUnit = new Map();
  for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const unit = unitFor(entry.name);
    if (unit === null) {
      continue; // package overview — stays in every shard
    }
    const list = byUnit.get(unit) ?? [];
    list.push(entry.name);
    byUnit.set(unit, list);
  }

  /** @type {{ name: string, pages: number, remove: () => void }[]} */
  const rawUnits = [...byUnit.entries()].map(([name, files]) => ({ name, files: files.sort() }));
  rawUnits.sort((a, b) => a.name.localeCompare(b.name));

  const totalPages = rawUnits.reduce((sum, unit) => sum + unit.files.length, 0);
  const cap = Math.max(1, Math.ceil(totalPages / total));
  const units = splitOversized(rawUnits, cap).map(({ name, files }) => ({
    name,
    pages: files.length,
    remove: () => {
      for (const file of files) {
        fs.rmSync(path.join(docsDir, file), { force: true });
      }
    },
  }));

  const assignment = assignShards(units, total);

  let kept = 0;
  let keptPages = 0;
  units.forEach((unit, i) => {
    if (assignment[i] === index) {
      kept++;
      keptPages += unit.pages;
      return;
    }
    unit.remove();
  });

  // eslint-disable-next-line no-console
  console.log(
    `shard ${index}/${total}: kept ${kept} of ${units.length} prune units (${keptPages} pages)`,
  );
}

if (require.main === module) {
  main();
}

module.exports = { assignShards, unitFor, splitOversized };
