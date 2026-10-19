/**
 * Site search index.
 *
 * Search runs entirely in the browser with MiniSearch, a plain JavaScript engine, over one static JSON asset
 * docgen writes at build time. Every API page contributes one entry — its title, coarse kind, module slug, link
 * and one-paragraph summary — so the asset stays a few megabytes for the whole reference while still answering
 * "which pages are *about* this term". Full page bodies are deliberately not indexed: type cells, signatures and
 * cross-reference lists would make `bucket` match thousands of pages that merely mention a bucket.
 *
 * The `kind:` / `module:` query tokens the theme parses out of the search box filter on the `kind` and `module`
 * fields below, e.g. `bucket module:aws-s3 kind:construct`.
 */
export interface SearchIndexEntry {
  /** Site-absolute link of the page. */
  readonly link: string;
  /** Page title: the type name, or the module/submodule id for an overview page. */
  readonly title: string;
  /**
   * Coarse, lowercase kind for the `kind:` token: construct | class | struct | interface | enum | mixin | facade |
   * trait, or `module` for an overview page.
   */
  readonly kind: string;
  /** Module slug for the `module:` token, lowercase with hyphens (`aws-s3`, `constructs`). */
  readonly module: string;
  /** Plain-text one-paragraph summary, truncated for the asset. */
  readonly summary: string;
}

/** Kind value overview pages carry in the index. */
export const MODULE_KIND = 'module';

/** Longest summary stored per entry; the asset ships to every reader, so prose beyond this is cut. */
export const SUMMARY_MAX_CHARS = 240;

/**
 * Coarse, lowercase symbol kind for the `kind:` search filter.
 * Collapses construct levels (`Construct (L2)` -> `construct`) so users
 * filter on a small, predictable vocabulary:
 * construct | class | struct | interface | enum | mixin | facade | trait.
 */
export function searchKind(kind: string): string {
  return kind.toLowerCase().split(' ')[0].replace(/[^a-z]/g, '');
}

/**
 * Module value for the `module:` search filter: the submodule slug when
 * the type lives in one (`aws_s3` -> `aws-s3`), else the assembly slug.
 * Lowercase with hyphens, matching what users see in URLs.
 */
export function searchModule(assemblyName: string, submodule: string): string {
  const source = submodule || assemblyName;
  return source.toLowerCase().replace(/^@/, '').replace(/[/_]/g, '-');
}

/**
 * Plain-text summary for the index: the first paragraph of a markdown body with inline HTML, markdown emphasis,
 * links and code spans reduced to their text, whitespace collapsed, and the result truncated to
 * {@link SUMMARY_MAX_CHARS} on a word boundary.
 */
export function searchSummary(markdown: string | undefined): string {
  if (!markdown) {
    return '';
  }
  const paragraph = markdown.trim().split(/\n\s*\n/)[0] ?? '';
  const text = paragraph
    .replace(/<[^>]+>/g, '')
    .replace(/^#+\s+/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= SUMMARY_MAX_CHARS) {
    return text;
  }
  const cut = text.slice(0, SUMMARY_MAX_CHARS);
  const atWord = cut.lastIndexOf(' ');
  return `${atWord > SUMMARY_MAX_CHARS / 2 ? cut.slice(0, atWord) : cut}…`;
}

/**
 * Finished index: one entry per link, sorted by link so the asset's content hash is stable across runs that emit
 * the same pages in a different order.
 */
export function buildSearchIndex(entries: Iterable<SearchIndexEntry>): SearchIndexEntry[] {
  const byLink = new Map<string, SearchIndexEntry>();
  for (const entry of entries) {
    byLink.set(entry.link, entry);
  }
  return [...byLink.values()].sort((a, b) => a.link.localeCompare(b.link));
}
