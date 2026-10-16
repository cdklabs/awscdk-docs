#!/usr/bin/env node
// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Lighthouse performance gate: owns the static server, runs the `lighthouse`
// CLI per configured page, asserts the median performance score.
// Direct CLI instead of @lhci/cli (stale Lighthouse pin).
//
// Port 0 (OS-assigned) because a fixed port collides with the e2e suite and
// parallel checkouts. E2E_SERVE_GZIP=1 so transfer sizes match production.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.lighthouseci');
const READY = /e2e static server: http:\/\/127\.0\.0\.1:(\d+)/;
const READY_TIMEOUT_MS = 30_000;

function readConfig() {
  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'lighthouse.config.json'), 'utf-8'),
  );
  if (!Array.isArray(config.urls) || config.urls.length === 0) {
    throw new Error('lighthouse.config.json defines no urls');
  }
  if (!Number.isInteger(config.numberOfRuns) || config.numberOfRuns < 1) {
    throw new Error('lighthouse.config.json: numberOfRuns must be a positive integer');
  }
  if (typeof config.minScore !== 'number') {
    throw new Error('lighthouse.config.json: minScore must be a number');
  }
  return config;
}

/**
 * The configured page list with only the port substituted, so the audit
 * always covers exactly the configured pages.
 *
 * @param {number} port
 * @returns {string[]}
 */
function urlsForPort(port) {
  return readConfig().urls.map((raw) => {
    const url = new URL(raw);
    url.port = String(port);
    return url.toString();
  });
}

/**
 * Remove reports left by earlier runs, so the budget check reads only this
 * run's reports.
 *
 * @param {string} dir
 */
function clearReports(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (/\.(report\.json|report\.html|json|html)$/.test(f)) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  }
}

/**
 * Confirm every audited URL returns 200. With --only-categories=performance
 * Lighthouse skips http-status-code and would happily score the 404 page.
 *
 * @param {string[]} urls
 * @param {(url: string) => Promise<{status: number}>} fetchImpl
 * @returns {Promise<{url: string, status: number|string}[]>} non-200 results
 */
async function checkUrls(urls, fetchImpl = fetch) {
  const bad = [];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url);
      if (res.status !== 200) bad.push({ url, status: res.status });
    } catch (err) {
      bad.push({ url, status: err.message });
    }
  }
  return bad;
}

// Third-party hosts kept out of the audit so the JS+CSS budget measures only the theme's own bundles.
const BLOCKED_URL_PATTERNS = ['*docs.aws.amazon.com*'];

/**
 * CLI arguments for one audit run; pinned by a test.
 *
 * @param {string} url
 * @param {string} outputBase path without extension; with multiple output
 *   formats Lighthouse appends `.report.json` / `.report.html` — the names
 *   the budget check globs.
 * @returns {string[]}
 */
function lighthouseArgs(url, outputBase) {
  return [
    url,
    '--only-categories=performance',
    '--preset=desktop',
    '--chrome-flags=--headless=new',
    '--output=json',
    '--output=html',
    `--output-path=${outputBase}`,
    ...BLOCKED_URL_PATTERNS.map((p) => `--blocked-url-patterns=${p}`),
    '--quiet',
  ];
}

/** Filesystem-safe report basename for a URL, unique per run. */
function reportBase(url, run) {
  const { pathname } = new URL(url);
  const slug = pathname.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_|_$/g, '') || 'home';
  return path.join(REPORT_DIR, `${slug}-${run}`);
}

/**
 * Median; even counts take the LOWER middle so they never round a failing
 * page up.
 *
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

/**
 * Assert the median performance score per page. Pure, for the Jest suite.
 * A null score (Lighthouse runtime error) throws rather than being skipped.
 *
 * @param {object[]} reports parsed Lighthouse JSON reports
 * @param {number} minScore
 * @returns {{results: {url: string, score: number, runs: number}[],
 *            failures: {url: string, score: number, runs: number}[]}}
 */
function assertScores(reports, minScore) {
  const byUrl = new Map();
  for (const report of reports) {
    const url = report?.requestedUrl ?? report?.finalDisplayedUrl ?? '<unknown>';
    const score = report?.categories?.performance?.score;
    if (typeof score !== 'number') {
      throw new Error(`Lighthouse run for ${url} produced no performance score`);
    }
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(score);
  }
  const results = [...byUrl.entries()]
    .map(([url, scores]) => ({ url, score: median(scores), runs: scores.length }))
    .sort((a, b) => a.url.localeCompare(b.url));
  return { results, failures: results.filter((r) => r.score < minScore) };
}

function startServer() {
  const child = spawn(process.execPath, [path.join('scripts', 'e2e-serve.cjs'), '0'], {
    cwd: ROOT,
    env: { ...process.env, E2E_SERVE_GZIP: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`static server not ready after ${READY_TIMEOUT_MS}ms`)),
      READY_TIMEOUT_MS,
    );
    child.stdout.on('data', (buf) => {
      const line = buf.toString();
      process.stdout.write(line);
      const match = READY.exec(line);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`static server exited early with code ${code}`));
    });
  });
  return { child, ready };
}

/** Run Lighthouse once and return the parsed JSON report. */
function collectOne(url, run) {
  const base = reportBase(url, run);
  const result = spawnSync(
    path.join(ROOT, 'node_modules', '.bin', 'lighthouse'),
    lighthouseArgs(url, base),
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`lighthouse exited with ${result.status} for ${url}`);
  }
  const jsonPath = `${base}.report.json`;
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`lighthouse reported success but wrote no report at ${jsonPath}`);
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
}

async function main() {
  const config = readConfig();
  const { child, ready } = startServer();
  const stop = () => {
    if (!child.killed) child.kill('SIGTERM');
  };
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  try {
    const port = await ready;
    const urls = urlsForPort(port);

    const bad = await checkUrls(urls);
    if (bad.length > 0) {
      for (const b of bad) {
        // eslint-disable-next-line no-console
        console.error(`not served (${b.status}): ${b.url}`);
      }
      throw new Error(
        `${bad.length} configured page(s) do not return 200 — the audit would measure the 404 page`,
      );
    }

    // After the preflight, before collecting.
    clearReports(REPORT_DIR);
    fs.mkdirSync(REPORT_DIR, { recursive: true });

    const reports = [];
    for (const url of urls) {
      for (let run = 1; run <= config.numberOfRuns; run++) {
        reports.push(collectOne(url, run));
      }
    }

    const { results, failures } = assertScores(reports, config.minScore);
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(
        `${r.score < config.minScore ? 'FAIL' : 'ok  '} performance ${r.score.toFixed(2)} `
        + `(median of ${r.runs}) — ${r.url}`,
      );
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`\n${failures.length} page(s) below the ${config.minScore} performance score`);
      return 1;
    }
    return 0;
  } finally {
    stop();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // eslint-disable-next-line no-console
      console.error(err.message);
      process.exit(1);
    },
  );
}

module.exports = {
  urlsForPort, clearReports, checkUrls, lighthouseArgs, median, assertScores,
};
