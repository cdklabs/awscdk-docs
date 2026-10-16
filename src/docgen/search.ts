import { escapeAttr } from './escape.js';

/**
 * Pagefind search markup helpers.
 *
 * The Pagefind plugin marks the whole rendered article as
 * `data-pagefind-body`, so every property type cell, signature, facts
 * table, and cross-reference list is indexed as body text. A search for
 * `bucket` then matches thousands of pages that merely *mention* a
 * bucket in a `bucket: IBucket` type cell. These helpers let the page
 * emitters exclude that generated boilerplate from the index
 * (`data-pagefind-ignore`) and attach `module:`/`kind:` filters so
 * queries can be scoped (e.g. `bucket module:aws-s3 kind:construct`).
 */

/** Attribute excluding an element (and its subtree) from the Pagefind index. */
export const PAGEFIND_IGNORE = 'data-pagefind-ignore';

/**
 * Wrap markdown lines in a `data-pagefind-ignore` container so Pagefind
 * skips them. The blank lines around the content keep markdown-it
 * parsing the inner lines as markdown (same pattern as the expandable
 * props rows in layout.ts).
 */
export function ignoreBlock(lines: string[]): string[] {
  return [`<div ${PAGEFIND_IGNORE}>`, '', ...lines, '', '</div>', ''];
}

/**
 * Wrap a page's symbol name for its H1 so Pagefind ranks an exact
 * title match (`aws-s3.Bucket` for `bucket`) above pages that merely
 * mention the term in prose. Pagefind weights h1 text 7.0 by default;
 * 10 keeps the title decisively ahead once boilerplate is ignored.
 * VitePress strips inline HTML when inferring the page title (the H1s
 * already carry a `<Badge>`), so the span never leaks into titles.
 */
export function weightedTitle(name: string): string {
  return `<span data-pagefind-weight="10">${name}</span>`;
}

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
 * Hidden elements carrying explicit-value Pagefind filters. Emitted
 * inside the indexed body; invisible in the rendered page.
 */
export function searchFilterHtml(filters: Record<string, string>): string {
  return Object.entries(filters)
    .map(([key, value]) => `<span hidden data-pagefind-filter="${escapeAttr(`${key}:${value}`)}"></span>`)
    .join('');
}
