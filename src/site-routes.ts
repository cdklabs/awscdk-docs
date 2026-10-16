/**
 * Site-root-relative route constants, shared by docgen (which emits links) and
 * the theme client code (which parses and builds them). Browser-safe by design:
 * constants only, no node imports, no environment reads.
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
