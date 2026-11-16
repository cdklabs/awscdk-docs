/**
 * Canonical escaping helpers for all docgen-generated HTML/markdown.
 *
 * Every place that interpolates dynamic text into generated HTML must go
 * through one of these helpers instead of hand-rolled `.replace()` chains.
 * The helpers close the gaps CodeQL flags on ad-hoc escaping:
 *
 * - `escapeHtml`: HTML *text* context — escapes `&` first so entities are
 *   never double-encoded, then `<` and `>`.
 * - `escapeVueText`: like `escapeHtml`, plus `{`/`}` so Vue/VitePress does
 *   not treat the output as template interpolation.
 * - `escapeAttr`: HTML *attribute* context — everything `escapeHtml` does,
 *   plus `"` and `'` so a value can never break out of its quoting.
 * - `escapeSummaryHtml`: a one-line summary in raw HTML, where a Markdown
 *   link to a web target becomes an anchor and everything else is
 *   `escapeVueText`.
 * - `removeAll`: fixpoint removal for multi-character patterns (HTML tags,
 *   comments) where a single `.replace()` pass can re-form the pattern
 *   from the surrounding text (e.g. `<!<!-- -->--x-->`).
 */

/** Escape text for an HTML text context. `&` first, so entities never double-encode. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape text for raw HTML embedded in VitePress markdown: HTML text
 * escaping plus `{`/`}` so Vue does not compile the output as
 * template interpolation.
 */
export function escapeVueText(text: string): string {
  return escapeHtml(text)
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

/**
 * Escape a value for interpolation into a quoted HTML attribute. Escapes
 * both quote styles so the value can never terminate the attribute,
 * regardless of which quoting the call site uses.
 */
export function escapeAttr(value: string): string {
  return escapeHtml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A Markdown link `[text](http(s)://url)`; only web targets qualify, anything else stays text. */
const WEB_LINK = /\[([^\[\]]+)\]\((https?:\/\/[^\s()<>]+)\)/g;

/**
 * Escape a one-line prose summary for raw HTML embedded in VitePress markdown,
 * rendering a Markdown link `[text](url)` to a web target as an anchor that
 * opens in a new tab, like every other external link docgen emits. Every piece
 * of text, including the link text, goes through `escapeVueText` and the href
 * through `escapeAttr`, so no raw markup from a jsii summary reaches the page;
 * a summary without a web link is exactly `escapeVueText(summary)`.
 */
export function escapeSummaryHtml(summary: string): string {
  let html = '';
  let end = 0;
  for (const match of summary.matchAll(WEB_LINK)) {
    html += escapeVueText(summary.slice(end, match.index));
    html += `<a href="${escapeAttr(match[2])}" target="_blank" rel="noopener noreferrer">${escapeVueText(match[1])}</a>`;
    end = match.index + match[0].length;
  }
  return html + escapeVueText(summary.slice(end));
}

/**
 * Remove every match of `pattern` from `text`, repeating until a pass
 * removes nothing. A single `.replace()` pass over a multi-character
 * pattern is incomplete: removing one match can splice the surrounding
 * characters into a brand-new match (`<scr<script>ipt>` → `<script>`,
 * `<!<!-- -->--x-->` → `<!--x-->`). The fixpoint loop terminates because
 * each effective pass strictly shortens the string.
 *
 * `pattern` must carry the `g` flag and must not match the empty string.
 */
export function removeAll(text: string, pattern: RegExp): string {
  let previous: string;
  do {
    previous = text;
    text = text.replace(pattern, '');
  } while (text !== previous);
  return text;
}
