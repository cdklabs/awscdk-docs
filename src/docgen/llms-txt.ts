/**
 * The site-scoped `llms.txt`: an index an agent can start from, in the shape the llms.txt proposal describes — an
 * H1, a blockquote summary, then link lists of the Markdown documents worth reading first. This site has ~23k pages,
 * so the index lists the module overviews (every `…-readme` page's Markdown twin) and points at `sitemap.xml` for
 * the full page set rather than enumerating it.
 */

/** One module overview the index lists. */
export interface LlmsTxtEntry {
  /** Package name, or `<package>.<submodule>` for a submodule — sorts the list and de-duplicates it. */
  readonly module: string;
  /** Site-root-relative path of the overview's Markdown twin, e.g. `v2/docs/aws-cdk-lib.aws_sns-readme.md`. */
  readonly twin: string;
  /** The overview's own title — its README's H1, or the module name when the README has none. */
  readonly title: string;
}

export interface LlmsTxtInput {
  /** Site title for the H1. */
  readonly siteTitle: string;
  /** Documented library version, named in the summary so a reader knows which release the index describes. */
  readonly version: string;
  /** Absolute site URL, trailing slash optional; links are absolute so the file reads the same wherever fetched. */
  readonly siteUrl: string;
  readonly entries: readonly LlmsTxtEntry[];
}

/** Absolutize a site-root-relative path against the site URL. */
function absolute(siteUrl: string, sitePath: string): string {
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  return new URL(sitePath.replace(/^\/+/, ''), base).href;
}

/**
 * Render the index. Entries are sorted by module name and listed exactly once each, whatever order or duplication
 * the caller passed — the generator records one entry per emitted overview and this is where that becomes a stable
 * file.
 */
export function renderLlmsTxt(input: LlmsTxtInput): string {
  const byModule = new Map<string, LlmsTxtEntry>();
  for (const entry of input.entries) {
    byModule.set(entry.module, entry);
  }
  // Code-point order, not locale order: every shard runner must write the identical file.
  const entries = [...byModule.values()].sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0));
  // The package root sorts first by construction (`aws-cdk-lib` < `aws-cdk-lib.aws_s3`), so the library README
  // heads its own submodules.
  const sitemap = absolute(input.siteUrl, 'sitemap.xml');
  const lines = [
    `# ${input.siteTitle}`,
    '',
    `> API reference for version ${input.version}. Every page has a plain-Markdown twin at the same URL with ` +
      `\`.md\` for \`.html\`; the full page list is in [sitemap.xml](${sitemap}).`,
    '',
    '## Modules',
    '',
    ...entries.map((e) => `- [${e.title}](${absolute(input.siteUrl, e.twin)}): ${e.module}`),
    '',
  ];
  return lines.join('\n');
}

/**
 * The H1 of a rendered page, for the entry title; the fallback is the caller's module name. Inline elements are
 * dropped with their text — a badge on the heading is decoration, not part of the name.
 */
export function titleOf(markdown: string, fallback: string): string {
  const match = /^#\s+(.+?)\s*$/m.exec(markdown);
  if (!match) {
    return fallback;
  }
  const text = match[1]
    .replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}
