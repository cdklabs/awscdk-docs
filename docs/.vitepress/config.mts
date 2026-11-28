import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DefaultTheme, HeadConfig, UserConfigFn } from "vitepress";
import { pagefindPlugin } from "vitepress-plugin-pagefind";
import sitePaths from "../../scripts/site-paths.cjs";
import { resolveLucideIcon } from "./feature-icons";
import { API_ROOT, SITE_TITLE, VERSIONS_ROUTE } from "../../src/site-routes";
import { agentMarkdownHref } from "./agent-markdown";
import { historyHead } from "./page-history";
import { PAGE_REWRITES, pageSourceExcludes } from "./page-url";
import { canonicalHead } from "./canonical";
import { structuredDataHead } from "./structured-data";
import { siteOverridesHead } from "./site-overrides";
import { injectSiteStamp } from "../../src/site-stamp";
import { hashmapCacheBuster, resolveBuildId } from "./hashmap-cache-buster";
import { astReleasingCompiler } from "./vue-compiler";
import { releaseBuildOutput } from "./release-build-output";
import { docsSiteUrl, readVersionSnapshot, VERSION_SNAPSHOT_FILE } from "../../src/docgen/versions";
import { assertValidVersion } from "../../src/docgen/version-format";
import { makeHighlight } from "./highlight";
// Accessible permalink labels for docgen headings. Its own module, like `highlight`, so a unit test can
// feed it each heading shape directly.
import { cleanHeadingLabel } from "./heading-label";

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
  // VitePress does not need to suppress transitions when it reapplies the mode during startup.
  // The custom picker keeps VueUse's default so a real user change still suppresses transitions.
  appearance: { disableTransition: false },
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
  srcExclude: pageSourceExcludes(Boolean(process.env.SHARD_BUILD)),

  // The authored construct-library overview, which docgen also copies to the /v2/ index, is served at its
  // historical address inside the generated /v2/docs/ tree (which docgen clears on every run).
  rewrites: PAGE_REWRITES,

  // Syntax highlighting runs through the `highlight` hook below, on the highlighter `./highlight` builds from its
  // pinned language set. No `markdown.languages` here: VitePress reads that only when building its own default
  // highlighter, which a custom `highlight` replaces, so the option would be inert.
  markdown: {
    highlight: await makeHighlight(),
    // Build-time math typesetting via markdown-it-mathjax3. docgen rewrites GitHub ```math fences in jsii
    // READMEs to `$$…$$` display blocks; this flag typesets them into static SVG at build time — SSR-safe,
    // no client runtime, no per-page JS growth.
    math: true,
    // Runs before markdown-it-anchor's core rule so its permalink renderAttrs sees the clean type or member name
    // instead of title or variant-span markup (see `heading-label`). `ruler.before("anchor", …)`
    // positions the rule ahead of anchor's regardless of registration order.
    config: (md) => {
      md.core.ruler.before("anchor", "clean_heading_label", (state) => {
        for (let i = 0; i < state.tokens.length; i++) {
          const token = state.tokens[i];
          if (token.type !== "inline" || state.tokens[i - 1]?.type !== "heading_open") {
            continue;
          }
          const clean = cleanHeadingLabel(token.content);
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
    // The same script first re-applies a stored Explorer preview choice, so a reload with the preview on
    // already has the rail's 72px of sidebar width (one script, not two, because it is written into every
    // page). Storage keys are EXPLORER_PREVIEW_KEY and EXPLORER_VIEW_KEY in theme/explorer-preview.ts; the
    // preview being off is the absence of both attributes, so only an explicit "on" applies, and an unknown
    // view falls back to "api".
    [
      "script",
      {},
      `;(function () { try { if (localStorage.getItem("cdk-docs-explorer-preview") === "on") { var r = document.documentElement; r.setAttribute("data-explorer-preview", "on"); var v = localStorage.getItem("cdk-docs-explorer-view"); r.setAttribute("data-explorer-view", v === "favorites" || v === "services" ? v : "api"); } var d = localStorage.getItem("cdk-docs-density"); if (d === "compact" || d === "spacious") document.documentElement.setAttribute("data-density", d); if (d === "spacious" && window.MutationObserver) { var s = "details.member-disclosure, details.chain-more"; var open = function (n) { if (n.nodeType !== 1) return; if (n.matches(s)) n.open = true; var all = n.querySelectorAll(s); for (var i = 0; i < all.length; i++) all[i].open = true; }; var o = new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) { var a = ms[i].addedNodes; for (var j = 0; j < a.length; j++) open(a[j]); } }); o.observe(document.documentElement, { childList: true, subtree: true }); document.addEventListener("DOMContentLoaded", function () { o.disconnect(); open(document.documentElement); }); } } catch (e) {} })();`,
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

  // Frees each page's template AST once compiled, so a shard build does not hold every page's AST until it exits.
  vue: { compiler: astReleasingCompiler },

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
      // Frees each build's code and module sources once written; VitePress holds the results until rendering ends.
      releaseBuildOutput(),
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
