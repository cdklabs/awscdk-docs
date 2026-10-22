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
// of the query text and forward them as real Pagefind filters. A `module:` value
// is forgiving: readers see `aws_s3` in the sidebar and in import paths while the
// index stores `aws-s3`, so the typed value is normalized and then matched against
// the module list Pagefind reports, exactly first and by word prefix otherwise.

/** Pagefind's `filters()` payload: filter key -> value -> page count. */
type FilterCounts = Record<string, Record<string, number>>;

interface SearchHandleLike {
  search?(text: string | null, options?: SearchOptions): Promise<unknown>;
  debouncedSearch?(
    text: string | null,
    options?: SearchOptions,
    delay?: number,
  ): Promise<unknown>;
  filters?(): Promise<FilterCounts>;
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

/** Keep a bounded ranked pool for favorites without scanning every match. */
export const MAX_SEARCH_CANDIDATES = 50;

/** Return only the results the search dialog will display and materialize. */
export const MAX_SEARCH_RESULTS = 20;

interface SearchResultLike {
  results?: unknown[];
  [key: string]: unknown;
}

function limitSearchCandidates<T>(search: T): T {
  if (!search || typeof search !== "object") {
    return search;
  }
  const results = (search as SearchResultLike).results;
  if (!Array.isArray(results) || results.length <= MAX_SEARCH_CANDIDATES) {
    return search;
  }
  return {
    ...search,
    results: results.slice(0, MAX_SEARCH_CANDIDATES),
  } as T;
}

/** A Pagefind filter value list, or its compound `any` form for a forgiving match. */
type FilterValues = string[] | { any: string[] };

interface SearchOptions {
  filters?: Record<string, FilterValues>;
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
 * Normalize a typed `module:` value to the slug shape the index stores
 * (`searchModule` in docgen): lowercase, `_` and `/` become `-`, and a
 * leading `@` is dropped, so `module:aws_s3`, `module:@aws-cdk/aws-s3-alpha`
 * and `module:AWS-S3` all name what the sidebar and import paths show.
 */
export function normalizeModuleValue(value: string): string {
  return value.toLowerCase().replace(/^@/, "").replace(/[/_]/g, "-");
}

/**
 * Split `module:` / `kind:` tokens out of a raw query string. Tokens
 * with an empty value ("module:") and unknown keys ("foo:bar") are left
 * in the text untouched. Module values are normalized; kind values are
 * only lowercased and match exactly.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const filters: Record<string, string[]> = {};
  const rest: string[] = [];
  for (const word of raw.split(/\s+/)) {
    const m = /^([a-z]+):(.+)$/i.exec(word);
    const key = m?.[1].toLowerCase();
    if (m && key && FILTER_KEYS.has(key)) {
      const value = key === "module" ? normalizeModuleValue(m[2]) : m[2].toLowerCase();
      (filters[key] ??= []).push(value);
    } else if (word) {
      rest.push(word);
    }
  }
  return { text: rest.join(" "), filters };
}

/**
 * Known modules a typed `module:` value selects. An exact match selects
 * that module only. Otherwise every known module whose hyphen-separated
 * words contain the typed words in order, each as a prefix, is selected:
 * `s3` selects `aws-s3`, `aws-s3-assets`, `aws-s3-deployment` and
 * `aws-s3tables-alpha`; `lambda-python` selects `aws-lambda-python-alpha`.
 * Empty when nothing matches.
 */
export function matchModules(typed: string, known: readonly string[]): string[] {
  if (known.includes(typed)) {
    return [typed];
  }
  const wanted = typed.split("-").filter(Boolean);
  if (wanted.length === 0) {
    return [];
  }
  return known.filter((module) => {
    const words = module.split("-");
    let at = 0;
    for (const prefix of wanted) {
      while (at < words.length && !words[at].startsWith(prefix)) {
        at++;
      }
      if (at >= words.length) {
        return false;
      }
      at++;
    }
    return true;
  });
}

/** Levenshtein distance, for the closest-module hint. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** How many close module names the no-match hint offers. */
export const MODULE_HINT_LIMIT = 5;

/**
 * Up to {@link MODULE_HINT_LIMIT} known modules closest to a typed value
 * that matched nothing: modules containing the typed text first, then by
 * the smallest edit distance between the typed text and any module word.
 */
export function closeModules(typed: string, known: readonly string[]): string[] {
  const score = (module: string): number => {
    if (module.includes(typed)) {
      return 0;
    }
    return Math.min(editDistance(typed, module), ...module.split("-").map((w) => editDistance(typed, w)));
  };
  return [...known]
    .map((module) => ({ module, score: score(module) }))
    .sort((a, b) => a.score - b.score || a.module.localeCompare(b.module))
    .slice(0, MODULE_HINT_LIMIT)
    .map((entry) => entry.module);
}

/** Resolved `module:` filters: what to pass to Pagefind, or the values nothing matched. */
interface ModuleResolution {
  filter?: FilterValues;
  unmatched: string[];
}

/**
 * Turn typed module values into Pagefind filter values against the known
 * module list. Several typed values union. Without a known list (an engine
 * that cannot report filters) the normalized values pass through as-is.
 */
function resolveModules(typed: string[], known: readonly string[] | undefined): ModuleResolution {
  if (!known) {
    return { filter: typed, unmatched: [] };
  }
  const selected = new Set<string>();
  const unmatched: string[] = [];
  for (const value of typed) {
    const matches = matchModules(value, known);
    if (matches.length === 0) {
      unmatched.push(value);
    }
    for (const match of matches) {
      selected.add(match);
    }
  }
  if (selected.size === 0) {
    return { unmatched };
  }
  const values = [...selected];
  return { filter: values.length === 1 ? values : { any: values }, unmatched };
}

/** Module list the loaded engine reports, read once per handle. */
const knownModulesByHandle = new WeakMap<object, Promise<string[] | undefined>>();

function knownModules(handle: SearchHandleLike): Promise<string[] | undefined> {
  if (typeof handle.filters !== "function") {
    return Promise.resolve(undefined);
  }
  let pending = knownModulesByHandle.get(handle);
  if (!pending) {
    pending = handle
      .filters()
      .then((counts) => Object.keys(counts?.module ?? {}))
      .catch(() => undefined);
    knownModulesByHandle.set(handle, pending);
  }
  return pending;
}

function mergeOptions(
  options: SearchOptions | undefined,
  filters: Record<string, FilterValues>,
): SearchOptions {
  if (Object.keys(filters).length === 0) {
    return options ?? {};
  }
  return { ...options, filters: { ...options?.filters, ...filters } };
}

/** Shape of the empty answer returned when a `module:` value selects no module. */
const NO_MODULE_RESULT = Object.freeze({
  results: [],
  unfilteredResultCount: 0,
  filters: {},
  totalFilters: {},
  timings: [],
});

/** Class of the hint element rendered under the search dialog's result list. */
export const MODULE_HINT_CLASS = "search-module-hint";

/**
 * Text of the hint shown when a `module:` value selects no module, or a
 * selection yields no results: names up to {@link MODULE_HINT_LIMIT} close modules.
 */
export function moduleHintText(unmatched: readonly string[], suggestions: readonly string[]): string {
  const subject = unmatched.length > 0
    ? `No module matches module:${unmatched.join(" module:")}.`
    : "No results in that module.";
  return suggestions.length > 0 ? `${subject} Try: ${suggestions.join(", ")}` : subject;
}

/**
 * Upsert the hint under the plugin's result list, or remove it. The dialog's
 * `.search-dialog` wrapper is plain markup the plugin never re-renders
 * wholesale, so an appended child survives its result re-renders.
 */
function renderModuleHint(text: string | undefined): void {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) {
    return;
  }
  const dialog = doc.querySelector(".search-dialog");
  if (!dialog) {
    return;
  }
  // The live region stays in the dialog once created, empty when there is nothing
  // to say (the stylesheet collapses it then, keeping it in the accessibility
  // tree): screen readers only announce a polite region that already existed
  // before its text arrived, so the first message is written on the next frame,
  // and an unchanged message is not rewritten, which would re-announce it on
  // every keystroke.
  const next = text ?? "";
  let hint = dialog.querySelector(`.${MODULE_HINT_CLASS}`);
  if (!hint) {
    hint = doc.createElement("div");
    hint.className = MODULE_HINT_CLASS;
    hint.setAttribute("role", "status");
    dialog.appendChild(hint);
    if (next) {
      const created = hint;
      const defer = globalThis.requestAnimationFrame ?? ((fn: () => void) => setTimeout(fn, 0));
      defer(() => {
        if (created.isConnected && created.textContent !== next) {
          created.textContent = next;
        }
      });
    }
    return;
  }
  if (hint.textContent !== next) {
    hint.textContent = next;
  }
}

/**
 * Resolve the parsed query against the engine: `module:` values become the
 * Pagefind filter (exact or any-of), `kind:` stays exact. Returns `null`
 * when a module value selected nothing -- the caller answers empty instead
 * of searching -- and the hint text to render, if any.
 */
async function resolveQuery(
  handle: SearchHandleLike,
  raw: string,
): Promise<{ text: string | null; filters: Record<string, FilterValues>; hint?: string; empty: boolean }> {
  const parsed = parseSearchQuery(raw);
  const filters: Record<string, FilterValues> = { ...parsed.filters };
  let hint: string | undefined;
  let empty = false;
  if (parsed.filters.module) {
    const known = await knownModules(handle);
    const resolution = resolveModules(parsed.filters.module, known);
    if (resolution.filter) {
      filters.module = resolution.filter;
    } else {
      delete filters.module;
      empty = true;
    }
    if (resolution.unmatched.length > 0 && known) {
      hint = moduleHintText(resolution.unmatched, closeModules(resolution.unmatched[0], known));
    }
  }
  return { text: parsed.text || null, filters, hint, empty };
}

/** After a search: a selected module that returned nothing gets the hint too. */
async function hintForEmptyResults(
  handle: SearchHandleLike,
  raw: string,
  search: unknown,
): Promise<string | undefined> {
  const parsed = parseSearchQuery(raw);
  const results = (search as SearchResultLike | null)?.results;
  if (!parsed.filters.module || !Array.isArray(results) || results.length > 0) {
    return undefined;
  }
  const known = await knownModules(handle);
  return known ? moduleHintText([], closeModules(parsed.filters.module[0], known)) : undefined;
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
  const run = async (
    raw: string,
    search: (text: string | null, options: SearchOptions) => Promise<unknown>,
    options: SearchOptions | undefined,
  ): Promise<unknown> => {
    const query = await resolveQuery(handle, raw);
    if (query.empty) {
      renderModuleHint(query.hint);
      return { ...NO_MODULE_RESULT };
    }
    const result = await search(query.text, mergeOptions(options, query.filters));
    renderModuleHint(query.hint ?? (await hintForEmptyResults(handle, raw, result)));
    return limitSearchCandidates(result);
  };
  if (typeof handle.search === "function") {
    wrapped.search = (text, options) =>
      run(text ?? "", (q, o) => handle.search!.call(handle, q, o), options);
  }
  if (typeof handle.debouncedSearch === "function") {
    wrapped.debouncedSearch = (text, options, delay) =>
      run(text ?? "", (q, o) => handle.debouncedSearch!.call(handle, q, o, delay), options);
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
