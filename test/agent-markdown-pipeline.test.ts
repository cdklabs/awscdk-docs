import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { agentMarkdownHref } from '../docs/.vitepress/agent-markdown.js';
import { generateDocs } from '../src/docgen/index.js';

const ROOT = resolve(import.meta.dirname, '..');

/** Every file under `dir`, relative to it, sorted. */
function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const entryRel = rel ? join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(dir, entryRel));
    } else {
      out.push(entryRel);
    }
  }
  return out.sort();
}

describe('agent-oriented Markdown twins', () => {
  let outDir: string;
  let agentOutDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'agent-md-canonical-'));
    agentOutDir = mkdtempSync(join(tmpdir(), 'agent-md-twins-'));
    generateDocs(
      { modules: ['constructs'] },
      { outDir, agentOutDir, packageRoot: ROOT, languages: ['ts', 'python'], overviewFile: join(outDir, 'index.md') },
    );
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(agentOutDir, { recursive: true, force: true });
  });

  test('every generated page has a twin at the same site path, and nothing else is in the tree but the index', () => {
    const pages = walk(outDir).filter((f) => f.endsWith('.md'));
    const twins = walk(agentOutDir).filter((f) => f !== 'llms.txt');
    expect(twins.length).toBeGreaterThan(5);
    // Canonical pages sit at `<outDir>/docs/X.md` for the `/v2/docs/X` route and `<outDir>/index.md` for `/v2/`;
    // twins mirror the full route.
    expect(twins).toEqual(pages.map((p) => join('v2', p)));
    expect(twins).toContain(join('v2', 'index.md'));
  });

  test('llms.txt at the tree root lists every module overview twin exactly once, sorted, and nothing else', () => {
    const index = readFileSync(join(agentOutDir, 'llms.txt'), 'utf-8');
    expect(index.startsWith('# AWS CDK Reference\n\n> ')).toBe(true);
    expect(index).toContain('](https://docs.aws.amazon.com/cdk/api/sitemap.xml)');
    const listed = [...index.matchAll(/^- \[[^\]]+\]\(https:\/\/docs\.aws\.amazon\.com\/cdk\/api\/([^)]+)\): (\S+)$/gm)]
      .map((m) => ({ twin: m[1], module: m[2] }));
    const overviews = walk(agentOutDir).filter((f) => f.endsWith('-readme.md'));
    expect(listed.map((e) => e.twin).sort()).toEqual(overviews);
    expect(listed.map((e) => e.module)).toEqual([...listed.map((e) => e.module)].sort());
    expect(new Set(listed.map((e) => e.module)).size).toBe(listed.length);
    // The title is the overview's own H1, so an agent sees the library name rather than the package id.
    const constructs = listed.find((e) => e.module === 'constructs')!;
    const twin = readFileSync(join(agentOutDir, constructs.twin), 'utf-8');
    expect(index).toContain(`- [${/^# (.+)$/m.exec(twin)![1]}](`);
    // Every listed twin is a file that was written.
    for (const e of listed) {
      expect(existsSync(join(agentOutDir, e.twin))).toBe(true);
    }
  });

  test('the landing page names its twin too', () => {
    const landing = readFileSync(join(outDir, 'index.md'), 'utf-8');
    expect(landing.startsWith('---\nagentMarkdown: "/v2/index.md"\n')).toBe(true);
    expect(readFileSync(join(agentOutDir, 'v2', 'index.md'), 'utf-8').startsWith('# ')).toBe(true);
  });

  test('the canonical page names its twin in frontmatter, by the route with .md appended', () => {
    const page = readFileSync(join(outDir, 'docs', 'constructs.Node.md'), 'utf-8');
    expect(page.startsWith('---\nagentMarkdown: "/v2/docs/constructs.Node.md"\n')).toBe(true);
    // The rest of the frontmatter survives.
    expect(page).toContain('\ntitle: "Node"\n---');
    expect(existsSync(join(agentOutDir, 'v2', 'docs', 'constructs.Node.md'))).toBe(true);
  });

  test('an overview page keeps its own frontmatter beside the key', () => {
    const readme = readFileSync(join(outDir, 'docs', 'constructs-readme.md'), 'utf-8');
    expect(readme.startsWith('---\nagentMarkdown: "/v2/docs/constructs-readme.md"\nupstreamEditUrl: ')).toBe(true);
    const twin = readFileSync(join(agentOutDir, 'v2', 'docs', 'constructs-readme.md'), 'utf-8');
    expect(twin.startsWith('# Constructs\n')).toBe(true);
    expect(twin).toContain('> **Separate package**');
  });

  test('the twin body is plain Markdown: content kept, chrome and non-canonical variants gone', () => {
    const twin = readFileSync(join(agentOutDir, 'v2', 'docs', 'constructs.Node.md'), 'utf-8');
    const canonical = readFileSync(join(outDir, 'docs', 'constructs.Node.md'), 'utf-8');
    expect(twin.startsWith('# Node\n')).toBe(true);
    expect(twin).toContain('```ts');
    expect(twin).not.toContain('```python');
    expect(twin).not.toContain('agentMarkdown');
    for (const marker of ['<LanguageTabs', 'lang-variant', '<Badge', '<nav', 'v-pre', '---\n']) {
      expect(twin).not.toContain(marker);
    }
    // Real content shrinks but survives: a documented member and its prose are still there.
    expect(twin).toContain('addDependency');
    expect(twin.length).toBeLessThan(canonical.length);
    expect(twin.length).toBeGreaterThan(canonical.length / 10);
  });

  test('without agentOutDir nothing changes: no key, no twins', () => {
    const plain = mkdtempSync(join(tmpdir(), 'agent-md-off-'));
    try {
      generateDocs({ modules: ['constructs'] }, { outDir: plain, packageRoot: ROOT, languages: ['ts'] });
      const page = readFileSync(join(plain, 'docs', 'constructs.Node.md'), 'utf-8');
      expect(page).not.toContain('agentMarkdown');
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('agentMarkdownHref', () => {
  test('mirrors the hosted path under the site base', () => {
    expect(agentMarkdownHref('/v2/docs/aws-cdk-lib.aws_s3.Bucket.md', '/'))
      .toBe('/v2/docs/aws-cdk-lib.aws_s3.Bucket.md');
    expect(agentMarkdownHref('/v2/docs/aws-cdk-lib.aws_s3.Bucket.md', '/cdk/api/')).toBe(
      '/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.md',
    );
    expect(agentMarkdownHref('/v2/docs/x.md', '/cdk/api')).toBe('/cdk/api/v2/docs/x.md');
  });
});

describe('merge-shards overlays the twins once, after the shards', () => {
  test('--agent-markdown copies the tree into the merged site and reports the count', () => {
    const work = mkdtempSync(join(tmpdir(), 'agent-md-merge-'));
    try {
      const shard = join(work, 'shard-0');
      mkdirSync(join(shard, 'v2', 'docs'), { recursive: true });
      writeFileSync(join(shard, 'index.html'), '<html></html>');
      writeFileSync(join(shard, 'v2', 'docs', 'pkg.Type.html'), '<html></html>');
      writeFileSync(join(shard, 'hashmap.json'), '{"a":"1"}');
      const agent = join(work, 'agent');
      mkdirSync(join(agent, 'v2', 'docs'), { recursive: true });
      writeFileSync(join(agent, 'v2', 'docs', 'pkg.Type.md'), '# Type\n');
      const out = join(work, 'docs', '.vitepress', 'dist');

      const log = execFileSync(
        'node',
        [join(ROOT, 'scripts', 'merge-shards.cjs'), out, '--agent-markdown', agent, shard],
        { encoding: 'utf-8', cwd: work },
      );

      expect(readFileSync(join(out, 'v2', 'docs', 'pkg.Type.md'), 'utf-8')).toBe('# Type\n');
      const rootTwin = readFileSync(join(out, 'index.md'), 'utf-8');
      expect(rootTwin).toContain('# AWS CDK API Reference');
      expect(rootTwin).toContain('## What is the AWS CDK');
      expect(rootTwin).toContain('## Getting started');
      expect(rootTwin).not.toContain('layout: home');
      expect(existsSync(join(out, 'v2', 'docs', 'pkg.Type.html'))).toBe(true);
      expect(JSON.parse(readFileSync(join(out, 'hashmap.json'), 'utf-8'))).toEqual({ a: '1' });
      expect(log).toContain('1 HTML pages'.replace('1 HTML', '2 HTML'));
      expect(log).toContain('2 Markdown twins');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test('a symbolic-link entry is refused instead of copied', () => {
    const work = mkdtempSync(join(tmpdir(), 'agent-md-symlink-'));
    try {
      const agent = join(work, 'agent');
      mkdirSync(join(agent, 'v2', 'docs'), { recursive: true });
      const target = join(work, 'outside.md');
      writeFileSync(target, '# Outside\n');
      symlinkSync(target, join(agent, 'v2', 'docs', 'linked.md'));

      mkdirSync(join(work, 'site'));
      expect(() => execFileSync(
        'node',
        [join(ROOT, 'scripts', 'agent-markdown-overlay.cjs'), agent, join(work, 'site')],
        { encoding: 'utf-8', cwd: work, stdio: 'pipe' },
      )).toThrow(/agent markdown overlay refuses symbolic link/);
      expect(existsSync(join(work, 'site', 'v2', 'docs', 'linked.md'))).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test('the twins never enter a VitePress build: the tree lives outside docs/ and is gitignored', () => {
    const cli = readFileSync(join(ROOT, 'src', 'docgen', 'cli.ts'), 'utf-8');
    expect(cli).toMatch(/agentOutDir: path\.join\(root, 'dist-agent-markdown'\)/);
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf-8')).toContain('dist-agent-markdown/');
    // The local sharded build overlays the twins itself; a single-shard run (one CI matrix leg, whose dist is a
    // shard artifact) does not, so the twins travel once, in their own artifact.
    const shardBuild = readFileSync(join(ROOT, 'scripts', 'local-shard-build.sh'), 'utf-8');
    expect(shardBuild).toContain('[ -n "$SINGLE" ] || AGENT_MARKDOWN=(--agent-markdown dist-agent-markdown)');
    expect(shardBuild).toContain('"${AGENT_MARKDOWN[@]}" "${MERGE_SOURCES[@]}"');
    // shard-prune only ever touches docs/; the agent tree is not under it.
    expect(readFileSync(join(ROOT, 'scripts', 'shard-prune.cjs'), 'utf-8')).not.toContain('agent');
  });
});

describe('the page advertises its twin only when one exists', () => {
  const footer = readFileSync(join(ROOT, 'docs', '.vitepress', 'theme', 'PageFooterLinks.vue'), 'utf-8');
  const config = readFileSync(join(ROOT, 'docs', '.vitepress', 'config.mts'), 'utf-8');

  test('the footer link is gated on the frontmatter key and downloads the .md twin', () => {
    expect(footer).toContain('frontmatter?.agentMarkdown');
    expect(footer).toMatch(/<template v-if="markdownUrl">[\s\S]*Download as Markdown/);
    expect(footer).toContain(':href="markdownUrl" download type="text/markdown"');
  });

  test('the head carries the llms.txt-style alternate link, from the same key', () => {
    expect(config).toContain('transformHead');
    expect(config).toContain('rel: "alternate", type: "text/markdown"');
    expect(config).toContain('pageData.frontmatter.agentMarkdown');
  });

  test('the head carries the site index as a text/plain alternate on every page, unconditionally', () => {
    // The twin link is gated on the page having a twin; the index link is not, since the index exists whenever the
    // twins do and is the file an agent that landed anywhere should be able to start from.
    expect(config).toMatch(/head\.push\(\["link", \{ rel: "alternate", type: "text\/plain", href: agentMarkdownHref\("llms\.txt"/);
    const guarded = config.indexOf('if (typeof twin === "string")');
    expect(config.indexOf('type: "text/plain"')).toBeLessThan(guarded);
  });
});
