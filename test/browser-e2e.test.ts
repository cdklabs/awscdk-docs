import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

describe('the e2e suite cannot validate a build it did not start', () => {
  // Config shape: which server Playwright talks to leaves no trace in a passing run.
  const config = readFileSync(resolve(ROOT, 'test/e2e/playwright.config.ts'), 'utf-8');

  test('the server port is reserved per run, never a fixed one', () => {
    expect(config).toMatch(/const PORT = servePort\(\);/);
    expect(config).not.toMatch(/const PORT = \d+/);
    expect(config).not.toContain('4173');
  });

  test('an existing server is never reused', () => {
    expect(config).toMatch(/reuseExistingServer:\s*false/);
    expect(config).not.toMatch(/reuseExistingServer:\s*!process\.env\.CI/);
  });

  test('the reserved port is the one the server is told to bind', () => {
    expect(config).toMatch(/command: `node scripts\/e2e-serve\.cjs \$\{PORT\}`/);
    expect(config).toMatch(/url: `http:\/\/localhost:\$\{PORT\}\//);
    expect(config).toMatch(/baseURL: `http:\/\/localhost:\$\{PORT\}`/);
  });

  test('no spec falls back to a hardcoded server URL', () => {
    const specs = readdirSync(resolve(ROOT, 'test/e2e'))
      .filter((f) => f.endsWith('.spec.ts'))
      .map((f) => readFileSync(resolve(ROOT, 'test/e2e', f), 'utf-8'));
    for (const spec of specs) {
      expect(spec).not.toMatch(/baseURL\s*\?\?/);
      expect(spec).not.toMatch(/127\.0\.0\.1:\d+/);
      expect(spec).not.toMatch(/localhost:\d+/);
    }
  });

  test('the port is validated whichever source it came from', () => {
    expect(config).toMatch(/Number\(pinned \|\| reserveFreePort\(\)\)/);
    expect(config).toMatch(/port <= 0 \|\| port > 65535/);
    expect(config).toMatch(/throw new Error\(`invalid e2e server port/);
  });

  test('determinism settings stay pinned', () => {
    expect(config).toMatch(/fullyParallel: false/);
    expect(config).toMatch(/forbidOnly: !!process\.env\.CI/);
  });
});
