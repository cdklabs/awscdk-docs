#!/usr/bin/env node
// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Prune the generated API docs down to the small browser-e2e fixture.
//
// The full ~21k-page site is too heavy to rebuild for every browser-test run, so the e2e suite builds a small
// subset: a handful of aws-cdk-lib services plus the `constructs` module and the hand-written pages. The
// complete client-side assets (the api-sidebar/ skeleton, chunks, symbol index and type-summary lookup) are
// left intact, so the interactive features under test see the same data as in production.
//
// Env: E2E_FIXTURE_SERVICES — comma-separated aws-cdk-lib service dirs to keep (default: aws-sns,aws-sqs).
// E2E_FIXTURE_MODULES — comma-separated standalone module docIds or their historical directory slugs (e.g.
// `constructs`, `aws-cdk-aws-glue-alpha`) to keep besides aws-cdk-lib (default: constructs). Every other
// standalone module tree is dropped to keep the single-process 4 GB e2e VitePress build within its heap.
'use strict';
const fs = require('fs');
const path = require('path');
const { unitFor } = require('./shard-prune.cjs');

const DEFAULT_SERVICES = 'aws-sns,aws-sqs';
const DEFAULT_MODULES = 'constructs';

function main() {
  const keep = new Set(
    (process.env.E2E_FIXTURE_SERVICES ?? DEFAULT_SERVICES)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (keep.size === 0) {
    throw new Error('E2E_FIXTURE_SERVICES must name at least one service directory');
  }
  const keepModules = new Set(
    (process.env.E2E_FIXTURE_MODULES ?? DEFAULT_MODULES)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  keepModules.add('aws-cdk-lib');

  const root = process.cwd();
  const docsDir = path.join(root, 'docs', 'v2', 'docs');
  if (!fs.existsSync(docsDir)) {
    throw new Error(`Generated docs not found at ${docsDir}; run docs:generate first`);
  }

  // Fixture services name aws-cdk-lib submodules by their directory slug (`aws-sns`); the flat layout's unit key
  // uses the jsii submodule name (`aws_sns`) — identifiers cannot contain dashes, so the slug reverses losslessly.
  const keepUnits = new Set([...keep].map((s) => `aws-cdk-lib/${s.replace(/-/g, '_')}`));

  const seenUnits = new Set();
  let removed = 0;
  let keptPages = 0;
  for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const unit = unitFor(entry.name);
    if (unit === null) {
      keptPages++; // aws-cdk-lib package overview — always in the fixture
      continue;
    }
    seenUnits.add(unit);
    const [pkg] = unit.startsWith('aws-cdk-lib/') ? ['aws-cdk-lib'] : [unit];
    const kept = pkg === 'aws-cdk-lib'
      ? keepUnits.has(unit)
      : keepModules.has(unit) || keepModules.has(slugOf(unit));
    if (kept) {
      keptPages++;
      continue;
    }
    fs.rmSync(path.join(docsDir, entry.name), { force: true });
    removed++;
  }

  const missing = [...keepUnits].filter((u) => !seenUnits.has(u));
  if (missing.length > 0) {
    throw new Error(`Fixture services not found under ${docsDir}: ${missing.join(', ')}`);
  }

  // eslint-disable-next-line no-console
  console.log(`e2e fixture: kept ${keptPages} pages, removed ${removed}`);
}

/**
 * Directory slug of a standalone module docId (`@aws-cdk_aws-glue-alpha` -> `aws-cdk-aws-glue-alpha`), accepted
 * in E2E_FIXTURE_MODULES.
 */
function slugOf(docId) {
  return docId.replace(/^@/, '').replace(/[/_]/g, '-');
}

main();
