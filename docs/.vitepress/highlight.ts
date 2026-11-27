import { createHighlighter, type ShikiTransformer } from "shiki";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
// Inline type links in generated signature fences: the fence info line carries a `type-links=Name:href,…`
// attribute and `applyTypeLinks` wraps the mapped identifiers in anchors after highlighting. Lives in
// `./type-links` so its validation of untrusted fence attributes is unit-tested directly.
import { TYPE_LINKS_RE, applyTypeLinks, codeNolinkTransformer, mayHoldLiterals } from "./type-links";

// Languages docgen emits, plus incidental fences in generated prose. Pinning the set makes Shiki load only
// these grammars instead of its full bundled set, cutting highlighter init time and memory per page.
const HIGHLIGHT_LANGS = [
  "typescript",
  "python",
  "bash",
  "console",
  "json",
  "go",
  "java",
  "csharp",
];

// Dual theme matching VitePress's default, so code blocks follow the site light/dark toggle
// (emits `--shiki-light` / `--shiki-dark` CSS vars via `defaultColor: false`).
const CODE_THEMES = { light: "github-light", dark: "github-dark" } as const;

// One Shiki highlighter on the JavaScript regex engine, not the default Oniguruma WASM engine: the WASM heap
// lives outside V8's --max-old-space-size cap and can OOM the shard build off-heap. The JS engine is pure-JS
// and faster to tokenize. A custom `markdown.highlight` is required because VitePress only builds its default
// Oniguruma highlighter when `markdown.highlight` is unset.
const highlighterPromise = createHighlighter({
  langs: HIGHLIGHT_LANGS,
  themes: [CODE_THEMES.light, CODE_THEMES.dark],
  engine: createJavaScriptRegexEngine(),
});

// markdown-it `highlight` hook: (code, lang) => html. Mirrors the options VitePress passes to `codeToHtml`
// (dual themes + defaultColor:false) so the emitted markup matches the default highlighter.
export async function makeHighlight() {
  const highlighter = await highlighterPromise;
  const loaded = new Set(highlighter.getLoadedLanguages());
  // Memoize by (marks, language, exact code): the hook is pure, so identical fences produce byte-identical HTML,
  // and generated snippets repeat heavily across pages. The key uses NUL as the separator (never in a lang id) and
  // the exact code — trailing whitespace changes the output, so it must not be normalized away.
  const cache = new Map<string, string>();
  return (code: string, lang: string, attrs?: string): string => {
    const language = lang && loaded.has(lang) ? lang : "txt";
    // Marks are only needed where a type link could land on text that must stay plain: a fence that offers type
    // links and may hold a string, a comment or a Go/C# field name (`mayHoldLiterals`). Reporting grammar scopes
    // roughly doubles a fence's highlight time, so the other fences skip it.
    const needsMarks = !!attrs && TYPE_LINKS_RE.test(attrs) && mayHoldLiterals(code);
    // Marks change the HTML, so they are part of the key: a fence gets the same output whatever was highlighted
    // before it. Cache stores the pure Shiki output; type links are applied per call, after the cache. Two pages
    // can share the same signature text with different link targets, so folding attrs into the key would lose hits.
    const key = `${needsMarks ? "marked" : "plain"}\u0000${language}\u0000${code}`;
    const cached = cache.get(key);
    if (cached !== undefined) return applyTypeLinks(cached, attrs);
    // Grammar scope names per token, so `codeNolinkTransformer` can mark strings, comments and field names. The
    // marker is part of the cached HTML. Shiki's `codeToHtml` passes this tokenizer option through to
    // `codeToTokens`, but its `CodeToHastOptions` type does not list it, so it is spread in rather than written as
    // a literal key.
    // `tokenizeTimeLimit: 0` turns off the per-line tokenize timeout. With scopes on, Shiki tokenizes each line
    // twice (once for scopes, once for colors), each pass timed on its own; if only one pass times out under load,
    // the two token lists disagree and Shiki throws. The grammars are fixed and the input is generated, so the
    // runaway-regex guard buys nothing here (ADR 2026-10-26-no-type-links-in-literals).
    const scopes = { includeExplanation: needsMarks ? ("scopeName" as const) : false, tokenizeTimeLimit: 0 };
    const html = highlighter.codeToHtml(code, {
      lang: language,
      themes: CODE_THEMES,
      defaultColor: false,
      ...scopes,
      // Match VitePress's default highlighter: tag the <pre> with `vp-code` (its copy-button / code-group logic
      // keys off it), and mark it `v-pre` so Vue never parses the highlighted code as a template — generated
      // fences can contain `{{ … }}` that Vue would otherwise read as interpolations and fail the build.
      transformers: [
        {
          name: "vp-code-vpre",
          pre(node) {
            const cls = node.properties.class;
            node.properties.class = `${Array.isArray(cls) ? cls.join(" ") : cls ?? ""} vp-code`.trim();
            node.properties["v-pre"] = "";
          },
        },
        // Typed structurally in type-links.ts (so its unit tests can call it with plain tokens); it implements the
        // `tokens` and `span` hooks of a Shiki transformer.
        codeNolinkTransformer as unknown as ShikiTransformer,
      ],
    });
    cache.set(key, html);
    return applyTypeLinks(html, attrs);
  };
}
