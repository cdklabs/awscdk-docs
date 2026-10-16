import type { HeadConfig } from "vitepress";

/** File name of the downstream override stylesheet, served unhashed at `<base>site-overrides.css`. */
export const SITE_OVERRIDES_FILE = "site-overrides.css";

/** Served path of the override stylesheet under the site base. */
export function siteOverridesHref(base: string): string {
  return `${base}${SITE_OVERRIDES_FILE}`;
}

/** The `<head>` entry linking the override stylesheet. */
export function siteOverridesHead(base: string): HeadConfig {
  return ["link", { rel: "stylesheet", href: siteOverridesHref(base) }];
}
