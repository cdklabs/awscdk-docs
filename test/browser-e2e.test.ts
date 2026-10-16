import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Guards the browser e2e suite's projen wiring: the docs:e2e task builds a
 * pruned fixture site and runs Playwright, stays OUT of the default build
 * chain, the Jest suite ignores test/e2e/, and a dedicated projen-generated
 * workflow runs the suite with Playwright's own Chromium.
 */
describe('browser e2e suite wiring', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(ROOT, 'package.json'), 'utf-8'),
  );
  const tasks = JSON.parse(
    readFileSync(resolve(ROOT, '.projen/tasks.json'), 'utf-8'),
  ).tasks;

  // Config shape with no produced-output counterpart: whether the runner is
  // installed leaves no trace in the built site.
  test('@playwright/test is a devDependency', () => {
    expect(packageJson.devDependencies['@playwright/test']).toBeDefined();
  });

  describe('docs:e2e task', () => {
    const steps: any[] = tasks['docs:e2e'].steps;

    test('generates docs, prunes the fixture, builds, overlays the Markdown twins, and runs playwright', () => {
      expect(steps[0]).toEqual({ spawn: 'docs:generate' });
      expect(steps[1].exec).toBe('node scripts/e2e-fixture-prune.cjs');
      expect(steps[2].exec).toContain('vitepress build docs');
      expect(steps[3].exec).toContain('node scripts/agent-markdown-overlay.cjs dist-agent-markdown');
      expect(steps[4].exec).toContain('playwright test --config test/e2e/playwright.config.ts');
    });

    // Config shape with no produced-output counterpart: a step that must NOT
    // run produces nothing an output check could look for.
    test('is not part of the default build task', () => {
      const collectSpawns = (name: string, seen = new Set<string>()): Set<string> => {
        if (seen.has(name)) return seen;
        seen.add(name);
        for (const step of tasks[name]?.steps ?? []) {
          if (step.spawn) collectSpawns(step.spawn, seen);
        }
        return seen;
      };
      expect(collectSpawns('build')).not.toContain('docs:e2e');
    });
  });

  // Config shape with no produced-output counterpart: which files a runner
  // collects is invisible in the site it never touches.
  test('jest ignores the Playwright specs under test/e2e/', () => {
    expect(packageJson.jest.testPathIgnorePatterns).toContain('/test/e2e/');
  });

  test('the fixture prune script and playwright config exist', () => {
    expect(existsSync(resolve(ROOT, 'scripts/e2e-fixture-prune.cjs'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'test/e2e/playwright.config.ts'))).toBe(true);
  });

  describe('the suite cannot validate a build it did not start', () => {
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
      expect(config).toMatch(/workers: 1/);
      expect(config).toMatch(/fullyParallel: false/);
      expect(config).toMatch(/forbidOnly: !!process\.env\.CI/);
    });
  });

  describe('docs-e2e workflow', () => {
    // Config shape with no produced-output counterpart throughout: a workflow's
    // triggers and steps act on the CI runner, and none of it reaches the site.
    const workflow = readFileSync(
      resolve(ROOT, '.github/workflows/docs-e2e.yml'),
      'utf-8',
    );

    test('runs on pull requests', () => {
      expect(workflow).toContain('pull_request');
    });

    test('installs Chromium via Playwright (no system browser needed)', () => {
      expect(workflow).toContain('npx playwright install --with-deps chromium');
    });

    test('runs the docs:e2e task', () => {
      expect(workflow).toContain('npx projen docs:e2e');
    });
  });
});
