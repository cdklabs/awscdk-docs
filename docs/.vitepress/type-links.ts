// Inline type links inside generated signature fences. The fence info line
// carries a `type-links=Name:href,…` attribute; after Shiki highlighting we
// wrap each mapped identifier in an anchor, in text segments only, never inside
// tags. The anchor inherits the surrounding Shiki token color (see signatures.css).
//
// SECURITY: this hook runs on every fence, including third-party jsii README
// fences. Each `Name:href` pair is validated: names must be plain identifiers and
// hrefs must be site-relative paths (no `javascript:` URLs or attribute breakout).
// The href is also HTML-escaped on emission as defense in depth.
export const TYPE_LINKS_RE = /(?:^|\s)type-links=(\S+)/;

// Site-relative path only: a single leading slash (a second slash or a
// backslash would make the target protocol-relative), then path/anchor
// characters. `@` is allowed so @-scoped alpha package pages resolve. Excludes
// `:` (no scheme), quotes, `<`, `>` and whitespace to prevent attribute or tag
// breakout.
const SAFE_HREF = /^\/(?![/\\])[\w\-./#@]*$/;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function applyTypeLinks(html: string, attrs: string | undefined): string {
  const match = attrs ? TYPE_LINKS_RE.exec(attrs) : null;
  if (!match) return html;
  const hrefs = new Map<string, string>();
  for (const pair of match[1].split(",")) {
    const sep = pair.indexOf(":");
    if (sep > 0) hrefs.set(pair.slice(0, sep), pair.slice(sep + 1));
  }
  if (hrefs.size === 0) return html;
  // Drop any name that is not a plain identifier or whose href fails the
  // site-relative guard; it is simply left unlinked.
  const names = [...hrefs.keys()].filter(
    (n) => /^[A-Za-z_$][\w$]*$/.test(n) && SAFE_HREF.test(hrefs.get(n)!),
  );
  if (names.length === 0) return html;
  const nameRe = new RegExp(`(^|[^\\w$])(${names.join("|")})(?![\\w$])`, "g");
  // Rewrite only the text runs between tags; tag contents (inline Shiki
  // style attributes) are never touched.
  return html.replace(/>([^<]+)</g, (_run, text: string) => {
    const linked = text.replace(nameRe, (_m, before: string, name: string) => {
      const href = escapeAttr(hrefs.get(name)!);
      return `${before}<a class="code-type-link" href="${href}">${name}</a>`;
    });
    return `>${linked}<`;
  });
}
