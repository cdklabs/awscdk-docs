// Inline type links inside generated signature and example fences. The fence
// info line carries a `type-links=Name:href,…` attribute; after Shiki
// highlighting we wrap each mapped identifier in an anchor, in text segments
// only, never inside tags, and never in a token the highlighter marked as
// literal text (a string or comment) or a field name (`codeNolinkTransformer`,
// below). The anchor inherits the surrounding Shiki token color (see signatures.css).
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

/**
 * Class on a highlighted token that must never carry a type link: the token is
 * literal text (a string or comment) or a Go or C# field name. Set at highlight
 * time by `codeNolinkTransformer`, so it lands in the cached Shiki HTML.
 */
export const NOLINK_CLASS = "code-nolink";

/** A TextMate scope that starts code again inside a literal: a template
 *  `${…}`, an f-string or C# interpolation, or any embedded source. */
const CODE_SCOPE = /^(?:meta\.embedded|meta\.template\.expression|meta\.interpolation|meta\.fstring|constant\.character\.format\.placeholder)\b/;

/** A TextMate scope for literal text: a string or comment, with its quote or
 *  comment-marker punctuation. */
const TEXT_SCOPE = /^(?:string|comment|punctuation\.definition\.(?:string|comment))\b/;

/** Go scopes a struct-literal key (an identifier before `:`) as a property; a type is `entity.name.type.go`. */
const GO_FIELD_SCOPE = "variable.other.property.go";

/** C# has no property-name scope: an initializer name shares the plain variable scope. */
const CS_VARIABLE_SCOPE = "variable.other.readwrite.cs";

/** A lone `=` next: an assignment target (an initializer property in examples), not `==` or `=>`. */
const CS_INITIALIZER_NEXT = /^\s*=(?![=>])/;

/**
 * Whether a token part is literal text (string or comment) rather than code.
 * Decided by the innermost scope that says either way, so `${Bucket}` inside a
 * template string is code, while a `//` inside a string is still string.
 */
export function isLiteralScope(scopes: readonly string[]): boolean {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (CODE_SCOPE.test(scopes[i])) return false;
    if (TEXT_SCOPE.test(scopes[i])) return true;
  }
  return false;
}

/**
 * Whether a token part names a struct field or object property rather than a
 * type: a Go composite-literal key, or a C# variable-scoped identifier that is
 * an assignment target, told apart from a plain variable read by the lone `=`
 * that follows it (`following` is the rest of the line after the part). In
 * generated examples that target is an object-initializer property.
 */
export function isFieldNameScope(scopes: readonly string[], following: string): boolean {
  const innermost = scopes[scopes.length - 1];
  if (innermost === GO_FIELD_SCOPE) return true;
  return innermost === CS_VARIABLE_SCOPE && CS_INITIALIZER_NEXT.test(following);
}

/** A token part that must never carry a type link: literal text or a field name. */
function isNolinkScope(scopes: readonly string[], following: string): boolean {
  return isLiteralScope(scopes) || isFieldNameScope(scopes, following);
}

type ScopedToken = {
  content: string;
  offset: number;
  explanation?: { content: string; scopes: { scopeName: string }[] }[];
  [key: string]: unknown;
};

/**
 * Shiki transformer: marks every token that sits in a string or a comment, or
 * that names a Go struct field or a C# assignment target (an initializer
 * property in generated examples), with `NOLINK_CLASS`, from the token's
 * grammar scopes. Needs the highlight call to pass
 * `includeExplanation: "scopeName"`.
 *
 * Shiki merges neighboring parts that share a color into one token, so a
 * token can hold both code and literal text. Such a token is split first, at
 * the scope boundary, so each piece is decided on its own.
 */
export const codeNolinkTransformer = {
  name: "code-nolink",
  tokens(lines: ScopedToken[][]): ScopedToken[][] {
    return lines.map((line) => {
      const lineText = line.map((t) => t.content).join("");
      let lineCursor = 0;
      return line.flatMap((token) => {
        const tokenStart = lineCursor;
        lineCursor += token.content.length;
        const parts = token.explanation;
        if (!parts || parts.length === 0) return [token];
        // Where each part starts in the token's own text. Shiki can fold whitespace into a token without listing
        // it in a part, so the text is always cut from `token.content`, never rebuilt from the parts.
        let cursor = 0;
        const starts = parts.map((part) => {
          const at = token.content.indexOf(part.content, cursor);
          const start = at < 0 ? cursor : at;
          cursor = start + part.content.length;
          return start;
        });
        const groups: { literal: boolean; start: number; parts: typeof parts }[] = [];
        parts.forEach((part, i) => {
          const following = lineText.slice(tokenStart + starts[i] + part.content.length);
          const literal = isNolinkScope(part.scopes.map((s) => s.scopeName), following);
          const last = groups[groups.length - 1];
          if (last && last.literal === literal) last.parts.push(part);
          else groups.push({ literal, start: i === 0 ? 0 : starts[i], parts: [part] });
        });
        if (groups.length === 1) {
          return [{ ...token, nolink: groups[0].literal }];
        }
        return groups.map((group, i) => {
          const end = i + 1 < groups.length ? groups[i + 1].start : token.content.length;
          return {
            ...token,
            content: token.content.slice(group.start, end),
            offset: token.offset + group.start,
            explanation: group.parts,
            nolink: group.literal,
          };
        });
      });
    });
  },
  span(node: { properties: Record<string, unknown> }, _line: number, _col: number, _el: unknown, token: ScopedToken): void {
    if (!token.nolink) return;
    const cls = node.properties.class;
    const existing = Array.isArray(cls) ? cls.join(" ") : (cls as string | undefined) ?? "";
    node.properties.class = `${existing} ${NOLINK_CLASS}`.trim();
  },
};

const NOLINK_TAG = new RegExp(`^<span\\b[^>]*\\bclass="[^"]*\\b${NOLINK_CLASS}\\b`);

/**
 * Whether a fence can hold text that must not link: a string or a comment (a
 * quote, `#` or `//` / `/*` marker), or a Go struct-literal key or C# assignment
 * target (an initializer property in generated examples: a capitalized
 * identifier at a line start or after `{`, `,` or `(`, followed by `:` but not
 * `:=`, or by a lone `=`). Any other fence needs no grammar scopes.
 */
export function mayHoldLiterals(code: string): boolean {
  return /['"`#]|\/[/*]/.test(code) || /(?:^|[{,(])\s*[A-Z]\w*\s*(?::(?!=)|=(?![=>]))/m.test(code);
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
  // style attributes) are never touched. A run whose token span carries
  // NOLINK_CLASS is literal text or a field name and is left as it is.
  return html.replace(/(<[^>]*>)([^<]+)(?=<)/g, (_run, tag: string, text: string) => {
    if (NOLINK_TAG.test(tag)) return `${tag}${text}`;
    const linked = text.replace(nameRe, (_m, before: string, name: string) => {
      const href = escapeAttr(hrefs.get(name)!);
      return `${before}<a class="code-type-link" href="${href}">${name}</a>`;
    });
    return `${tag}${linked}`;
  });
}
