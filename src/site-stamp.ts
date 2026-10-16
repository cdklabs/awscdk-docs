/**
 * The build stamp: the documented aws-cdk-lib version and the docs' generated-at timestamp, written into every
 * page's `<head>` between two sentinel comments and read back by the theme at runtime. Rewriting the stamp changes
 * both the machine-readable values and what the reader sees.
 *
 * Browser-safe: pure string and DOM-query functions, no node imports, no environment reads.
 */

import { escapeAttr } from './docgen/escape.js';

/** Opening sentinel of the stamp block. */
export const STAMP_BEGIN = '<!--CDK_DOCS_STAMP_BEGIN-->';

/** Closing sentinel of the stamp block. */
export const STAMP_END = '<!--CDK_DOCS_STAMP_END-->';

/** `name` of the meta carrying the documented aws-cdk-lib version. */
export const STAMP_VERSION_META = 'cdk-docs-version';

/** `name` of the meta carrying the ISO-8601 timestamp the docs were generated at. */
export const STAMP_GENERATED_AT_META = 'cdk-docs-generated-at';

export interface SiteStamp {
  /** Documented aws-cdk-lib version, without a `v` prefix. Empty when the build had no aws-cdk-lib installed. */
  readonly version: string;
  /** ISO-8601 timestamp the docs were generated at. */
  readonly generatedAt: string;
}

function metaTag(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeAttr(content)}">`;
}

/**
 * The stamp block for one page. Values are attribute-escaped, so none can terminate its attribute or close the
 * sentinel comment early.
 */
export function renderSiteStamp(stamp: SiteStamp): string {
  return [
    STAMP_BEGIN,
    metaTag(STAMP_VERSION_META, stamp.version),
    metaTag(STAMP_GENERATED_AT_META, stamp.generatedAt),
    STAMP_END,
  ].join('\n');
}

/**
 * Insert the stamp at the end of a rendered page's `<head>`, or at the top of a page without one. Stamping an
 * already-stamped page is a no-op: two blocks would leave a downstream replacement with no single target.
 */
export function injectSiteStamp(html: string, stamp: SiteStamp): string {
  if (html.includes(STAMP_BEGIN)) {
    return html;
  }
  const block = `${renderSiteStamp(stamp)}\n`;
  const headEnd = html.indexOf('</head>');
  return headEnd < 0
    ? `${block}${html}`
    : `${html.slice(0, headEnd)}${block}${html.slice(headEnd)}`;
}

/** The part of the DOM the readers need, so they are callable with a stub in tests. */
export interface StampSource {
  querySelector(selectors: string): { getAttribute(name: string): string | null } | null;
}

/**
 * Read one stamped value. `undefined` means the page carries no such meta, i.e. it was rendered without the stamp
 * (SSR, or the dev server), and the caller should fall back to its build-time value. An empty string is a stamped
 * value and must not trigger that fallback.
 */
export function readSiteStampValue(source: StampSource, metaName: string): string | undefined {
  const content = source.querySelector(`meta[name="${metaName}"]`)?.getAttribute('content');
  return content === null || content === undefined ? undefined : content.trim();
}

/** The stamped aws-cdk-lib version, or `undefined` on an unstamped page. */
export function stampVersion(source: StampSource): string | undefined {
  return readSiteStampValue(source, STAMP_VERSION_META);
}

/** The stamped generated-at timestamp, or `undefined` on an unstamped page. */
export function stampGeneratedAt(source: StampSource): string | undefined {
  return readSiteStampValue(source, STAMP_GENERATED_AT_META);
}
