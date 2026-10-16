/**
 * Canonical href builder for cross-reference anchors emitted as raw HTML.
 *
 * VitePress rewrites *markdown* links — applying the site `base` and
 * resolving the page to its `.html` file — but leaves raw HTML in
 * markdown untouched. Anchors emitted as HTML (signature type links,
 * inheritance-chain breadcrumbs) therefore bypass that rewriting, and an
 * href missing the base path 404s whenever the site is served from a
 * sub-path (e.g. a GitHub Pages project site). Every raw HTML anchor must
 * build its final href through {@link pageHref}.
 */
import { API_ROOT } from '../site-routes.js';

/** A URL path prefix: `/`, or `/`-delimited segments of unreserved URL characters, none `.` or `..`. */
const BASE_PATTERN = /^\/(?:(?!\.\.?\/)[A-Za-z0-9._~-]+\/)*$/;

/**
 * Site base path, mirroring `docs/.vitepress/config.mts`
 * (`process.env.DOCS_BASE ?? '/'`). Docgen always runs in the same task
 * chain (`docs:dev`/`docs:build`/`docs:build:shard` all spawn
 * `docs:generate`), so the same environment variable is visible to both.
 * Normalized to have exactly one leading and one trailing slash.
 */
export function siteBase(): string {
  const raw = process.env.DOCS_BASE ?? '/';
  let base = raw.startsWith('/') ? raw : `/${raw}`;
  if (!base.endsWith('/')) {
    base = `${base}/`;
  }
  if (!BASE_PATTERN.test(base)) {
    throw new Error(`DOCS_BASE must be a URL path prefix such as /cdk/api/, got ${JSON.stringify(raw)}`);
  }
  return base;
}

/**
 * Canonical URL scheme of the generated API reference. The site is hosted
 * at docs.aws.amazon.com/cdk/api/, and routes are site-root-relative, so
 * the hosting base completes the historical URLs and deep links bookmarked
 * against docs.aws.amazon.com/cdk/api/v2 answer with a real page:
 *
 *   - API reference root:  `/v2/`
 *   - Type page:           `/v2/docs/<docId>.<submodule>.<Type>.html`
 *   - (Sub)module README:  `/v2/docs/<docId>[.<submodule>]-readme.html`
 *
 * `<docId>` is the npm package name with `/` flattened to `_`
 * (`@aws-cdk/aws-amplify-alpha` -> `@aws-cdk_aws-amplify-alpha`), the
 * convention the TypeDoc-generated reference used. Submodule names are
 * jsii submodule identifiers (`aws_s3`) and pass through verbatim — TS
 * identifiers cannot contain the characters that would need escaping.
 */

/**
 * Site-root-relative prefix for every generated page link
 * (`/v2/docs/…`). The root `/v2/` serves the API overview page.
 * Canonically defined in src/site-routes.ts, shared with the theme.
 */
export { API_ROOT } from '../site-routes.js';

/**
 * Flatten an npm package name into the old reference's document id:
 * `/` becomes `_`, everything else (including a leading `@`) verbatim.
 */
export function assemblyDocId(assemblyName: string): string {
  return assemblyName.replace(/\//g, '_');
}

/**
 * Site-root-relative link to a type's dedicated page (no `.html` —
 * markdown links get the suffix from VitePress; raw-HTML anchors go
 * through {@link pageHref}). `typeName` may be dotted for nested types
 * (`CfnBucket.PolicyProperty`), matching the historical shape.
 */
export function typePageLink(assemblyName: string, submodule: string, typeName: string): string {
  const id = [assemblyDocId(assemblyName), ...(submodule ? [submodule] : []), typeName].join('.');
  return `${API_ROOT}docs/${id}`;
}

/**
 * Site-root-relative link to a package or submodule overview page
 * (`…-readme`, the historical shape). No `.html` suffix — see
 * {@link typePageLink}.
 */
export function moduleReadmeLink(assemblyName: string, submodule?: string): string {
  const id = assemblyDocId(assemblyName) + (submodule ? `.${submodule}` : '');
  return `${API_ROOT}docs/${id}-readme`;
}

/** A page link is a path: no scheme, no `//` authority, no backslash, query, fragment or whitespace. */
const SITE_RELATIVE_LINK = /^(?!\/\/)(?![a-zA-Z][\w+.-]*:)[^\s?#\\]*$/;

/**
 * Convert a site-root-relative page link (`/v2/docs/<docId>…`, the
 * convention `groupTypes` generates pages under) into a
 * final anchor-ready href: the site base is prefixed and the `.html`
 * suffix appended — exactly what VitePress produces for the equivalent
 * markdown link. Directory-style links (trailing `/`) only get the base.
 */
export function pageHref(link: string): string {
  if (!SITE_RELATIVE_LINK.test(link)) {
    throw new Error(`pageHref: not a site-relative page link: ${JSON.stringify(link)}`);
  }
  const path = link.replace(/^\//, '');
  const suffixed = path === '' || path.endsWith('/') ? path : `${path}.html`;
  return `${siteBase()}${suffixed}`;
}
