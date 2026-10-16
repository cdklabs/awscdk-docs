#!/usr/bin/env node
// CommonJS on purpose: these scripts require each other and the suite loads them through createRequire, so the .cjs extension is what keeps them CommonJS under an ESM package.
// Agent-readiness gate: owns the static server, runs the `botvisibility` CLI
// against the built site, asserts the reported level against a floor.
//
// The CLI exits 0 whether checks pass or fail, so the gate's verdict comes
// from this script's own comparison against the parsed report — reading its
// exit status would be a gate that can never fail.
//
// Port 0 (OS-assigned) because a fixed port collides with the e2e suite and
// parallel checkouts, the same reason the Lighthouse gate does it.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.agent-readiness');
const READY = /e2e static server: http:\/\/127\.0\.0\.1:(\d+)/;
const READY_TIMEOUT_MS = 30_000;

function readConfig() {
  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'agent-readiness.config.json'), 'utf-8'),
  );
  if (typeof config.url !== 'string' || config.url.length === 0) {
    throw new Error('agent-readiness.config.json: url must be a non-empty string');
  }
  if (!Number.isInteger(config.minLevel) || config.minLevel < 0) {
    throw new Error('agent-readiness.config.json: minLevel must be a non-negative integer');
  }
  if (!Number.isInteger(config.minPassed) || config.minPassed < 1) {
    throw new Error('agent-readiness.config.json: minPassed must be a positive integer');
  }
  return config;
}

/**
 * The configured URL with only the port substituted, so the scan always
 * covers exactly the configured entry point.
 *
 * @param {string} raw
 * @param {number} port
 * @returns {string}
 */
function urlForPort(raw, port) {
  const url = new URL(raw);
  url.port = String(port);
  return url.toString();
}

/**
 * Confirm the scanned URL returns 200. botvisibility scores whatever it is
 * served, so a 404 page would produce a real-looking report.
 *
 * @param {string} url
 * @param {(url: string) => Promise<{status: number}>} fetchImpl
 * @returns {Promise<number|string>} the status, or the failure reason
 */
async function checkUrl(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url);
    return res.status;
  } catch (err) {
    return err.message;
  }
}

/**
 * The level the report claims, and the check tallies behind it.
 *
 * @param {any} report parsed botvisibility --json output
 * @returns {{level: number, passed: number, failed: number, total: number}}
 */
function readLevel(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('botvisibility produced no JSON object');
  }
  if (!Number.isInteger(report.currentLevel)) {
    throw new Error('botvisibility report has no integer currentLevel');
  }
  const score = report.score ?? {};
  return {
    level: report.currentLevel,
    passed: score.passed ?? 0,
    failed: score.failed ?? 0,
    total: score.total ?? 0,
  };
}

function startServer() {
  const child = spawn(process.execPath, [path.join('scripts', 'e2e-serve.cjs'), '0'], {
    cwd: ROOT,
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

/** Scan once and return the parsed report, also written to the report dir. */
function scan(url) {
  const result = spawnSync(
    path.join(ROOT, 'node_modules', '.bin', 'botvisibility'),
    [url, '--json'],
    { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error) {
    throw new Error(`botvisibility could not be run: ${result.error.message}`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.stdout || result.stdout.trim().length === 0) {
    throw new Error(`botvisibility wrote no report for ${url} (exit ${result.status})`);
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), result.stdout);
  return JSON.parse(result.stdout);
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
    const url = urlForPort(config.url, port);

    const status = await checkUrl(url);
    if (status !== 200) {
      throw new Error(`not served (${status}): ${url} — the scan would score the 404 page`);
    }

    const { level, passed, failed, total } = readLevel(scan(url));
    // Two thresholds, because the level alone cannot regress from where the
    // site starts: it is already the lowest level, so a level floor can never
    // be breached. The passing-check count is what actually binds — losing a
    // check that passes today turns the gate red.
    const levelOk = level >= config.minLevel;
    const passedOk = passed >= config.minPassed;
    const ok = levelOk && passedOk;
    // eslint-disable-next-line no-console
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} agent readiness level ${level} (floor ${config.minLevel}) — `
      + `${passed} passed (floor ${config.minPassed}), ${failed} failed of ${total} checks`,
    );
    if (!ok) {
      if (!levelOk) {
        // eslint-disable-next-line no-console
        console.error(`agent readiness level ${level} is below the floor of ${config.minLevel}`);
      }
      if (!passedOk) {
        // eslint-disable-next-line no-console
        console.error(
          `${passed} checks pass, below the floor of ${config.minPassed} — `
          + 'a check that passed before now fails',
        );
      }
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

module.exports = { urlForPort, checkUrl, readLevel };
