/**
 * Persistent API-sidebar disclosure memory. Remembers the tree's open/closed
 * state across reloads and full page loads.
 *
 * What is stored is the reader's explicit choices, not the effective open set:
 *
 * - Only `toggle()` writes here. The auto-reveal path (unfolding the active
 *   page's ancestors) must not, or visiting one deep page would pin its whole
 *   ancestor chain open and the store would grow with every page visited.
 * - A choice is tri-state per key: opened, closed, or never touched. A plain
 *   "set of open keys" cannot express "the reader closed a group the tree opens
 *   by default", so collapsing one would silently un-collapse on reload.
 *
 * `localStorage`, so the choice survives a browser restart and a new tab. The
 * key is versioned so a later format change can be ignored by old builds.
 *
 * Framework-free (no Vue, no DOM at import time) so it is unit-testable in Node.
 */

/** Minimal Storage surface so tests can inject a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage key holding the serialized key -> open map. */
export const EXPANDED_STORE_KEY = 'cdk-docs:sidebar-expanded:v1';

/**
 * Cap on remembered keys. Generous next to the handful of groups a reader
 * toggles by hand, but bounded so the stored payload cannot grow without limit.
 */
export const DEFAULT_CAP = 200;

export interface CollapseMemory {
  /** The reader's explicit choice for a key, or undefined if untouched. */
  get(key: string): boolean | undefined;
  /** Record an explicit toggle. Evicts the least recently set key at the cap. */
  set(key: string, open: boolean): void;
  /** Every explicit choice, least-recently-set first. */
  entries(): [string, boolean][];
  /** Forget keys absent from `validKeys` (renamed or removed modules). */
  prune(validKeys: ReadonlySet<string>): void;
}

type Entries = [string, boolean][];

/**
 * Read the shared store. Returns `null` — distinct from an empty list — when the
 * storage itself is unreadable, so a caller re-syncing before a write can tell
 * "nobody has stored anything" from "we cannot see the store".
 */
function readEntries(storage: StorageLike | undefined, key: string): Entries | null {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is [string, boolean] =>
        Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'boolean',
    );
  } catch {
    // A storage access error. Corrupt JSON yields an empty list above; the
    // sidebar is on every API page, so this must never throw.
    return null;
  }
}

/**
 * Create a disclosure memory over the given storage. Entries are kept in
 * least-recently-set order and trimmed to `cap`; every operation tolerates a
 * throwing or absent storage by degrading to an in-memory map.
 *
 * The store is shared by every open tab, so each read and each mutation
 * re-syncs from it first, otherwise the second tab to write would erase the
 * first tab's choice.
 */
export function createCollapseMemory(
  storage: StorageLike | undefined,
  key = EXPANDED_STORE_KEY,
  cap = DEFAULT_CAP,
): CollapseMemory {
  let map = new Map<string, boolean>(readEntries(storage, key) ?? []);
  // Cleared once a write fails: from then on the in-memory map is the only copy
  // with our choices, so re-syncing from the store would drop them.
  let shared = Boolean(storage);
  trim();

  function trim(): void {
    while (map.size > cap) {
      const oldest = map.keys().next().value as string;
      map.delete(oldest);
    }
  }

  /** Adopt whatever every tab has stored, keeping the store authoritative. */
  function resync(): void {
    if (!shared) return;
    const stored = readEntries(storage, key);
    if (!stored) return;
    map = new Map<string, boolean>(stored);
    trim();
  }

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify([...map.entries()]));
    } catch {
      // Quota/permission failure: keep the in-memory copy working, and stop
      // treating the store as the source of truth for this instance.
      shared = false;
    }
  }

  return {
    get(k: string): boolean | undefined {
      resync();
      return map.get(k);
    },
    set(k: string, open: boolean): void {
      resync();
      // Delete-then-set keeps Map insertion order = recency order, so the
      // cap evicts the choice the reader touched longest ago.
      map.delete(k);
      map.set(k, open);
      trim();
      persist();
    },
    entries(): Entries {
      resync();
      return [...map.entries()];
    },
    prune(validKeys: ReadonlySet<string>): void {
      resync();
      let dropped = false;
      for (const k of [...map.keys()]) {
        if (!validKeys.has(k)) {
          map.delete(k);
          dropped = true;
        }
      }
      if (dropped) persist();
    },
  };
}

/**
 * The effective open set: the generated tree's defaults, with the reader's
 * explicit choices layered on top. An explicitly closed default drops out; an
 * explicitly opened group is added. Auto-reveal of the active page's ancestors
 * is unioned in separately by the caller and is not stored, so it can still
 * unfold a group the reader closed.
 */
export function effectiveExpanded(
  defaults: Iterable<string>,
  explicit: Iterable<[string, boolean]>,
): Set<string> {
  const open = new Set(defaults);
  for (const [key, isOpen] of explicit) {
    if (isOpen) open.add(key);
    else open.delete(key);
  }
  return open;
}
