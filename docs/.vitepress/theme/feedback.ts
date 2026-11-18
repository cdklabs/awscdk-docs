// Pure helpers for the doc-footer contribution links — "Edit this page" and
// "Report an issue". No Vue/VitePress imports, so Jest tests can
// use them directly.

/** Repository that holds this site's hand-written pages. */
export const REPO_URL = "https://github.com/cdklabs/awscdk-docs";

/** Repository that collects reports about this documentation site. */
export const ISSUES_REPO_URL = REPO_URL;

// Generated API pages live under this docs-relative prefix and are gitignored
// build outputs, so their `filePath` names a file absent from the repository.
// The generated /v2/ overview page lives under the same prefix.
const GENERATED_PREFIX = "v2/";

/** True for generated API pages: build outputs under `v2/` with no markdown file in the repo to edit. */
export function isGeneratedPage(filePath: string): boolean {
  return filePath.startsWith(GENERATED_PREFIX);
}

/**
 * Edit URL for a page, or `undefined` when the page has no editable source (no
 * link is rendered).
 *
 * Hand-written pages link straight to their own markdown. A generated page
 * instead links to the upstream file its prose came from, passed through
 * frontmatter as `upstreamEditUrl`: an overview's `README.md`, or the source
 * file a type page's docstrings are declared in. A generated page with no such
 * file (a list-only overview, an L1 built from generated code) gets no link.
 *
 * `editLink: false` in frontmatter is checked first and suppresses the link
 * outright (such as on the live versions page). Otherwise `upstreamEditUrl`
 * wins over the path rule.
 */
export function editLinkFor(
  filePath: string,
  upstreamEditUrl?: string,
  editLink?: unknown,
): string | undefined {
  if (editLink === false) {
    return undefined;
  }
  if (upstreamEditUrl) {
    return upstreamEditUrl;
  }
  if (isGeneratedPage(filePath)) {
    return undefined;
  }
  return `${REPO_URL}/edit/main/docs/${filePath}`;
}

export interface ReportIssueParams {
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly cdkVersion?: string;
  readonly userAgent?: string;
}

/** GitHub new-issue URL pre-filled with page context. */
export function reportIssueUrl(params: ReportIssueParams): string {
  const title = `Docs: ${params.pageTitle}`;
  const body = [
    "<!-- Describe the problem with this page -->",
    "",
    "---",
    `- Page: ${params.pageUrl}`,
    `- AWS CDK version: ${params.cdkVersion ?? "unknown"}`,
    `- Browser: ${params.userAgent ?? "unknown"}`,
  ].join("\n");
  const query = new URLSearchParams({ title, body, labels: "documentation" });
  return `${ISSUES_REPO_URL}/issues/new?${query}`;
}
