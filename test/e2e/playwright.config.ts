import { execFileSync } from 'child_process';
import * as path from 'path';
import { defineConfig, devices } from '@playwright/test';

// Browser e2e suite.
//
// Runs against the BUILT fixture site (docs:e2e generates + prunes + builds
// it first): Playwright boots scripts/e2e-serve.cjs — a plain static file
// server over docs/.vitepress/dist bound to localhost — and drives the real
// hydrated pages in Chromium. (Not `vitepress preview`: its on-the-fly
// brotli compression takes ~5s per multi-MB JSON asset, starving the
// fetch-driven features under test — see the note in e2e-serve.cjs.)

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * The port this run's static server listens on.
 *
 * Carried in the environment because Playwright re-evaluates this config in
 * every worker process.
 */
function servePort(): number {
  const pinned = process.env.E2E_SERVE_PORT;
  // `||` so an empty value means "no pin"; a literal "0" is truthy and still rejected below.
  const port = Number(pinned || reserveFreePort());
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid e2e server port: ${JSON.stringify(pinned ?? port)}`);
  }
  process.env.E2E_SERVE_PORT = String(port);
  return port;
}

/** Ask the OS for a port nothing is listening on. */
function reserveFreePort(): string {
  return execFileSync(
    process.execPath,
    ['-e', "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});"],
    { encoding: 'utf-8' },
  ).trim();
}

const PORT = servePort();

export default defineConfig({
  testDir: import.meta.dirname,
  outputDir: path.join(import.meta.dirname, 'test-results'),
  timeout: 30_000,
  // The suite mutates localStorage; contexts are isolated per test, but the
  // static server is shared and single-threaded, so run one worker and keep
  // tests within a file sequential — deterministic over marginally slower.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: path.join(import.meta.dirname, 'playwright-report') }]]
    : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `node scripts/e2e-serve.cjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    cwd: ROOT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      // Keep the AWS docs boot script out of every other spec: its consent banner overlays the bottom of the
      // page for EU-geolocated runners only, which would make the suite pass or fail by geography.
      testIgnore: /cookie-consent\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--host-resolver-rules=MAP docs.aws.amazon.com ~NOTFOUND'] },
      },
    },
    {
      name: 'cookie-consent',
      testMatch: /cookie-consent\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
