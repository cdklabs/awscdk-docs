// Pure helpers for a page's version history: the `cdk-docs-*` head metas the config emits and the footer's revised
// line the theme renders. No VitePress imports, so Jest can test both directly.

import { contentRevised, formatDateOnly, HISTORY_FRONTMATTER, HISTORY_META } from "../../src/page-history";

type Frontmatter = Record<string, unknown>;

/** The three recorded values, read back from the frontmatter docgen wrote; anything not a string is unknown. */
export function pageHistoryOf(frontmatter: Frontmatter): {
  introducedIn?: string;
  lastChangedIn?: string;
  lastChangedAt?: string;
} {
  const pick = (key: string): string | undefined => {
    const value = frontmatter[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const introducedIn = pick(HISTORY_FRONTMATTER.introducedIn);
  const lastChangedIn = pick(HISTORY_FRONTMATTER.lastChangedIn);
  const lastChangedAt = pick(HISTORY_FRONTMATTER.lastChangedAt);
  return {
    ...(introducedIn ? { introducedIn } : {}),
    ...(lastChangedIn && lastChangedAt ? { lastChangedIn, lastChangedAt } : {}),
  };
}

/**
 * `<meta>` entries for a page's history: one per recorded value, never an empty one, plus the revised date every
 * page carries. Shaped as VitePress `HeadConfig` tuples.
 */
export function historyHead(frontmatter: Frontmatter): [string, Record<string, string>][] {
  const history = pageHistoryOf(frontmatter);
  const head: [string, Record<string, string>][] = [];
  if (history.introducedIn) {
    head.push(["meta", { name: HISTORY_META.introducedIn, content: history.introducedIn }]);
  }
  if (history.lastChangedIn && history.lastChangedAt) {
    head.push(["meta", { name: HISTORY_META.lastChangedIn, content: history.lastChangedIn }]);
    head.push(["meta", { name: HISTORY_META.lastChangedAt, content: history.lastChangedAt }]);
  }
  head.push(["meta", { name: HISTORY_META.contentRevised, content: contentRevised(history).at }]);
  return head;
}

/** The footer's line: `Content revised 3 Mar 2025`, with ` · v2.150.0` when the page's own change set the date. */
export function contentRevisedText(frontmatter: Frontmatter): string {
  const revised = contentRevised(pageHistoryOf(frontmatter));
  return `Content revised ${formatDateOnly(revised.at)}${revised.version ? ` · v${revised.version}` : ""}`;
}
