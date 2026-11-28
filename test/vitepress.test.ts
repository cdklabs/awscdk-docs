import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderApiOverviewPage } from '../src/docgen/index.js';

const ROOT = resolve(import.meta.dirname, '..');

describe('projen VitePress integration', () => {
  // A gitignore entry is inert once the path is tracked, so the pattern alone
  // does not keep a generated asset out of the repo. This asserts the stronger
  // property the patterns exist for: none of the generated docs/public assets
  // is in the index.
  test('generated docs/public assets are not tracked', () => {
    const patterns = readFileSync(resolve(ROOT, '.gitignore'), 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('docs/public/'));
    expect(patterns.length).toBeGreaterThan(0);

    for (const pattern of patterns) {
      const listed = spawnSync('git', ['ls-files', '--', pattern], {
        cwd: ROOT,
        encoding: 'utf-8',
      });
      // A git failure must fail the test rather than read as "nothing tracked".
      expect(listed.status).toBe(0);
      expect(listed.stdout.trim()).toBe('');
    }
  });

  test('no screenshot is tracked', () => {
    const listed = spawnSync('git', ['ls-files', '--', 'screenshots'], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    expect(listed.status).toBe(0);
    expect(listed.stdout.trim()).toBe('');
  });

  // The generated Service -> Resource -> Kind tree (~21.9k
  // entries) must NOT be inlined into themeConfig.sidebar — doing so
  // server-renders it into every one of the ~21.9k API pages and spikes the
  // build. It is emitted once as a static asset and lazy-loaded by
  // the ApiSidebar component instead.
  test('config does not inline the generated API sidebar tree', () => {
    const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
    expect(config).not.toContain('generatedApiSidebar');
    expect(config).not.toContain('sidebar.json');
  });

  test('the served sidebar assets are resolved by the build, not spelled out', () => {
    const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
    // Chunk names are not among them: the skeleton carries its own.
    expect(config).toContain('apiSidebarAssets()');
    expect(config).toMatch(/readdirSync/);
    const component = readFileSync(resolve(ROOT, 'docs/.vitepress/theme/ApiSidebar.vue'), 'utf-8');
    expect(component).toContain('theme.value.apiSidebarAsset');
  });

  test('the theme mounts ApiSidebar in a sidebar slot', () => {
    const themeIndex = readFileSync(resolve(ROOT, 'docs/.vitepress/theme/index.ts'), 'utf-8');
    expect(themeIndex).toContain('ApiSidebar');
    expect(themeIndex).toContain('sidebar-nav-after');
  });

  // A hardcoded `/cdk-docs/` base 404s every link and asset when
  // the site is served from the domain root. The base comes from DOCS_BASE
  // (default `/`) via the shared derivation in scripts/site-paths.cjs, which
  // also places the output directory — see test/hosting-base.test.ts.
  test('site base is derived from DOCS_BASE, not hardcoded', () => {
    const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
    expect(config).toContain('base: sitePaths.siteBase()');
    expect(config).not.toContain('base: "/cdk-docs/"');
  });

  // A config without a `languages` key must never render the toggle from a
  // guessed language set. The compiled gate enforces that at build time: the
  // named JSON import binds an export the config must actually have, so a
  // missing key is a compile error rather than a wrong UI.
  test('missing languages key fails the build instead of guessing', () => {
    const module = readFileSync(
      resolve(ROOT, 'docs/.vitepress/theme/enabled-languages.ts'),
      'utf-8',
    );
    expect(module).toContain('const { languages } = docgenConfig');
  });

  test('the navbar declares no social links', () => {
    const config = readFileSync(resolve(ROOT, 'docs/.vitepress/config.mts'), 'utf-8');
    expect(config).not.toContain('socialLinks');
    expect(config).not.toContain('github.com/aws/aws-cdk');
  });

  // The API overview emits no link to the /v2/ modules index, which does not
  // exist — and a link to it would be a self-link on /api/ anyway. The
  // invariant is that no dead root is linked. The page is generated from the
  // aws-cdk-lib root README, so the check runs against the renderer rather
  // than a checked-in file.
  test('API overview emits no link to the removed modules root', () => {
    const page = renderApiOverviewPage({ readme: { markdown: '# Lib\n\nBody.' } } as any);
    expect(page).not.toContain('(/v2/)');
    // The interim /api/modules/ root does not exist either, so no link may
    // point at it.
    expect(page).not.toContain('(/api/modules/)');
  });

  describe('docs/.vitepress type-check', () => {
    const tsconfig = JSON.parse(
      readFileSync(resolve(ROOT, 'tsconfig.vitepress.json'), 'utf-8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n'),
    );

    // Compiles a tsconfig include glob to a regular expression: the glob wildcards
    // become path-aware groups, everything else matches literally.
    const includeMatcher = (pattern: string): RegExp => {
      const source = pattern
        .split(/(\*\*\/|\*)/)
        .map((part) => {
          if (part === '**/') return '(?:.*/)?';
          if (part === '*') return '[^/]*';
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      return new RegExp(`^${source}$`);
    };

    test('an include glob matches path segments literally outside its wildcards', () => {
      const matcher = includeMatcher('docs/.vitepress/**/*.ts');
      expect(matcher.test('docs/.vitepress/theme/index.ts')).toBe(true);
      expect(matcher.test('docs/Xvitepress/theme/index.ts')).toBe(false);
      expect(includeMatcher('a\\b/*.ts').test('a/c.ts')).toBe(false);
    });

    // Config shape: a source the include globs miss is simply
    // never checked, and nothing downstream reports its silence.
    test('every TypeScript source under docs/.vitepress matches an include pattern', () => {
      const patterns: string[] = tsconfig.include;
      const matchers = patterns.map(includeMatcher);
      const sources = spawnSync('git', ['ls-files', 'docs/.vitepress'], { cwd: ROOT, encoding: 'utf-8' })
        .stdout.split('\n')
        .filter((file) => file.endsWith('.ts') || file.endsWith('.mts'));

      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(matchers.some((matcher) => matcher.test(source))).toBe(true);
      }
    });
  });
});
