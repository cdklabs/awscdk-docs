// The public URL of a rendered page: the JSON-LD node's `url`, the canonical link, and VitePress's sitemap all
// resolve a route this way. No VitePress imports, so Jest can call it directly.

/** Absolute URL of a rendered page. Builds run with cleanUrls off, so every route but the home page ends in `.html`. */
export function pageUrl(relativePath: string, siteUrl: string): string {
  const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  const route = relativePath.replace(/(?:index)?\.md$/, (match) => (match === "index.md" ? "" : ".html"));
  return new URL(route, base).href;
}
