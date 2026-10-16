// The per-page canonical link the config emits. No VitePress imports, so Jest can test the produced tuple directly.

import { pageUrl } from "./page-url";

/**
 * The `<link rel="canonical">` for a rendered page, as a VitePress head tuple. The href is the `pageUrl` of the
 * page, which is also what the sitemap's `<loc>` and the JSON-LD `url` carry, and holds no `?lang=` query.
 */
export function canonicalHead(relativePath: string, siteUrl: string): [string, Record<string, string>] {
  return ["link", { rel: "canonical", href: pageUrl(relativePath, siteUrl) }];
}
