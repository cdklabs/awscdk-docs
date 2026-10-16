/**
 * When a page was last revised, as the footer and the `<head>` metas state it. Browser-safe: pure functions, no node
 * imports, shared by docgen, the VitePress config and the theme.
 */

/**
 * The day the documentation itself was last broadly improved. Bump this to re-date every page — use it when the
 * documentation itself has been broadly improved, not for a release: type and README changes date themselves from
 * the version-history ledger.
 */
export const CONTENT_REVISED_DATE = '2026-09-11';

/** Frontmatter keys docgen writes per page; the config lifts them into `cdk-docs-*` head metas. */
export const HISTORY_FRONTMATTER = {
  introducedIn: 'cdkDocsIntroducedIn',
  lastChangedIn: 'cdkDocsLastChangedIn',
  lastChangedAt: 'cdkDocsLastChangedAt',
} as const;

/** `<head>` meta names, one per frontmatter key, plus the revised date every page carries. */
export const HISTORY_META = {
  introducedIn: 'cdk-docs-introduced-in',
  lastChangedIn: 'cdk-docs-last-changed-in',
  lastChangedAt: 'cdk-docs-last-changed-at',
  contentRevised: 'cdk-docs-content-revised',
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date-only text for an ISO timestamp, in UTC, e.g. `3 Mar 2025`; the same on every machine and in SSR. */
export function formatDateOnly(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface ContentRevised {
  /** ISO timestamp of the later event: the constant, or the ledger's change. */
  readonly at: string;
  /** The release that revised the page — present only when the ledger's date wins over the constant. */
  readonly version?: string;
}

/**
 * The footer's date: the later of the site-wide revision and the page's own last change. A broad documentation
 * revision genuinely revised every page, so the constant may raise a page's date but never carries a version.
 */
export function contentRevised(history: { lastChangedIn?: string; lastChangedAt?: string }): ContentRevised {
  const constant = `${CONTENT_REVISED_DATE}T00:00:00.000Z`;
  if (history.lastChangedAt && history.lastChangedIn && Date.parse(history.lastChangedAt) > Date.parse(constant)) {
    return { at: history.lastChangedAt, version: history.lastChangedIn };
  }
  return { at: constant };
}
