// Search warm-up and query-scoped filters.
//
// Warm-up: the Pagefind plugin loads `/pagefind/pagefind.js` on
// `requestIdleCallback` and only then calls `init()`. Until it is warm, the
// first query after a cold page load appears to return no results.
// `warmSearchIndex()` closes that window by importing and initializing pagefind
// immediately on client mount.
//
// Filters: docgen tags every API page with `module:` / `kind:` Pagefind filters,
// but the plugin's search UI always passes empty options. `withQueryFilters()`
// wraps the search handle to parse `module:aws-s3` / `kind:construct` tokens out
// of the query text and forward them as real Pagefind filters.

interface SearchHandleLike {
  search?(text: string | null, options?: SearchOptions): Promise<unknown>;
  debouncedSearch?(
    text: string | null,
    options?: SearchOptions,
    delay?: number,
  ): Promise<unknown>;
  init?(): unknown;
  options?(config: Record<string, unknown>): Promise<unknown>;
}

/**
 * Search-time ranking tuned for API reference docs, where the signal is "this
 * page IS about the term" (weighted title match) rather than "this page mentions
 * the term often":
 *   - termSimilarity up:   exact word matches rank above longer extensions.
 *   - termFrequency down:  a page mentioning a term many times is not much more
 *     relevant than one defining it once.
 *   - termSaturation down: repeated mentions saturate quickly.
 * See https://pagefind.app/docs/ranking/.
 *
 * This is a search-time Pagefind option (`pagefind.options()`), so it must be
 * applied here on the loaded module before searches run.
 */
export const SEARCH_RANKING = {
  termSimilarity: 3.0,
  termFrequency: 0.4,
  termSaturation: 1.2,
} as const;

interface SearchOptions {
  filters?: Record<string, string[]>;
  [key: string]: unknown;
}

/** Filter keys docgen emits on API pages. Unknown keys stay in the text. */
const FILTER_KEYS = new Set(["module", "kind"]);

export interface ParsedSearchQuery {
  /** Query text with recognized filter tokens removed. */
  text: string;
  /** Recognized filters, e.g. { module: ["aws-s3"], kind: ["construct"] }. */
  filters: Record<string, string[]>;
}

/**
 * Split `module:` / `kind:` tokens out of a raw query string. Tokens
 * with an empty value ("module:") and unknown keys ("foo:bar") are left
 * in the text untouched.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const filters: Record<string, string[]> = {};
  const rest: string[] = [];
  for (const word of raw.split(/\s+/)) {
    const m = /^([a-z]+):(.+)$/i.exec(word);
    const key = m?.[1].toLowerCase();
    if (m && key && FILTER_KEYS.has(key)) {
      (filters[key] ??= []).push(m[2].toLowerCase());
    } else if (word) {
      rest.push(word);
    }
  }
  return { text: rest.join(" "), filters };
}

function mergeOptions(
  options: SearchOptions | undefined,
  filters: Record<string, string[]>,
): SearchOptions {
  if (Object.keys(filters).length === 0) {
    return options ?? {};
  }
  return { ...options, filters: { ...options?.filters, ...filters } };
}

/**
 * Wrap a Pagefind handle so `search`/`debouncedSearch` understand
 * `module:` / `kind:` query tokens. A query that is ONLY filter tokens
 * searches with `null` text, which Pagefind treats as "all pages
 * matching the filters".
 */
export function withQueryFilters<T extends SearchHandleLike>(handle: T): T {
  if (!handle || typeof handle !== "object") {
    return handle;
  }
  const wrapped: T = { ...handle };
  if (typeof handle.search === "function") {
    wrapped.search = (text, options) => {
      const parsed = parseSearchQuery(text ?? "");
      return handle.search!.call(
        handle,
        parsed.text || null,
        mergeOptions(options, parsed.filters),
      );
    };
  }
  if (typeof handle.debouncedSearch === "function") {
    wrapped.debouncedSearch = (text, options, delay) => {
      const parsed = parseSearchQuery(text ?? "");
      return handle.debouncedSearch!.call(
        handle,
        parsed.text || null,
        mergeOptions(options, parsed.filters),
        delay,
      );
    };
  }
  return wrapped;
}

/**
 * Eagerly load and initialize Pagefind on client mount instead of waiting for
 * the plugin's idle callback. Assigning to `window.__pagefind__` goes through the
 * favorites-client property trap, so the handle still gets query filters +
 * favorites boosting. Import failure (dev server: no built index) is ignored.
 */
export function warmSearchIndex(): void {
  // `globalThis` keeps this module compilable under the repo's node-only tsconfig;
  // at runtime the check is equivalent to a `window` SSR guard.
  const win = globalThis as unknown as {
    document?: {
      querySelector(selector: string): { href?: string | null } | null;
    };
    __cdkDocsSearchWarm?: boolean;
    __pagefind__?: unknown;
  };
  const doc = win.document;
  if (!doc || win.__cdkDocsSearchWarm) {
    return;
  }
  win.__cdkDocsSearchWarm = true;
  // Import the same base-prefixed URL that config.mts preloads, so under a
  // `DOCS_BASE=/cdk-docs/` build the warm-up resolves the real
  // `/cdk-docs/pagefind/pagefind.js` from the modulepreload cache instead of
  // 404ing on `/pagefind/pagefind.js`. Reading the href off the preload <link>
  // reuses that base and compiles under the repo's CommonJS tsconfig. The "/"
  // fallback only matters if the hint is ever dropped.
  const preload = doc.querySelector(
    'link[rel="modulepreload"][href$="pagefind/pagefind.js"]',
  );
  // Variable specifier: Vite skips analysis (@vite-ignore) and tsc does not try
  // to resolve the virtual path Pagefind emits at build time.
  const pagefindModule =
    (preload && preload.href) || "/pagefind/pagefind.js";
  import(/* @vite-ignore */ pagefindModule)
    .then(async (module: SearchHandleLike) => {
      // The plugin's idle loader may have won the race; keep its handle.
      if (!win.__pagefind__) {
        win.__pagefind__ = module;
      }
      // Ranking must be set before init(); it applies to every search on this
      // handle (the plugin's own loader never calls options()).
      await module.options?.({ ranking: SEARCH_RANKING });
      module.init?.();
    })
    .catch(() => {
      /* no built index (dev server) — the inline fallback still applies */
    });
}
