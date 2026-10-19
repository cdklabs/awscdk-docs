// Client-side "favorite" pages. Users star API pages; stars persist in
// localStorage, surface in a sidebar section, and boost search results.
// Dependency-free (no vitepress imports) so the logic is testable under Jest.
import { API_ROOT } from "../../../src/site-routes";

/** A starred page. `path` is the base-stripped route (no `.html`). */
export interface FavoriteEntry {
  path: string;
  title: string;
}

/** Minimal Storage surface so tests can inject a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEY = "cdk-docs:favourites";

/**
 * Collapsed/expanded state of the sidebar favorites section. A separate key
 * from STORAGE_KEY (which holds the entry array) to avoid an on-disk format
 * migration. `localStorage`, so the choice survives a reload.
 */
export const COLLAPSED_STORAGE_KEY = "cdk-docs:favourites:collapsed";

/**
 * Whether the section should render collapsed. Collapsed is the default, so a
 * first visit gives the nav tree the vertical space. Anything unrecognized in
 * storage reads as collapsed rather than throwing or flipping open.
 */
export function readCollapsed(storage?: StorageLike): boolean {
  try {
    return storage?.getItem(COLLAPSED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Persist the user's disclosure choice. */
export function writeCollapsed(collapsed: boolean, storage?: StorageLike): void {
  try {
    storage?.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // Storage full or unavailable: the choice holds for this session only.
  }
}

/** Cap keeps the sidebar favorites section manageable. */
export const MAX_FAVORITES = 20;

/** Canonical page path: strips a trailing `.html` and `index` suffix. */
export function normalizePath(path: string): string {
  return path.replace(/\.html$/, "").replace(/\/index$/, "/");
}

/**
 * Base-agnostic page path for an arbitrary URL (e.g. a search result
 * URL that includes the site base). Returns undefined for non-API URLs.
 */
export function apiPathFrom(url: string): string | undefined {
  const start = url.indexOf(API_ROOT);
  if (start < 0) {
    return undefined;
  }
  return normalizePath(url.slice(start).split(/[?#]/)[0]);
}

/** Stable partition: favorites first, original order preserved. */
export function rankFavoritesFirst<T>(
  items: readonly T[],
  isFavorite: (item: T) => boolean,
): T[] {
  const starred: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (isFavorite(item) ? starred : rest).push(item);
  }
  return [...starred, ...rest];
}

export type FavoritesListener = (entries: readonly FavoriteEntry[]) => void;

export class FavoritesStore {
  private entries: FavoriteEntry[];
  private readonly listeners = new Set<FavoritesListener>();

  constructor(private readonly storage?: StorageLike) {
    this.entries = this.read();
  }

  list(): readonly FavoriteEntry[] {
    return this.entries;
  }

  isFavorite(path: string): boolean {
    const key = normalizePath(path);
    return this.entries.some((e) => e.path === key);
  }

  /** Returns false when the entry is already starred or the cap is hit. */
  add(entry: FavoriteEntry): boolean {
    const path = normalizePath(entry.path);
    if (this.isFavorite(path) || this.entries.length >= MAX_FAVORITES) {
      return false;
    }
    this.entries = [...this.entries, { path, title: entry.title }];
    this.persist();
    return true;
  }

  remove(path: string): boolean {
    const key = normalizePath(path);
    const next = this.entries.filter((e) => e.path !== key);
    if (next.length === this.entries.length) {
      return false;
    }
    this.entries = next;
    this.persist();
    return true;
  }

  /**
   * Star or unstar a page. `favorited` is the resulting state;
   * `rejected` is true when an add was refused by the MAX_FAVORITES cap.
   */
  toggle(entry: FavoriteEntry): { favorited: boolean; rejected: boolean } {
    if (this.isFavorite(entry.path)) {
      this.remove(entry.path);
      return { favorited: false, rejected: false };
    }
    const added = this.add(entry);
    return { favorited: added, rejected: !added };
  }

  /** Re-read from storage (cross-tab `storage` event sync). */
  reload(): void {
    this.entries = this.read();
    this.notify();
  }

  subscribe(listener: FavoritesListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private read(): FavoriteEntry[] {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter(
          (e): e is FavoriteEntry =>
            typeof e === "object" &&
            e !== null &&
            typeof (e as FavoriteEntry).path === "string" &&
            typeof (e as FavoriteEntry).title === "string",
        )
        .slice(0, MAX_FAVORITES)
        .map((e) => ({ path: normalizePath(e.path), title: e.title }));
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Storage full or unavailable: favorites stay in-memory this session.
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.entries);
    }
  }
}

let singleton: FavoritesStore | undefined;

/** Shared browser store (memory-only during SSR). */
export function favoritesStore(): FavoritesStore {
  singleton ??= new FavoritesStore(
    typeof localStorage === "undefined" ? undefined : localStorage,
  );
  return singleton;
}
