/**
 * Per-route sidebar scroll memory.
 *
 * The API sidebar is an inner scroller (`aside.VPSidebar`), so the browser never
 * restores its scroll position itself. This module remembers the sidebar
 * `scrollTop` per route path so the `ApiSidebar` component can leave scroll
 * untouched on forward navigation and restore the remembered position on history
 * traversal and full page loads.
 *
 * Backed by `sessionStorage` when available, with an in-memory fallback.
 * Framework-free (no Vue, no DOM at import time) so it is unit-testable in Node.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ScrollMemory {
  /** Remembered scrollTop for a route path, if any. */
  get(path: string): number | undefined;
  /** Remember the scrollTop for a route path. */
  save(path: string, scrollTop: number): void;
}

/** sessionStorage key holding the serialized route -> scrollTop map. */
export const SCROLL_STORE_KEY = 'cdk-docs-sidebar-scroll';

/** Most-recently-saved routes kept; older entries are evicted. */
const DEFAULT_CAP = 50;

type Entries = [string, number][];

function readEntries(storage: StorageLike | undefined, key: string): Entries {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is [string, number] =>
        Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number',
    );
  } catch {
    // Corrupt JSON or a storage access error: start fresh.
    return [];
  }
}

/**
 * Create a scroll memory over the given storage. Entries are kept in
 * least-recently-saved order and trimmed to `cap`; every operation tolerates
 * a throwing or absent storage (private mode, quota) by degrading to the
 * in-memory map.
 */
export function createScrollMemory(
  storage: StorageLike | undefined,
  key = SCROLL_STORE_KEY,
  cap = DEFAULT_CAP,
): ScrollMemory {
  const map = new Map<string, number>(readEntries(storage, key));

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify([...map.entries()]));
    } catch {
      // Quota/permission failure: keep the in-memory copy working.
    }
  }

  return {
    get(path: string): number | undefined {
      return map.get(path);
    },
    save(path: string, scrollTop: number): void {
      // Delete-then-set keeps Map insertion order = recency order.
      map.delete(path);
      map.set(path, scrollTop);
      while (map.size > cap) {
        const oldest = map.keys().next().value as string;
        map.delete(oldest);
      }
      persist();
    },
  };
}

/**
 * A frame-throttled recorder for the sidebar's scroll position. The caller passes
 * the route and position as values captured at event time, so neither can be
 * re-read late; one `save` runs per scheduled flush, carrying the last pair
 * recorded within it. `schedule` is injected for testing.
 */
export function createThrottledScrollSaver(
  save: (path: string, scrollTop: number) => void,
  schedule: (flush: () => void) => void,
): (path: string, scrollTop: number) => void {
  let scheduled = false;
  let pending: { path: string; scrollTop: number } | null = null;
  return function record(path: string, scrollTop: number): void {
    pending = { path, scrollTop };
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      const latest = pending;
      pending = null;
      if (latest) save(latest.path, latest.scrollTop);
    });
  };
}

/**
 * scrollTop that vertically centers an item inside its scroll container
 * (clamped at 0; the browser clamps the far end itself). `itemOffset` is the
 * item's top relative to the container's content (rect delta + scrollTop).
 */
export function centeredScrollTop(
  itemOffset: number,
  itemHeight: number,
  containerHeight: number,
): number {
  return Math.max(0, Math.round(itemOffset - (containerHeight - itemHeight) / 2));
}

/** Minimal rect shape, so this is testable without a DOM. */
export interface VerticalBox {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

/**
 * Whether `item` sits fully inside `container` vertically.
 *
 * Pure geometry; it assumes the caller has already established that `item` has
 * geometry (see {@link revealScrollTop}). A zero-size rect at the origin is
 * contained by any container starting at or above y=0, so answering the "has a
 * box at all" question here would let a hidden element look visible.
 */
export function isFullyVisible(item: VerticalBox, container: VerticalBox): boolean {
  return item.top >= container.top && item.bottom <= container.bottom;
}

/**
 * The `scrollTop` that would bring `item` into view inside `container`, or `null`
 * when no scroll should happen. Three distinct reasons for `null`:
 *
 * - **No box.** A `display: none` element (a collapsed group keeps its
 *   descendants in the DOM; a closed mobile drawer hides the whole tree) reports
 *   a zero-size rect at the origin. Computing a target from it would scroll
 *   somewhere arbitrary; retry once it has geometry.
 * - **Zero height.** Same argument, independent of `laidOut`.
 * - **Already visible.** Nothing to do; leaving the position alone preserves the
 *   reader's own scrolling.
 */
export function revealScrollTop(
  item: VerticalBox,
  container: VerticalBox,
  laidOut: boolean,
  scrollTop: number,
  clientHeight: number,
): number | null {
  if (!laidOut || item.height <= 0) {
    return null;
  }
  if (isFullyVisible(item, container)) {
    return null;
  }
  return centeredScrollTop(item.top - container.top + scrollTop, item.height, clientHeight);
}
