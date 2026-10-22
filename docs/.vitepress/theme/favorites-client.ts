// Search-result boosting for favorites. The Pagefind plugin serializes its
// search config to JSON, so function hooks (`sort`) cannot be configured from
// config.mts. Instead we trap the `window.__pagefind__` handle the plugin lazily
// installs and wrap `debouncedSearch` so starred pages are reordered to the top
// before the plugin renders the list. Result identity is untouched — only array
// order changes — so click/keyboard navigation stays consistent.
import {
  apiPathFrom,
  favoritesStore,
  FavoritesStore,
  rankFavoritesFirst,
} from "./favorites";
import {
  MAX_SEARCH_RESULTS,
  withQueryFilters,
} from "./search-client";

interface PagefindResult {
  data(): Promise<{ url?: string }>;
}

interface PagefindSearch {
  results?: PagefindResult[];
  [key: string]: unknown;
}

interface PagefindHandle {
  debouncedSearch?(...args: unknown[]): Promise<PagefindSearch | null>;
}

export function withFavoritesSearchBoost(
  rawHandle: PagefindHandle,
  store: FavoritesStore = favoritesStore(),
): PagefindHandle {
  // Query-token filters first: `module:` / `kind:` tokens become real Pagefind
  // filters and trim the ranked match set to the bounded candidate pool.
  const handle = withQueryFilters(rawHandle);
  const original = handle?.debouncedSearch;
  if (typeof original !== "function") {
    return handle;
  }
  return {
    ...handle,
    debouncedSearch: async (...args: unknown[]) => {
      const search = await original.apply(handle, args);
      const results = search?.results;
      if (!results) {
        return search;
      }
      const displayResults = () => ({
        ...search,
        results: results.slice(0, MAX_SEARCH_RESULTS),
      });
      if (results.length < 2) {
        return displayResults();
      }
      try {
        if (store.list().length === 0) {
          return displayResults();
        }
        const datas = await Promise.all(results.map((r) => r.data()));
        const starred = new Set(
          results.filter((_, i) => {
            const path = apiPathFrom(datas[i]?.url ?? "");
            return path !== undefined && store.isFavorite(path);
          }),
        );
        return {
          ...search,
          results: rankFavoritesFirst(results, (r) => starred.has(r)).slice(
            0,
            MAX_SEARCH_RESULTS,
          ),
        };
      } catch {
        return displayResults(); // boosting is best-effort; never break search
      }
    },
  };
}

/**
 * Trap `window.__pagefind__` so every search handle the plugin installs
 * gets favorites-aware result ordering. Idempotent, client-only.
 */
export function installFavoritesSearchBoost(): void {
  if (typeof window === "undefined") {
    return;
  }
  const win = window as unknown as Record<string, unknown>;
  if (win.__cdkDocsFavoritesBoost) {
    return;
  }
  win.__cdkDocsFavoritesBoost = true;

  let handle = win.__pagefind__
    ? withFavoritesSearchBoost(win.__pagefind__ as PagefindHandle)
    : undefined;
  Object.defineProperty(window, "__pagefind__", {
    configurable: true,
    get: () => handle,
    set: (value: PagefindHandle) => {
      handle = withFavoritesSearchBoost(value);
    },
  });

  // Shared handle for other components (e.g. the navbar type-ahead filter) to
  // read and boost by starred status.
  win.__cdkDocsFavorites = favoritesStore();

  // Cross-tab sync: another tab starring a page updates this one.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith("cdk-docs:favourites")) {
      favoritesStore().reload();
    }
  });
}
