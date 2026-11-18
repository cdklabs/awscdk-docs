// Final href for a theme anchor or router target that names a site page.
//
// Sidebar nodes, favorites and the symbol index store links without `.html`
// (`typePageLink` / `moduleReadmeLink` in src/docgen/links.ts), and the route
// constants in src/site-routes.ts have no suffix either. The host answers an
// extensionless path with `404.html`, so an anchor opened in a fresh tab
// (middle-click, "open in new tab", a copied link) must name the file. Every
// theme anchor or router target built from a stored link or a route constant
// goes through here, the way docgen's `pageHref()` serves the HTML it emits.
import { withBase } from "vitepress";
import { pageFile } from "../../../src/site-routes";

/** Base-prefixed, `.html`-suffixed href for a site-root-relative page link. */
export function pageHref(link: string): string {
  return withBase(pageFile(link));
}
