// Keyboard shortcuts for the navbar search. The Pagefind plugin opens its dialog
// on Cmd+K / Ctrl+K and keeps the open state private, so the theme adds `/` by
// clicking the plugin's own trigger button, and announces every shortcut on
// that button through `aria-keyshortcuts`.

/** Every shortcut that opens search, in the `aria-keyshortcuts` grammar. */
export const SEARCH_KEYSHORTCUTS = '/ Control+K Meta+K';

/** The plugin's navbar trigger. */
export const SEARCH_BUTTON_SELECTOR = '.nav-search-btn-wait';

/** The plugin's query input; present only while the dialog is open. */
export const SEARCH_INPUT_ID = 'search-input';

// Browser globals typed structurally so the decision logic unit-tests under the
// node tsconfig, which loads no DOM lib.
export interface HotkeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  isComposing?: boolean;
  getModifierState?(key: string): boolean;
  target: unknown;
}

interface EditableLike {
  tagName?: string;
  isContentEditable?: boolean;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when typing into `target` would edit text, so `/` must stay a character. */
export function isEditableTarget(target: unknown): boolean {
  const el = target as EditableLike | null;
  if (!el || typeof el !== 'object') {
    return false;
  }
  return EDITABLE_TAGS.has(el.tagName ?? '') || el.isContentEditable === true;
}

/**
 * Whether a keydown is the plain `/` shortcut: no modifier, focus outside every
 * editable element, and the dialog not already open. AltGr reports as Ctrl+Alt
 * on Windows yet types a plain character, so it does not count as a modifier.
 */
export function isSearchHotkey(event: HotkeyEvent, dialogOpen: boolean): boolean {
  const altGraph = event.getModifierState?.('AltGraph') === true;
  return event.key === '/'
    && (altGraph || (!event.ctrlKey && !event.altKey))
    && !event.metaKey
    && !event.defaultPrevented
    && event.isComposing !== true
    && !dialogOpen
    && !isEditableTarget(event.target);
}

const g = globalThis as {
  document?: {
    getElementById(id: string): { } | null;
    querySelector(selector: string): { click(): void; setAttribute(name: string, value: string): void } | null;
    addEventListener(type: 'keydown', listener: (event: HotkeyEvent & { preventDefault(): void }) => void): void;
  };
};

/**
 * Stamp `aria-keyshortcuts` on the navbar search button. Call it once the app is
 * mounted: the plugin renders the button inside the persistent navbar, so one
 * stamp after mount covers every page, in production and under the dev server.
 */
export function markSearchShortcuts(): void {
  g.document?.querySelector(SEARCH_BUTTON_SELECTOR)?.setAttribute('aria-keyshortcuts', SEARCH_KEYSHORTCUTS);
}

/** Install the `/` shortcut on the document. No-op on the server. */
export function installSearchHotkeys(): void {
  const doc = g.document;
  if (!doc) {
    return;
  }
  doc.addEventListener('keydown', (event) => {
    if (!isSearchHotkey(event, doc.getElementById(SEARCH_INPUT_ID) !== null)) {
      return;
    }
    const button = doc.querySelector(SEARCH_BUTTON_SELECTOR);
    if (!button) {
      return;
    }
    event.preventDefault();
    button.click();
  });
}
