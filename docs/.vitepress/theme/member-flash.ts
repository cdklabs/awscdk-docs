/**
 * Marks the member row a reader just jumped to. The `:target` tint in
 * api-layout.css only applies when the browser sets `:target`, which it does on
 * a page load with a hash; VitePress handles in-page links and the outline with
 * `pushState` and its own scroll, and back/forward through `popstate`, neither
 * of which moves `:target`. This module puts one class on the landed row for
 * every jump, and the stylesheet draws the flash. Framework-free so the class
 * toggling is unit-testable in plain Node.
 */
import { prefersReducedMotion } from './smooth-scroll.js';

/** Class the stylesheet animates (or, under reduced motion, shows statically). */
export const FLASH_CLASS = 'member-row-flash';
/** Set on `<html>` once the flash is installed; the stylesheet then leaves `:target` to the no-JS case. */
export const READY_CLASS = 'member-flash-ready';
/** Length of the fade, matched by the keyframes in api-layout.css. */
export const FLASH_DURATION_MS = 1500;
/** A repeat click on the current hash within this window is the same click arriving by another event, not a new jump. */
export const SAME_JUMP_MS = 250;

/** The subset of the DOM the helper touches, so a unit test can pass a plain object. */
export interface FlashDocument {
  getElementById(id: string): FlashElement | null;
  querySelectorAll(selector: string): Iterable<FlashElement>;
}

export interface FlashElement {
  readonly classList: {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    contains(name: string): boolean;
  };
  /** True for a member row; the flash is scoped to those. */
  matches(selector: string): boolean;
}

const ROW = '.member-list .member-row';

/** The member row a hash names, or null for an empty hash, a non-member anchor or a missing id. */
export function rowForHash(doc: FlashDocument, hash: string): FlashElement | null {
  if (!hash || hash === '#') {
    return null;
  }
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
  const el = doc.getElementById(id);
  return el && el.matches(ROW) ? el : null;
}

/** Remove the flash from every row that carries it, so one jump marks one row. */
export function clearFlash(doc: FlashDocument): void {
  for (const el of doc.querySelectorAll(`.${FLASH_CLASS}`)) {
    el.classList.remove(FLASH_CLASS);
  }
}

/**
 * Flash the row `hash` names and clear any earlier flash. Returns the row, or
 * null when the hash names no member row (an earlier flash is still cleared,
 * because the reader has moved on). The stylesheet decides what the class
 * draws: a fade, or under reduced motion a static tint that stays until the
 * next jump.
 *
 * Re-adding the class to the same element does not restart a CSS animation, so
 * the class is removed first; the caller's `restart` is what forces a reflow
 * between the two steps in a browser. Tests pass none.
 */
export function flashRow(
  doc: FlashDocument,
  hash: string,
  restart?: (el: FlashElement) => void,
): FlashElement | null {
  const row = rowForHash(doc, hash);
  clearFlash(doc);
  if (!row) {
    return null;
  }
  restart?.(row);
  row.classList.add(FLASH_CLASS);
  return row;
}

/**
 * Collapse the overlapping arrivals of one jump into one flash. A `repeat` is a
 * deliberate click on the hash the page is already at and restarts the fade
 * once `SAME_JUMP_MS` has passed; any other arrival for the row last flashed is
 * the same jump again and is dropped, however late (hydration can take longer
 * than any window). A route reload replaces the row, so a new element for the
 * same hash is a new landing. `now` is injectable for tests.
 */
export function createFlashOnce(
  doc: FlashDocument,
  flash: (hash: string) => void,
  now: () => number = () => performance.now(),
): (hash: string, options?: { repeat?: boolean }) => void {
  let lastHash: string | null = null;
  let lastRow: FlashElement | null = null;
  let lastAt = 0;
  return (hash, { repeat = false } = {}) => {
    const row = rowForHash(doc, hash);
    const at = now();
    const sameRow = row !== null && row === lastRow && hash === lastHash;
    if (sameRow && (!repeat || at - lastAt < SAME_JUMP_MS)) {
      return;
    }
    lastHash = hash;
    lastRow = row;
    lastAt = at;
    flash(hash);
  };
}

/**
 * Wire the flash to the hash events: VitePress's synthetic `hashchange` for
 * in-page links (outline, permalinks, prose links) and the browser's own for
 * back/forward between hashes. A click on a link to the hash the page is
 * already at fires no `hashchange` (VitePress only scrolls), so a bubbling
 * click listener, which runs after VitePress's capture-phase handler, covers
 * that repeat jump. Returns the handler so the theme can call it once the
 * first page has mounted and after each route change, which is how a page load
 * with a hash and a cross-page link that lands on a member are covered.
 *
 * The paths overlap: one click raises `hashchange` and then reaches the click
 * listener, a load with a hash reaches the hook and then the mount, and
 * back/forward raises `popstate` and `hashchange` and then, once the route has
 * reloaded, the hook. `createFlashOnce` drops a second arrival for the row
 * last flashed, and the hashchange of a back/forward is left to the hook, so
 * each jump starts exactly one fade.
 */
export function installMemberFlash(): (hash: string) => void {
  const g = globalThis as { document?: Document; addEventListener?: Window['addEventListener']; location?: Location };
  if (!g.document || !g.addEventListener) {
    return () => {};
  }
  const doc = g.document as unknown as FlashDocument;
  // Reading `offsetWidth` forces a reflow, so a removed-then-added class restarts the keyframes.
  const restart = (el: FlashElement) => void (el as unknown as HTMLElement).offsetWidth;
  const flash = (hash: string) => {
    const row = flashRow(doc, hash, restart) as unknown as HTMLElement | null;
    if (row && !prefersReducedMotion()) {
      // Drop the class once the row's own fade ends, so the next jump starts
      // clean. `animationend` bubbles, so a child's animation is ignored. Under
      // reduced motion nothing animates and the static mark stays until then.
      const done = (e: AnimationEvent) => {
        if (e.target !== row || e.animationName !== FLASH_CLASS) {
          return;
        }
        row.classList.remove(FLASH_CLASS);
        row.removeEventListener('animationend', done);
      };
      row.addEventListener('animationend', done);
    }
  };
  const flashOnce = createFlashOnce(doc, flash);
  // Back/forward: VitePress's popstate handler reloads the route, which replaces
  // the rows, so a flash on the native hashchange that follows would land on a
  // row about to be thrown away. The route hook marks the new row instead.
  let reloading = false;
  g.addEventListener('popstate', (e) => {
    if (e.state !== null) {
      reloading = true;
      setTimeout(() => (reloading = false), 1000);
    }
  });
  g.addEventListener('hashchange', () => {
    if (!reloading) {
      flashOnce(g.location?.hash ?? '');
    }
  });
  g.addEventListener('click', (e) => {
    // The same guards as VitePress's own link handler: a modified or secondary
    // click, or a link that opens elsewhere, is not a jump on this page.
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
      return;
    }
    const link = (e.target as Element | null)?.closest?.('a[href*="#"]') as HTMLAnchorElement | null;
    const loc = g.location;
    if (!link || !loc || link.hasAttribute('target') || link.hasAttribute('download')) {
      return;
    }
    if (link.hash && link.pathname === loc.pathname && link.hash === loc.hash) {
      flashOnce(link.hash, { repeat: true });
    }
  });
  g.document.documentElement.classList.add(READY_CLASS);
  return (hash) => {
    reloading = false;
    flashOnce(hash);
  };
}
