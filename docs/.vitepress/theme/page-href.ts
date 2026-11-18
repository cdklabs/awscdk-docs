// Final href for a raw anchor the theme renders from a STORED page link.
//
// Sidebar nodes, favorites and the symbol index store links without `.html`
// (`typePageLink` / `moduleReadmeLink` in src/docgen/links.ts). The host
// answers an extensionless path with `404.html`, so an anchor opened in a
// fresh tab (middle-click, "open in new tab", a copied link) must name the
// file. Every anchor built from a stored link goes through here, the way
// docgen's `pageHref()` serves the HTML it emits.
import { withBase } from "vitepress";
import { pageFile } from "../../../src/site-routes";

/** Base-prefixed, `.html`-suffixed href for a site-root-relative page link. */
export function pageHref(link: string): string {
  return withBase(pageFile(link));
}
