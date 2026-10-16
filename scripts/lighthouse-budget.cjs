#!/usr/bin/env node
// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Assert the per-page gzipped JS+CSS budget over Lighthouse's own reports.
//
// The maintainer-confirmed budget (#86) is a COMBINED 400KB gzipped JS+CSS
// ceiling per page. Lighthouse's own budget mechanism can cap `script` and
// `stylesheet` separately but cannot sum them, so no Lighthouse assertion
// can express this gate: two 300KB resource types would pass a 400KB
// per-type budget while the page ships 600KB. This reads the reports
// lighthouse-run.cjs has already written to .lighthouseci/ and sums the two
// resource rows, so the run costs nothing extra.
//
// Sizes are gzipped because the collect server runs with E2E_SERVE_GZIP=1, making transferSize the compressed
// bytes.
'use strict';
const fs = require('fs');
const path = require('path');

const BUDGET_BYTES = 400 * 1024;
const COUNTED = ['script', 'stylesheet'];

/**
 * Sum the transfer size of the counted resource types in one Lighthouse report. Pure, so the Jest suite can
 * exercise it without a browser run.
 *
 * Throws when the `resource-summary` audit is absent rather than measuring
 * zero: it is a hidden diagnostic audit of the performance category, so a
 * lighthouse bump could rename, regroup or drop it — and a page reported as
 * 0.0KB passes the budget while measuring nothing. An empty-but-present
 * `items` array is a different thing and is allowed, as is a counted row that
 * is genuinely absent because the page ships none of that resource type.
 *
 * @param {object} report parsed Lighthouse JSON report
 * @returns {{url: string, bytes: number, breakdown: Record<string, number>}}
 */
function measure(report) {
  const url = report?.finalDisplayedUrl ?? report?.finalUrl ?? '<unknown>';
  const items = report?.audits?.['resource-summary']?.details?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      `Lighthouse report for ${url} has no resource-summary audit items — `
      + 'cannot measure the JS+CSS budget (has the audit been renamed or dropped?)',
    );
  }
  const breakdown = {};
  let bytes = 0;
  for (const type of COUNTED) {
    const row = items.find((i) => i.resourceType === type);
    const size = row?.transferSize ?? 0;
    breakdown[type] = size;
    bytes += size;
  }
  return { url, bytes, breakdown };
}

/**
 * @param {object[]} reports parsed Lighthouse JSON reports
 * @param {number} budget ceiling in bytes
 * @returns {{ measurements: object[], violations: object[] }}
 */
function check(reports, budget = BUDGET_BYTES) {
  // One report per run (numberOfRuns per URL); keep the WORST
  // run per URL so the gate reports one line per page and never passes a
  // page because a lighter run averaged it out.
  const worst = new Map();
  for (const report of reports) {
    const m = measure(report);
    const seen = worst.get(m.url);
    if (!seen || m.bytes > seen.bytes) {
      worst.set(m.url, m);
    }
  }
  const measurements = [...worst.values()].sort((a, b) => a.url.localeCompare(b.url));
  return { measurements, violations: measurements.filter((m) => m.bytes > budget) };
}

function readReports(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(
      `No Lighthouse reports at ${dir} — run the collect step before the budget check`,
    );
  }
  const all = fs.readdirSync(dir);
  // lighthouse-run.cjs writes one <slug>-<run>.report.json per audit run.
  const files = all.filter((f) => f.endsWith('.report.json'));
  if (files.length === 0) {
    throw new Error(`No Lighthouse JSON reports in ${dir} — did the collect step fail?`);
  }
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function main() {
  const dir = path.resolve(__dirname, '..', '.lighthouseci');
  const { measurements, violations } = check(readReports(dir));

  for (const m of measurements) {
    const detail = COUNTED.map((t) => `${t} ${kb(m.breakdown[t])}`).join(', ');
    // eslint-disable-next-line no-console
    console.log(
      `${m.bytes > BUDGET_BYTES ? 'FAIL' : 'ok  '} ${kb(m.bytes)} gzipped JS+CSS (${detail}) — ${m.url}`,
    );
  }

  if (violations.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `\n${violations.length} page(s) over the ${kb(BUDGET_BYTES)} gzipped JS+CSS budget`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${measurements.length} page(s) within the ${kb(BUDGET_BYTES)} budget`);
}

if (require.main === module) {
  main();
}

module.exports = { measure, check, BUDGET_BYTES, COUNTED };
