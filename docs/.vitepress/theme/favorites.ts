// Client-side "favorite" pages. Users star API pages; stars persist in
// localStorage, surface in a sidebar section, and boost search results.
// Dependency-free (no vitepress imports) so the logic is testable under Jest.
import { API_DOCS_ROOT, API_ROOT } from "../../../src/site-routes";
import categories from "./favorite-categories.json";

/**
 * A starred page. `path` is the base-stripped route (no `.html`).
 *
 * `group` is the reader's own placement and wins over the category map: a
 * string is that group and `null` is their own move to Ungrouped. An absent
 * field means the map decides; when the map has a category it is written back
 * on the next read, and when it has none the field stays absent and the
 * favorite shows in Ungrouped, so a category added later still reaches it.
 */
export interface FavoriteEntry {
  path: string;
  title: string;
  group?: string | null;
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
 * Group names the reader made or renamed to. Stored so a group with no
 * favorites in it stays alive; names that only come from the category map are
 * not listed here, because the map recreates them.
 */
export const GROUPS_STORAGE_KEY = "cdk-docs:favourites:groups";

/**
 * Map group name to the name the reader renamed it to, e.g. `Compute` ->
 * `Servers`. Read whenever the map places a favorite, so the reader's name
 * follows the map group instead of a second group appearing beside it.
 */
export const ALIASES_STORAGE_KEY = "cdk-docs:favourites:aliases";

/** Names of the groups the reader folded in the Favorites view. */
export const COLLAPSED_GROUPS_STORAGE_KEY = "cdk-docs:favourites:collapsed-groups";

/** The group of a favorite the map cannot place, and of one the reader moved out of every group. */
export const UNGROUPED = "Ungrouped";

/** A group name is trimmed and at most this long. */
export const GROUP_NAME_MAX_LENGTH = 40;

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

/** Canonical page path: strips a trailing `.html` and `index` suffix. */
export function normalizePath(path: string): string {
  return path.replace(/\.html$/, "").replace(/\/index$/, "/");
}

/**
 * Base-agnostic page path for an arbitrary URL (e.g. a Pagefind result
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

/** Every category name the map can produce, in display order. */
export const CATEGORY_NAMES: readonly string[] = categories.categories;

const CATEGORY_MAP: Readonly<Record<string, string>> = categories.map;

/**
 * Page id of an API page path: the file stem docgen names the page by, with
 * `.html` and a `-readme` suffix dropped. Undefined for anything that is not a
 * documentation page, such as the API front page.
 */
export function pageId(path: string): string | undefined {
  const normalized = normalizePath(path);
  if (!normalized.startsWith(API_DOCS_ROOT)) {
    return undefined;
  }
  const id = normalized.slice(API_DOCS_ROOT.length).replace(/-readme$/, "");
  return id === "" || id.includes("/") ? undefined : id;
}

/**
 * The category the map gives a page, or undefined when it has none.
 *
 * The id's first dot-part is the package, with the first `_` of a scoped name
 * standing for `/` (`@aws-cdk_aws-bedrock-alpha`). A second part that starts
 * lowercase is a submodule and is looked up with the package; anything else
 * (a type name) falls back to the package alone.
 */
export function categoryFor(path: string): string | undefined {
  const id = pageId(path);
  if (!id) {
    return undefined;
  }
  const parts = id.split(".");
  const pkg = parts[0].startsWith("@")
    ? parts[0].replace("_", "/")
    : parts[0];
  if (parts.length > 1 && /^[a-z]/.test(parts[1])) {
    return CATEGORY_MAP[`${pkg}.${parts[1]}`];
  }
  return CATEGORY_MAP[pkg];
}

/** One entry of the Explorer's Framework or Services list, as the sidebar skeleton carries it. */
export interface ServiceListEntry {
  readonly text: string;
  readonly label?: string;
  readonly modules?: readonly string[];
}

/**
 * The name the Explorer's Services (or Framework) list shows for a page, so
 * the two lists always agree on what a page's service is called.
 *
 * An entry owns a page when one of its module stems is the page id or a dot
 * prefix of it. The longest stem wins, because the Framework `aws-cdk-lib`
 * entry owns every root type while `aws-cdk-lib.aws_sqs` owns the SQS pages.
 */
export function serviceNameFor(
  path: string,
  sections: readonly { readonly items?: readonly ServiceListEntry[] }[],
): string | undefined {
  const id = pageId(path);
  if (!id) {
    return undefined;
  }
  let best: { length: number; name: string } | undefined;
  for (const section of sections) {
    for (const entry of section.items ?? []) {
      for (const stem of entry.modules ?? []) {
        if (id !== stem && !id.startsWith(`${stem}.`)) {
          continue;
        }
        if (!best || stem.length > best.length) {
          best = { length: stem.length, name: entry.label ?? entry.text };
        }
      }
    }
  }
  return best?.name;
}

/** A group of the Favorites view: its name and its favorites, both already in display order. */
export interface FavoriteGroup {
  name: string;
  entries: readonly FavoriteEntry[];
}

/** Why a group name was refused. `ok` means it can be used. */
export type GroupNameCheck = "ok" | "empty" | "reserved" | "too-long" | "duplicate";

/** The favorites, reader groups and aliases an action changed, which Undo puts back; folds are not part of it. */
export interface FavoritesUndo {
  entries: readonly FavoriteEntry[];
  groups: readonly string[];
  aliases: Readonly<Record<string, string>>;
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function byName(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

export type FavoritesListener = (entries: readonly FavoriteEntry[]) => void;

export class FavoritesStore {
  private entries: FavoriteEntry[];
  private groups: string[];
  private aliases: Record<string, string>;
  private collapsedGroups: string[];
  private changes = 0;
  private readonly listeners = new Set<FavoritesListener>();

  constructor(private readonly storage?: StorageLike) {
    this.groups = this.readGroups();
    this.aliases = this.readAliases();
    this.collapsedGroups = this.readCollapsedGroups();
    this.entries = this.read();
    this.placeUnplaced();
  }

  list(): readonly FavoriteEntry[] {
    return this.entries;
  }

  /**
   * How many times the favorites, the groups or the aliases have changed. An
   * Undo offer records this and is withdrawn once it moves, so Undo can never
   * take back a change made after the action it offers to reverse. Folding a
   * group does not count, here or in another tab: it changes no favorite.
   */
  revision(): number {
    return this.changes;
  }

  isFavorite(path: string): boolean {
    const key = normalizePath(path);
    return this.entries.some((e) => e.path === key);
  }

  /** Returns false only when the entry is already starred; there is no cap. */
  add(entry: FavoriteEntry): boolean {
    const path = normalizePath(entry.path);
    if (this.isFavorite(path)) {
      return false;
    }
    const placedEntry = this.placed({ path, title: entry.title });
    this.entries = [...this.entries, placedEntry];
    // A folded group would hide the favorite that was just added.
    this.unfold(this.groupOf(placedEntry));
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
   * Star or unstar a page. `favorited` is the resulting state; `rejected`
   * is always false, since there is no cap.
   */
  toggle(entry: FavoriteEntry): { favorited: boolean; rejected: boolean } {
    if (this.isFavorite(entry.path)) {
      this.remove(entry.path);
      return { favorited: false, rejected: false };
    }
    const added = this.add(entry);
    return { favorited: added, rejected: !added };
  }

  /** The group a favorite shows under: its own when placed, else the map's, else Ungrouped. */
  groupOf(entry: FavoriteEntry): string {
    if (entry.group === null) {
      return UNGROUPED;
    }
    if (typeof entry.group === "string" && entry.group !== "") {
      return entry.group;
    }
    return this.mappedGroup(entry.path);
  }

  /**
   * The view's groups: A to Z by name with Ungrouped last, each holding its
   * favorites A to Z by title. A group the reader made stays listed while
   * empty; Ungrouped shows only when something is in it.
   */
  grouped(): FavoriteGroup[] {
    const buckets = new Map<string, FavoriteEntry[]>();
    for (const name of this.groups) {
      buckets.set(name, []);
    }
    for (const entry of this.entries) {
      const name = this.groupOf(entry);
      const bucket = buckets.get(name);
      if (bucket) {
        bucket.push(entry);
      } else {
        buckets.set(name, [entry]);
      }
    }
    const named = [...buckets.entries()]
      .filter(([name]) => name !== UNGROUPED)
      .sort(([a], [b]) => byName(a, b));
    const ungrouped = buckets.get(UNGROUPED) ?? [];
    const all = ungrouped.length > 0 ? [...named, [UNGROUPED, ungrouped] as const] : named;
    return all.map(([name, entries]) => ({
      name,
      entries: [...entries].sort((a, b) => byName(a.title, b.title)),
    }));
  }

  /** Group names a favorite can be moved into, in the order the menu shows them. */
  groupNames(): string[] {
    const names = new Set(this.grouped().map((g) => g.name));
    names.delete(UNGROUPED);
    return [...names].sort(byName);
  }

  /** Whether `name` can be used for a new group, or for renaming `exclude`. */
  checkGroupName(name: string, exclude?: string): GroupNameCheck {
    const trimmed = name.trim();
    if (trimmed === "") {
      return "empty";
    }
    if (sameName(trimmed, UNGROUPED)) {
      return "reserved";
    }
    if (trimmed.length > GROUP_NAME_MAX_LENGTH) {
      return "too-long";
    }
    const taken = this.groupNames().some(
      (existing) =>
        sameName(existing, trimmed) && !(exclude && sameName(existing, exclude)),
    );
    return taken ? "duplicate" : "ok";
  }

  /** Add an empty group the reader made. Returns false when the name is refused. */
  createGroup(name: string): boolean {
    if (this.checkGroupName(name) !== "ok") {
      return false;
    }
    this.groups = [...this.groups, name.trim()];
    this.persist();
    return true;
  }

  /** Put a favorite in a group, or in Ungrouped with `null`. The map is not asked for it again. */
  move(path: string, group: string | null): boolean {
    const key = normalizePath(path);
    const target = group === null ? null : group.trim();
    let moved = false;
    this.entries = this.entries.map((entry) => {
      if (entry.path !== key || this.groupOf(entry) === (target ?? UNGROUPED)) {
        return entry;
      }
      moved = true;
      return { ...entry, group: target };
    });
    if (moved) {
      this.unfold(target ?? UNGROUPED);
      this.persist();
    }
    return moved;
  }

  /**
   * Rename a group, carrying its favorites with it.
   *
   * A group the map produces also gets an alias, so a page the map puts there
   * later joins the reader's name instead of recreating the old one. Renaming
   * back to the map's own name drops the alias again.
   */
  renameGroup(from: string, to: string): FavoritesUndo | undefined {
    const trimmed = to.trim();
    // The same name is no rename: storing it would turn a group the map
    // produced into one of the reader's own, which outlives its last favorite.
    // Exact, so a rename that changes only the case still goes through.
    if (trimmed === from) {
      return undefined;
    }
    if (!this.groupNames().some((n) => sameName(n, from))) {
      return undefined;
    }
    if (this.checkGroupName(trimmed, from) !== "ok") {
      return undefined;
    }
    const undo = this.snapshot();
    const origins = this.mapOriginsOf(from);
    this.entries = this.entries.map((entry) =>
      this.groupOf(entry) === from ? { ...entry, group: trimmed } : entry,
    );
    this.groups = [
      ...this.groups.filter((n) => !sameName(n, from)),
      trimmed,
    ];
    // The fold is the reader's choice about this group, so it follows the name.
    this.collapsedGroups = this.collapsedGroups.map((n) => (n === from ? trimmed : n));
    this.write(COLLAPSED_GROUPS_STORAGE_KEY, this.collapsedGroups);
    for (const origin of origins) {
      // Exact, so a case-only rename keeps an alias, pointing at the new
      // spelling.
      if (origin === trimmed) {
        delete this.aliases[origin];
      } else {
        this.aliases[origin] = trimmed;
      }
    }
    this.persist();
    return undo;
  }

  /**
   * Delete a group: its favorites go to Ungrouped and its alias is dropped, so
   * the next page the map puts there creates the map's own group again.
   */
  deleteGroup(name: string): FavoritesUndo | undefined {
    if (name === UNGROUPED || !this.grouped().some((g) => g.name === name)) {
      return undefined;
    }
    const undo = this.snapshot();
    this.entries = this.entries.map((entry) =>
      this.groupOf(entry) === name ? { ...entry, group: null } : entry,
    );
    this.groups = this.groups.filter((n) => !sameName(n, name));
    // Or a group recreated under the same name would come back folded.
    this.unfold(name);
    for (const origin of this.mapOriginsOf(name)) {
      delete this.aliases[origin];
    }
    this.persist();
    return undo;
  }

  /** How many favorites a group holds, for the toast that reports a delete. */
  countIn(name: string): number {
    return this.entries.filter((entry) => this.groupOf(entry) === name).length;
  }

  /** A record of the current state, to hand back to {@link restore}. */
  snapshot(): FavoritesUndo {
    return {
      entries: this.entries.map((entry) => ({ ...entry })),
      groups: [...this.groups],
      aliases: { ...this.aliases },
    };
  }

  /** Put back a state {@link snapshot} recorded, which is what Undo does. */
  restore(undo: FavoritesUndo): void {
    this.entries = undo.entries.map((entry) => ({ ...entry }));
    this.groups = [...undo.groups];
    this.aliases = { ...undo.aliases };
    this.persist();
  }

  /** Whether the reader folded this group. */
  isGroupCollapsed(name: string): boolean {
    return this.collapsedGroups.some((n) => n === name);
  }

  /** Unfold a group, so what just landed in it is in sight. */
  private unfold(name: string): void {
    if (!this.collapsedGroups.includes(name)) {
      return;
    }
    this.collapsedGroups = this.collapsedGroups.filter((n) => n !== name);
    this.write(COLLAPSED_GROUPS_STORAGE_KEY, this.collapsedGroups);
  }

  /** Fold or unfold a group, saved by name. */
  setGroupCollapsed(name: string, collapsed: boolean): void {
    const next = this.collapsedGroups.filter((n) => n !== name);
    this.collapsedGroups = collapsed ? [...next, name] : next;
    this.write(COLLAPSED_GROUPS_STORAGE_KEY, this.collapsedGroups);
    this.notify();
  }

  /** Re-read from storage (cross-tab `storage` event sync). */
  reload(): void {
    // Every `cdk-docs:favourites*` key reaches here, folding included, so the
    // revision moves only when what Undo would restore actually differs.
    const before = JSON.stringify(this.snapshot());
    this.groups = this.readGroups();
    this.aliases = this.readAliases();
    this.collapsedGroups = this.readCollapsedGroups();
    this.entries = this.read();
    this.placeUnplaced();
    if (JSON.stringify(this.snapshot()) !== before) {
      this.changes += 1;
    }
    this.notify();
  }

  subscribe(listener: FavoritesListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The map's group for a page, under the reader's name for it when they renamed it. */
  private mappedGroup(path: string): string {
    const category = categoryFor(path);
    return category ? this.mapName(category) : UNGROUPED;
  }

  /**
   * The name a category appears under: the reader's alias when they renamed
   * it, and the spelling of an existing group that differs only in case, so
   * `compute` and `Compute` cannot end up side by side.
   */
  private mapName(category: string): string {
    const name = this.aliases[category] ?? category;
    return this.groups.find((existing) => sameName(existing, name)) ?? name;
  }

  /** Map categories whose favorites currently land in `name`, so a rename or delete can follow the alias. */
  private mapOriginsOf(name: string): string[] {
    const origins = new Set<string>();
    for (const [category, alias] of Object.entries(this.aliases)) {
      if (sameName(alias, name)) {
        origins.add(category);
      }
    }
    if (CATEGORY_NAMES.some((category) => sameName(category, name))) {
      const canonical = CATEGORY_NAMES.find((category) => sameName(category, name));
      if (canonical && !this.aliases[canonical]) {
        origins.add(canonical);
      }
    }
    return [...origins];
  }

  /**
   * The entry with the map's category written onto it. A page the map cannot
   * place keeps no `group` at all, so a category added to the map later still
   * reaches it; `null` is reserved for the reader's own move to Ungrouped.
   */
  private placed(entry: FavoriteEntry): FavoriteEntry {
    if (entry.group !== undefined) {
      return entry;
    }
    const category = categoryFor(entry.path);
    if (!category) {
      return entry;
    }
    return { ...entry, group: this.mapName(category) };
  }

  /** Give the entries the map can place their group, and write the result back once. */
  private placeUnplaced(): void {
    const next = this.entries.map((entry) => this.placed(entry));
    if (next.every((entry, index) => entry === this.entries[index])) {
      return;
    }
    this.entries = next;
    this.write(STORAGE_KEY, this.entries);
  }

  private read(): FavoriteEntry[] {
    const parsed = this.readArray(STORAGE_KEY);
    return parsed
      .filter(
        (e): e is FavoriteEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as FavoriteEntry).path === "string" &&
          typeof (e as FavoriteEntry).title === "string",
      )
      .map((e) => {
        const entry: FavoriteEntry = {
          path: normalizePath(e.path),
          title: e.title,
        };
        if (e.group === null || (typeof e.group === "string" && e.group !== "")) {
          entry.group = e.group;
        }
        return entry;
      });
  }

  private readGroups(): string[] {
    const names = this.readArray(GROUPS_STORAGE_KEY).filter(
      (n): n is string => typeof n === "string" && n.trim() !== "",
    );
    const seen: string[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!sameName(trimmed, UNGROUPED) && !seen.some((n) => sameName(n, trimmed))) {
        seen.push(trimmed);
      }
    }
    return seen;
  }

  private readAliases(): Record<string, string> {
    try {
      const raw = this.storage?.getItem(ALIASES_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.trim() !== "") {
          out[key] = value.trim();
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  private readCollapsedGroups(): string[] {
    return this.readArray(COLLAPSED_GROUPS_STORAGE_KEY).filter(
      (n): n is string => typeof n === "string",
    );
  }

  private readArray(key: string): unknown[] {
    try {
      const raw = this.storage?.getItem(key);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    this.changes += 1;
    this.write(STORAGE_KEY, this.entries);
    this.write(GROUPS_STORAGE_KEY, this.groups);
    this.write(ALIASES_STORAGE_KEY, this.aliases);
    this.notify();
  }

  private write(key: string, value: unknown): void {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable: favorites stay in-memory this session.
    }
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
