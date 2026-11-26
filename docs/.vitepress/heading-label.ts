// Clean accessible permalink labels for multi-language member headings and type-page titles. VitePress derives
// each anchor's `aria-label` from the heading token's raw `content`, which for a docgen member heading is
// variant-span markup plus the `{#…}` pin. Rewriting `content` to the canonical (first-span, TypeScript) member
// name before markdown-it-anchor runs restores a clean label. Safe because rendering, outline, and slug
// derivation all read the token's `children`; the raw `content` string's only remaining consumer is the aria-label.
//
// Its own module, like `type-links`, so a unit test can feed it each heading shape directly.
const LANG_VARIANT_SPAN = /^<span class="lang-variant"[^>]*>(.*?)<\/span>/;
// A type page's H1 source is the weighted name span (with `<wbr>` break points), optionally wrapped in the
// deprecated-title span, plus the `{#…}` pin and any `Added in` badge; its label is the plain type name. The
// wrapper prefix is non-capturing, so group 1 stays the name. Any weight matches, so retuning it in
// weightedTitle() keeps working.
const WEIGHTED_TITLE_SPAN =
  /^(?:<span class="type-title-deprecated">)?<span data-pagefind-weight="[\d.]+">(.*?)<\/span>/;

/** The plain text a heading's permalink should announce, or undefined for a heading that needs no cleaning. */
export function cleanHeadingLabel(source: string): string | undefined {
  const title = WEIGHTED_TITLE_SPAN.exec(source)?.[1];
  const canonical = title?.replace(/<wbr>/g, "") ?? LANG_VARIANT_SPAN.exec(source)?.[1];
  if (canonical === undefined) {
    return undefined; // not a docgen title or variant heading — leave untouched
  }
  // Drop any trailing markup after the spans and the `{#…}` pin; unescape docgen's escapeHtml entities.
  return canonical
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}
