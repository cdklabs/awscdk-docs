// Final href for a raw anchor the theme renders from a STORED page link.
//
// Sidebar nodes, favorites and the symbol index store links without `.html`
// (`typePageLink` / `moduleReadmeLink` in src/docgen/links.ts). VitePress's
// client router adds the suffix when it handles a click, so SPA navigation
// never showed the gap — but a middle-click, a right-click → "open in new
// tab", or a copied link hits the host with the bare path, and the host
// answers with `404.html`. The reader sees a `404` title until the client
// swaps the page in. Every anchor built from a stored link goes through
// here so its `href` names the real file, the way docgen's `pageHref()`
// does for the HTML it emits.
import { withBase } from "vitepress";
import { pageFile } from "../../../src/site-routes";

/** Base-prefixed, `.html`-suffixed href for a site-root-relative page link. */
export function pageHref(link: string): string {
  return withBase(pageFile(link));
}
