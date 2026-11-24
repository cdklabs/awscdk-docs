import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolves the home page's `lucide:<name>` feature icon tokens into inline SVG strings at build time.
// The resolved value must stay a STRING: VPFeature routes an object icon to VPImage, which wants `src`,
// and only a string reaches the `v-html` branch that inlines markup.
const LUCIDE_ICON_DIR = resolve(import.meta.dirname, "../../node_modules/lucide-static/icons");
const cache = new Map<string, string>();

/** Resolves a `lucide:<name>` token to the treated inline SVG string. Throws on an unknown token. */
export function resolveLucideIcon(token: string): string {
  const cached = cache.get(token);
  if (cached) {
    return cached;
  }
  const name = token.slice("lucide:".length);
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`Malformed home page feature icon token "${token}"`);
  }
  let src: string;
  try {
    src = readFileSync(resolve(LUCIDE_ICON_DIR, `${name}.svg`), "utf-8");
  } catch (e) {
    throw new Error(`Unknown home page feature icon "${token}": lucide-static ships no ${name}.svg`);
  }
  const open = src.indexOf(">", src.indexOf("<svg")) + 1;
  const geometry = src.slice(open, src.lastIndexOf("</svg>")).replace(/\s+/g, " ").trim();
  if (!geometry) {
    throw new Error(`Home page feature icon "${token}" resolved to empty geometry`);
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ` stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${geometry}</svg>`;
  cache.set(token, svg);
  return svg;
}
