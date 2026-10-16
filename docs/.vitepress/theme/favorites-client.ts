// Search-result boosting for favorites. The Pagefind plugin serializes its
// search config to JSON, so function hooks (`sort`) cannot be configured from
// config.mts. Instead we trap the `window.__pagefind__` handle the plugin lazily
// installs and wrap `debouncedSearch` so starred pages are reordered to the top
// before the plugin renders the list. Result identity is untouched — only array
// order changes — so click/keyboard navigation stays consistent.
import {
  apiPathFrom,
  favoritesStore,
  rankFavoritesFirst,
} from "./favorites";
import { withQueryFilters } from "./search-client";

interface PagefindResult {
  data(): Promise<{ url?: string }>;
}

interface PagefindSearch {
  results?: PagefindResult[];
}

interface PagefindHandle {
  debouncedSearch?(...args: unknown[]): Promise<PagefindSearch | null>;
}

function wrapHandle(rawHandle: PagefindHandle): PagefindHandle {
  // Query-token filters first: `module:` / `kind:` tokens become real Pagefind
  // filters before favorites boosting reorders.
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
      if (!results || results.length < 2) {
        return search;
      }
      try {
        const store = favoritesStore();
        if (store.list().length === 0) {
          return search;
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
          results: rankFavoritesFirst(results, (r) => starred.has(r)),
        };
      } catch {
        return search; // boosting is best-effort; never break search
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
    ? wrapHandle(win.__pagefind__ as PagefindHandle)
    : undefined;
  Object.defineProperty(window, "__pagefind__", {
    configurable: true,
    get: () => handle,
    set: (value: PagefindHandle) => {
      handle = wrapHandle(value);
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
