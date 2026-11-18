/**
 * Site-root-relative route constants, shared by docgen (which emits links) and
 * the theme client code (which parses and builds them). Browser-safe by design:
 * constants and pure string helpers only, no node imports, no environment reads.
 *
 * The site is hosted at docs.aws.amazon.com/cdk/api/, so the hosting base
 * completes the historical URLs: `/v2/docs/…` serves at `/cdk/api/v2/docs/…`.
 */

/** Root of the generated API reference; its index is the API overview page. */
export const API_ROOT = '/v2/';

/** The site's title, as the navbar shows it and as `llms.txt` names the index. */
export const SITE_TITLE = 'AWS CDK Reference';

/** Prefix of every generated type/README page (`/v2/docs/<docId>….html`). */
export const API_DOCS_ROOT = `${API_ROOT}docs/`;

/** The versions page route (`.html` under cleanUrls-off builds). */
export const VERSIONS_ROUTE = '/versions';

/** The API stability guide: what `stable` and `experimental` mean for a consumer. */
export const STABILITY_ROUTE = '/stability';

/**
 * Public-dir-relative path of the machine-readable versions endpoint — the
 * versions page route with the extension swapped, served beside it.
 */
export const VERSIONS_JSON_PATH = `${VERSIONS_ROUTE.slice(1)}.json`;

/**
 * The file a stored page link is served from: the link's path with `.html`
 * appended, which is what VitePress emits for the equivalent markdown link
 * under `cleanUrls: false`. A query or fragment stays after the suffix.
 * Directory-style paths (trailing `/`, or empty) and paths that already name
 * their file pass through unchanged. The static host serves `404.html` for an
 * extensionless path, so every raw anchor built from a stored link must point
 * at the file. Page links only: an asset path (`versions.json`) is not a page
 * link and never goes through here.
 */
export function pageFile(link: string): string {
  const cut = link.search(/[?#]/);
  const path = cut === -1 ? link : link.slice(0, cut);
  const rest = cut === -1 ? '' : link.slice(cut);
  const file = path === '' || path.endsWith('/') || path.endsWith('.html') ? path : `${path}.html`;
  return `${file}${rest}`;
}
