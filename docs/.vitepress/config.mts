import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DefaultTheme, HeadConfig, UserConfigFn } from "vitepress";
import { pagefindPlugin } from "vitepress-plugin-pagefind";
import sitePaths from "../../scripts/site-paths.cjs";
import { resolveLucideIcon } from "./feature-icons";
import { API_ROOT, SITE_TITLE, VERSIONS_ROUTE } from "../../src/site-routes";
import { agentMarkdownHref } from "./agent-markdown";
import { historyHead } from "./page-history";
import { canonicalHead } from "./canonical";
import { structuredDataHead } from "./structured-data";
import { siteOverridesHead } from "./site-overrides";
import { injectSiteStamp } from "../../src/site-stamp";
import { hashmapCacheBuster, resolveBuildId } from "./hashmap-cache-buster";
import { docsSiteUrl, readVersionSnapshot, VERSION_SNAPSHOT_FILE } from "../../src/docgen/versions";
import { assertValidVersion } from "../../src/docgen/version-format";
import { createHighlighter, type ShikiTransformer } from "shiki";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

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

// Inline type links in generated signature fences: the fence info line carries a `type-links=Name:href,…`
// attribute and `applyTypeLinks` wraps the mapped identifiers in anchors after highlighting. Lives in
// `./type-links` so its validation of untrusted fence attributes is unit-tested directly.
import { TYPE_LINKS_RE, applyTypeLinks, codeNolinkTransformer, mayHoldLiterals } from "./type-links";

// markdown-it `highlight` hook: (code, lang) => html. Mirrors the options VitePress passes to `codeToHtml`
// (dual themes + defaultColor:false) so the emitted markup matches the default highlighter.
async function makeHighlight() {
  const highlighter = await highlighterPromise;
  const loaded = new Set(highlighter.getLoadedLanguages());
  // Memoize by (language, exact code): the hook is pure, so identical fences produce byte-identical HTML, and
  // generated snippets repeat heavily across pages. The key uses NUL as the separator (never in a lang id) and
  // the exact code — trailing whitespace changes the output, so it must not be normalized away.
  const cache = new Map<string, { html: string; marked: boolean }>();
  return (code: string, lang: string, attrs?: string): string => {
    const language = lang && loaded.has(lang) ? lang : "txt";
    const key = `${language}\u0000${code}`;
    // Strings and comments only need marking where a type link could land in them: a fence that offers type links
    // and contains a quote or comment marker. Reporting grammar scopes roughly doubles a fence's highlight time, so
    // the other fences skip it.
    const needsMarks = !!attrs && TYPE_LINKS_RE.test(attrs) && mayHoldLiterals(code);
    // Cache stores the pure Shiki output; type links are applied per call, after the cache. Two pages can share
    // the same signature text with different link targets, so folding attrs into the key would lose duplicate hits.
    // An entry highlighted without marks is redone once if the same code later arrives with type links, so the key
    // stays (lang, code).
    const cached = cache.get(key);
    if (cached !== undefined && (cached.marked || !needsMarks)) return applyTypeLinks(cached.html, attrs);
    // Grammar scope names per token, so `codeNolinkTransformer` can mark strings and comments. The marker is part
    // of the cached HTML. Shiki's `codeToHtml` passes this tokenizer option through to `codeToTokens`, but its
    // `CodeToHastOptions` type does not list it, so it is spread in rather than written as a literal key.
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
    cache.set(key, { html, marked: needsMarks });
    return applyTypeLinks(html, attrs);
  };
}

// Clean accessible permalink labels for multi-language member headings. VitePress derives each anchor's
// `aria-label` from the heading token's raw `content`, which for a docgen member heading is variant-span markup
// plus the `{#…}` pin. Rewriting `content` to the canonical (first-span, TypeScript) member name before
// markdown-it-anchor runs restores a clean label. Safe here because rendering, outline, and slug derivation all
// read the token's `children`; the raw `content` string's only remaining consumer is the aria-label.
const LANG_VARIANT_SPAN = /^<span class="lang-variant"[^>]*>(.*?)<\/span>/;
function cleanMemberHeadingLabel(source: string): string | undefined {
  const canonical = LANG_VARIANT_SPAN.exec(source)?.[1];
  if (canonical === undefined) {
    return undefined; // not a docgen variant heading — leave untouched
  }
  // Drop any trailing markup after the spans (e.g. a static `<Badge>`)
  // and the `{#…}` pin; unescape docgen's escapeHtml entities.
  return canonical
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// The generated Service -> Resource -> Kind API tree is emitted once by docgen as cached static assets under
// docs/public/api-sidebar/ (a skeleton plus one chunk per section) and rendered by the ApiSidebar theme
// component, which fetches the skeleton once per session and each chunk when its section is needed. The static
// sidebar below carries one empty group so VitePress derives hasSidebar
// and shows the /v2/ rail; CSS hides the empty wrapper, and the real tree renders through the default theme's
// sidebar-nav-after slot. The outer array must stay non-empty or VitePress drops the rail and generated tree.

// Installed aws-cdk-lib version: the release the docs were generated from. Absent when dependencies aren't
// installed, and validated so the badge, the stamp and the report-issue template cannot carry a non-version.
const cdkPackagePath = fileURLToPath(
  new URL("../../node_modules/aws-cdk-lib/package.json", import.meta.url),
);
const cdkVersion = existsSync(cdkPackagePath)
  ? assertValidVersion(
      "aws-cdk-lib package.json version",
      JSON.parse(readFileSync(cdkPackagePath, "utf-8")).version,
    )
  : undefined;

// When the docs were generated: the committed version snapshot's refresh time rather than the clock, so two builds
// of one commit stay identical. Same value the /versions page shows as "last updated".
const snapshotPath = fileURLToPath(
  new URL(`../../${VERSION_SNAPSHOT_FILE}`, import.meta.url),
);
const generatedAt = existsSync(snapshotPath)
  ? readVersionSnapshot(snapshotPath).generatedAt
  : "";

// Names of the api-sidebar assets the theme fetches by path. Read off the emitted directory because the
// hash is the file's own content.
function apiSidebarAssets(): { apiSidebarAsset: string; symbolsAsset: string; typeSummariesAsset: string } {
  const dir = fileURLToPath(new URL("../public/api-sidebar", import.meta.url));
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const named = (base: string) =>
    files.find((file) => new RegExp(`^${base}\\.[0-9a-f]{8}\\.js$`).test(file)) ?? "";
  return {
    apiSidebarAsset: named("sidebar"),
    symbolsAsset: named("symbols"),
    typeSummariesAsset: named("type-summaries"),
  };
}

// Typed as UserConfigFn rather than wrapped in `defineConfig`: the helper only accepts a plain
// UserConfig, so it cannot type the async factory this config has to be (the highlighter is awaited).
const config: UserConfigFn<DefaultTheme.Config> = async () => ({
  title: SITE_TITLE,
  // VitePress's appearance is VueUse's useDark, which on every apply adds a
  // global `transition: none` stylesheet and forces a style recalc of the
  // whole page — including on mount, when the pre-paint script has already
  // set the class. On a large open page (constructs.Construct at Spacious,
  // ~2,700 inheritance names) those recalcs made a ~250ms long task. Apply only
  // when the class actually changes; a real toggle still disables transitions.
  // An arrow function: VitePress ships it to the client by its source text.
  appearance: {
    onChanged: (isDark: boolean, apply: (mode: 'dark' | 'light' | 'auto') => void, mode: 'dark' | 'light' | 'auto') => {
      if (typeof document === 'undefined') return apply(mode);
      if (document.documentElement.classList.contains('dark') !== isDark) apply(mode);
    },
  },
  description:
    "The API reference for the AWS Cloud Development Kit (AWS CDK)",
  // Hosted path and output directory are the SAME string:
  // `DOCS_BASE=/cdk/api/` serves the site there and writes it to
  // `docs/.vitepress/dist/cdk/api`, so the published artifact
  // holds no loose files at its root and the two can never drift. Unset (the
  // local and fixture builds) means the domain root and the flat dist.
  base: sitePaths.siteBase(),
  outDir: sitePaths.outDir(),

  // One `sitemap.xml` per build, listing every rendered page under the public site URL. VitePress resolves each
  // page path against `hostname`, so the hostname must carry the hosted prefix (`/cdk/api/`), which is what
  // DOCS_SITE_URL already means elsewhere. A shard build lists only its own pages; scripts/merge-shards.cjs
  // unions the shard sitemaps into the complete one.
  sitemap: { hostname: docsSiteUrl() },

  // Resolves the home page's `lucide:<name>` feature icon tokens into inline SVG strings before VitePress
  // renders the page. An unknown token throws and fails the build.
  transformPageData(pageData) {
    const features = pageData.frontmatter.features;
    if (!Array.isArray(features)) {
      return;
    }
    for (const feature of features) {
      if (typeof feature?.icon === "string" && feature.icon.startsWith("lucide:")) {
        feature.icon = resolveLucideIcon(feature.icon);
      }
    }
  },

  // Per-page machine-readable metadata: the page's canonical URL, the agent-oriented Markdown twin as a
  // Markdown alternate (only on pages whose twin was actually written), the page's version history as
  // `cdk-docs-*` metas — recorded values only, an unknown is absent rather than empty, while the revised date is on
  // every page — and one JSON-LD node per page. Frontmatter, not themeConfig: with `metaChunk` on, themeConfig
  // round-trips through a fetched chunk.
  transformHead({ pageData }) {
    const head: HeadConfig[] = [];
    head.push(canonicalHead(pageData.relativePath, docsSiteUrl()));
    // Two llms.txt-style alternates: the site index, on every page, and the page's own Markdown twin when it has one.
    head.push(["link", { rel: "alternate", type: "text/plain", href: agentMarkdownHref("llms.txt", sitePaths.siteBase()) }]);
    const twin = pageData.frontmatter.agentMarkdown;
    if (typeof twin === "string") {
      head.push(["link", { rel: "alternate", type: "text/markdown", href: agentMarkdownHref(twin, sitePaths.siteBase()) }]);
    }
    head.push(...historyHead(pageData.frontmatter));
    head.push(
      structuredDataHead(
        {
          relativePath: pageData.relativePath,
          title: pageData.title,
          description: pageData.description,
          frontmatter: pageData.frontmatter,
        },
        docsSiteUrl(),
      ),
    );
    return head;
  },

  // Generated API docs may cross-reference pages not yet generated (e.g. types in modules outside
  // docgen.config.json).
  ignoreDeadLinks: true,

  // ADRs stay in the repo but are excluded from the rendered site: no /adr/ pages are built, so they never
  // appear in the sidebar, nav, or Pagefind index. The spike proof pages (docs/spike/) are excluded on the
  // deployed shard build only (SHARD_BUILD=1); the e2e fixture build sets neither SHARD_BUILD nor DOCS_BASE
  // and still needs the page for test/e2e/language-tabs.spec.ts.
  srcExclude: ["adr/**", ...(process.env.SHARD_BUILD ? ["spike/**"] : [])],

  // The authored construct-library overview, which docgen also copies to the /v2/ index, is served at its
  // historical address inside the generated /v2/docs/ tree (which docgen clears on every run).
  rewrites: {
    "aws-construct-library.md": "v2/docs/aws-construct-library.md",
  },

  // Syntax highlighting runs through the `highlight` hook below, on the highlighter built above from
  // HIGHLIGHT_LANGS. No `markdown.languages` here: VitePress reads that only when building its own default
  // highlighter, which a custom `highlight` replaces, so the option would be inert.
  markdown: {
    highlight: await makeHighlight(),
    // Build-time math typesetting via markdown-it-mathjax3. docgen rewrites GitHub ```math fences in jsii
    // READMEs to `$$…$$` display blocks; this flag typesets them into static SVG at build time — SSR-safe,
    // no client runtime, no per-page JS growth.
    math: true,
    // Runs before markdown-it-anchor's core rule so its permalink renderAttrs sees the clean canonical member
    // name instead of variant-span markup (see cleanMemberHeadingLabel above). `ruler.before("anchor", …)`
    // positions the rule ahead of anchor's regardless of registration order.
    config: (md) => {
      md.core.ruler.before("anchor", "clean_member_heading_label", (state) => {
        for (let i = 0; i < state.tokens.length; i++) {
          const token = state.tokens[i];
          if (token.type !== "inline" || state.tokens[i - 1]?.type !== "heading_open") {
            continue;
          }
          const clean = cleanMemberHeadingLabel(token.content);
          if (clean !== undefined) {
            token.content = clean;
          }
        }
      });
    },
  },

  // Extract the page hashmap + site metadata into one shared cached JS chunk instead of inlining ~500KB into
  // every page's HTML, which pushed the Pages artifact over GitHub Pages' 1GB limit. A shard's chunk holds only its
  // own pages, so a link into another shard falls back to fetching the complete `hashmap.json`, cache-busted per
  // build by the plugin below.
  metaChunk: true,

  // The build stamp (src/site-stamp.ts) in every page's <head>: the one place a downstream republisher rewrites the
  // documented version and the generated-at timestamp. Values placed in `head` or `themeConfig` instead would also
  // ship inside the metadata chunk, and the client would restore them over an HTML-only replacement.
  transformHtml(code) {
    return injectSiteStamp(code, { version: cdkVersion ?? "", generatedAt });
  },

  // Preload the Pagefind engine module so the eager warm-up in theme/search-client.ts resolves from cache
  // instead of a cold network fetch. DOCS_BASE-aware like the plugin's own loader.
  head: [
    [
      "link",
      {
        rel: "modulepreload",
        href: `${sitePaths.siteBase()}pagefind/pagefind.js`,
      },
    ],
    // Re-apply a stored decoupled code-theme choice before first paint, mirroring VitePress's appearance
    // bootstrap, so a reload never flashes the wrong code colors. Storage key is CODE_THEME_KEY in
    // theme/code-theme.ts; 'auto' (code follows the site theme) is the absence of the attribute, so only
    // explicit light/dark apply.
    [
      "script",
      {},
      `;(function () { try { var t = localStorage.getItem("cdk-docs-code-theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-code-theme", t); } catch (e) {} })();`,
    ],
    // Re-apply a stored density choice before first paint, mirroring the code-theme bootstrap above, so a
    // reload never flashes the wrong spacing. Storage key is DENSITY_KEY in theme/density.ts; 'balanced'
    // (today's values) is the absence of the attribute, so only compact/spacious apply. Unknown stored
    // values are ignored here, matching the module's fall-back-to-balanced rule. With stored 'spacious' it
    // also opens every fold-out (FOLDOUT_SELECTOR in theme/density.ts) as the parser inserts it: observer
    // callbacks run before the next paint, so no fold-out is ever painted closed. It stops at
    // DOMContentLoaded; theme/density.ts owns the rule after that (level switch, navigation).
    [
      "script",
      {},
      `;(function () { try { var d = localStorage.getItem("cdk-docs-density"); if (d === "compact" || d === "spacious") document.documentElement.setAttribute("data-density", d); if (d === "spacious" && window.MutationObserver) { var s = "details.member-disclosure, details.chain-more"; var open = function (n) { if (n.nodeType !== 1) return; if (n.matches(s)) n.open = true; var all = n.querySelectorAll(s); for (var i = 0; i < all.length; i++) all[i].open = true; }; var o = new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) { var a = ms[i].addedNodes; for (var j = 0; j < a.length; j++) open(a[j]); } }); o.observe(document.documentElement, { childList: true, subtree: true }); document.addEventListener("DOMContentLoaded", function () { o.disconnect(); open(document.documentElement); }); } } catch (e) {} })();`,
    ],
    // The standard AWS docs boot script: cookie-consent banner, footer "Cookie preferences" hook, and
    // consent-gated analytics, which reports the page under the two meta tags.
    ["meta", { name: "guide-name", content: "API Reference" }],
    ["meta", { name: "service-name", content: "AWS Cloud Development Kit (AWS CDK)" }],
    ["script", { src: "https://docs.aws.amazon.com/assets/js/awsdocs-boot.js", async: "", defer: "" }],
    // Empty stylesheet a downstream publisher replaces with its own. VitePress renders `head` after the theme
    // stylesheets, so its rules win at equal specificity.
    siteOverridesHead(sitePaths.siteBase()),
  ],

  vite: {
    resolve: {
      // Swap the default theme's aside outline for one that also lists a type page's members under their section
      // headings (docs/adr/2026-10-22-outline-members.md). The documented way to override an internal theme
      // component: VitePress imports it by path, so an alias on that path is the one seam.
      alias: [
        {
          find: /^.*\/VPDocAsideOutline\.vue$/,
          replacement: fileURLToPath(new URL("./theme/ApiDocAsideOutline.vue", import.meta.url)),
        },
      ],
    },
    // Pagefind static search: indexes the built site and replaces the default navbar search component.
    // During a sharded build (SHARD_BUILD=1) each shard renders only a subset of pages, so per-shard indexing
    // would be partial. Keep the plugin (so `virtual:pagefind` still resolves) but no-op its indexing command;
    // the merge step runs `npx pagefind --site <dist>` once over the merged tree.
    plugins: [
      pagefindPlugin({
        // Hint the query-scoping tokens: `module:` / `kind:` are parsed client-side (theme/search-client.ts)
        // into Pagefind filters that docgen emits on every API page.
        placeholder: "Search (e.g. bucket module:aws-s3 kind:construct)",
        heading: "Top {{searchResult}} results",
        ...(process.env.SHARD_BUILD
          ? { indexingCommand: 'echo "[shard build] pagefind indexing deferred to post-merge step"' }
          : {}),
      }),
      hashmapCacheBuster(resolveBuildId()),
    ],

    build: {
      // Vite gzips every emitted asset just to log its compressed size; with ~21k pages that is wasted CI CPU.
      reportCompressedSize: false,
    },
  },

  themeConfig: {
    // The logo is decorative inside the home link: NavSiteTitle supplies the
    // exact accessible name while CSS chooses the visible responsive label.
    logo: {
      src: "/aws-logo-gray.svg",
      alt: "",
    },
    siteTitle: false,

    // No native editLink here: "Edit this page" and "Report an issue" render together in the PageFooterLinks
    // doc-footer component, which derives the edit target from editLinkFor() in theme/feedback.ts. Configuring
    // editLink too would duplicate the edit link.

    // Consumed by the PageFooterLinks report-issue template.
    cdkVersion,

    // Consumed by ApiSidebar, NavFilter and the type tooltips. Chunk filenames are absent by design: the skeleton
    // names its own.
    ...apiSidebarAssets(),

    nav: [
      { text: "API Reference", link: API_ROOT },
      // Three entries is the budget: a fourth pushes the settings trigger past a 1000px viewport
      // (test/e2e/nav-controls.spec.ts). Shape pinned by test/skills.test.ts.
      { text: "Skills", link: "/skills" },
      { text: "Versions", link: VERSIONS_ROUTE },
    ],

    sidebar: {
      // VitePress derives `hasSidebar` from this array's length. The empty group keeps the rail mounted while the
      // generated tree renders through `sidebar-nav-after`; api-sidebar.css removes its empty wrapper.
      [API_ROOT]: [{ items: [] }],
    },

    // Suppress the native pager footer: with an empty sidebar group VitePress otherwise creates truthy prev/next
    // objects with no links and renders an empty contentinfo landmark. The site footer renders through layout-bottom.
    docFooter: { prev: false, next: false },
  },
});

export default config;
