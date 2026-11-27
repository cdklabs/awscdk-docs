import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { pageSourceExcludes } from '../docs/.vitepress/page-url.js';
import { contentRevised } from '../src/page-history.js';

const DOCS = resolve(import.meta.dirname, '..', 'docs');

/** Every `.md` file under `dir`, relative to it, sorted. */
function markdownFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const entryRel = rel ? join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      out.push(...markdownFiles(dir, entryRel));
    } else if (entry.name.endsWith('.md')) {
      out.push(entryRel);
    }
  }
  return out.sort();
}

/** The handwritten pages the deployed shard build renders: not generated (`v2/`) and not excluded by `srcExclude`. */
function handwrittenPages(): string[] {
  const excluded = ['.vitepress/', 'v2/', ...pageSourceExcludes(true).map((pattern) => pattern.replace(/\*\*$/, ''))];
  return markdownFiles(DOCS).filter((file) => !excluded.some((prefix) => file.startsWith(prefix)));
}

describe('handwritten page dates', () => {
  // Reads the sources, not a build: the date only feeds the Pagefind meta, and building every page here is too slow.
  test.each(handwrittenPages())('%s carries the content-revised date its footer and JSON-LD show', (file) => {
    const source = readFileSync(join(DOCS, file), 'utf-8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1] ?? '';

    expect(/^date: "([^"]+)"$/m.exec(frontmatter)?.[1]).toBe(contentRevised({}).at);
  });

  test('finds the handwritten pages', () => {
    expect(handwrittenPages()).toEqual(expect.arrayContaining(['index.md', 'versions.md']));
  });
});
