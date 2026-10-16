import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

// The install command is the contract a reader pastes, so it is pinned as one
// exact string. Upstream drift or a typo in either the page or this pin fails
// the build rather than shipping a command that does not work.
const INSTALL_COMMAND =
  'npx skills add https://github.com/aws/agent-toolkit-for-aws --skill aws-cdk';

const SKILL_DIR =
  'https://github.com/aws/agent-toolkit-for-aws/tree/main/skills/core-skills/aws-cdk';
const SKILLS_README =
  'https://github.com/aws/agent-toolkit-for-aws/tree/main/skills';

describe('agent skills page', () => {
  const page = readFileSync(resolve(ROOT, 'docs/skills.md'), 'utf-8');
  const config = readFileSync(
    resolve(ROOT, 'docs/.vitepress/config.mts'),
    'utf-8',
  );
  const home = readFileSync(resolve(ROOT, 'docs/index.md'), 'utf-8');

  test('the page is reached from a home feature card', () => {
    expect(home).toContain('title: Agent Skills');
    expect(home).toContain('link: /skills');
  });

  test('the home page still shows exactly four feature cards', () => {
    // Exactly four cards: the grid lays four out as 2x2, and a fifth leaves
    // one orphaned on its own row.
    expect(home.match(/^ {4}title: /gm)).toHaveLength(4);
  });

  /**
   * The source text of `themeConfig.nav`, so assertions about the navbar are
   * scoped to the array rather than to the whole 400-line config — where a
   * `/skills` mention in an unrelated comment would fail them for the wrong
   * reason, and where a differently-spelled entry would slip past.
   */
  function navBlock(): string {
    const start = config.indexOf('nav: [');
    expect(start).toBeGreaterThan(-1);
    const end = config.indexOf('],', start);
    expect(end).toBeGreaterThan(start);
    return config.slice(start, end);
  }

  test('the skills entry occupies a navbar slot without growing the row', () => {
    // Three entries is the budget: a fourth pushes the settings trigger past a
    // 1000px viewport (test/e2e/nav-controls.spec.ts). /skills holds the slot
    // freed by dropping `Home`, so `Home` must not come back.
    const nav = navBlock();
    expect(nav.match(/\{\s*text:/g)).toHaveLength(3);
    expect(nav).toMatch(/link:\s*['"]\/skills/);
    expect(nav).not.toMatch(/text:\s*['"]Home['"]/);
  });

  test('the Versions nav entry is intact', () => {
    // test/versions.test.ts asserts this same literal; the coupling is
    // stated in both places.
    expect(config).toContain('{ text: "Versions", link: VERSIONS_ROUTE }');
  });

  test('the install command renders verbatim in a bash fence', () => {
    expect(page).toContain(`\`\`\`bash\n${INSTALL_COMMAND}\n\`\`\``);
  });

  test('the page links out to the skill directory and the skills README', () => {
    expect(page).toContain(SKILL_DIR);
    expect(page).toContain(SKILLS_README);
  });

  test('no skill content is vendored into this repo', () => {
    // Link-out-don't-vendor: the skill is third-party Apache-2.0 content on
    // its own release cadence, so a build-time copy would drift and would
    // pull attribution obligations in with it. Naming SKILL.md to describe
    // the bundle is fine; carrying a copy of it is not.
    expect(existsSync(resolve(ROOT, 'docs/skills'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'docs/public/skills'))).toBe(false);
  });
});
