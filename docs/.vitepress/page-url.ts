// The public URL of a rendered page: the JSON-LD node's `url` and the canonical link resolve a route this way, and
// VitePress's sitemap uses an equivalent rule of its own. No VitePress imports, so Jest can call it directly.
import { pageFile } from "../../src/site-routes";

/**
 * Absolute URL of a rendered page. A source path's `.md` comes off and a directory index becomes its directory;
 * the `.html` the route then needs (builds run with cleanUrls off) comes from the shared `pageFile()` rule.
 */
export function pageUrl(relativePath: string, siteUrl: string): string {
  const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  const route = pageFile(relativePath.replace(/(?:^|(?<=\/))index\.md$/, "").replace(/\.md$/, ""));
  return new URL(route, base).href;
}

// Which authored `docs/` sources become pages, and at which route. The VitePress config and the agent Markdown
// pipeline test both read these, so a twin link is checked against the pages the site really serves.

/**
 * `srcExclude` patterns. ADRs never render. The spike proof pages render only outside the deployed shard build,
 * because the e2e fixture build still needs them.
 */
export function pageSourceExcludes(shardBuild: boolean): string[] {
  return ["adr/**", ...(shardBuild ? ["spike/**"] : [])];
}

/** Sources served at a different route than their file path. */
export const PAGE_REWRITES: Record<string, string> = {
  // The authored construct-library overview keeps its historical address inside the generated /v2/docs/ tree.
  "aws-construct-library.md": "v2/docs/aws-construct-library.md",
};
