import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolves the home page's `lucide:<name>` feature icon tokens into inline SVG strings at build time.
// The resolved value must stay a STRING: VPFeature routes an object icon to VPImage, which wants `src`,
// and only a string reaches the `v-html` branch that inlines markup.
const LUCIDE_ICON_DIR = resolve(import.meta.dirname, "../../node_modules/lucide-static/icons");
const cache = new Map<string, string>();

// lucide-static 1.x redrew book-open; its earlier geometry is pinned here to keep the home page unchanged.
const PINNED_GEOMETRY: Record<string, string> = {
  "book-open":
    '<path d="M12 7v14" /> <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1' +
    ' 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />',
};

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
  const geometry = PINNED_GEOMETRY[name] ?? readGeometry(token, name);
  if (!geometry) {
    throw new Error(`Home page feature icon "${token}" resolved to empty geometry`);
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ` stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${geometry}</svg>`;
  cache.set(token, svg);
  return svg;
}

/** The shape elements of a lucide-static icon file, whitespace-collapsed. */
function readGeometry(token: string, name: string): string {
  let src: string;
  try {
    src = readFileSync(resolve(LUCIDE_ICON_DIR, `${name}.svg`), "utf-8");
  } catch (e) {
    throw new Error(`Unknown home page feature icon "${token}": lucide-static ships no ${name}.svg`);
  }
  const open = src.indexOf(">", src.indexOf("<svg")) + 1;
  return src.slice(open, src.lastIndexOf("</svg>")).replace(/\s+/g, " ").trim();
}
