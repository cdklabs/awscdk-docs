// Explorer preview state, mirroring density.ts.
//
// The preview is an opt-in sidebar variant: a view rail at the sidebar's left edge with a Services view (one
// A to Z list of AWS services), an API view (today's tree and filter) and a Favorites view. The top-bar gear stays. Every CSS rule that changes the
// preview-off layout keys on two attributes on <html>, and the components read the `explorerPreview` ref, so a
// reader who never opts in sees only the switch itself:
//
// - `data-explorer-preview="on"` is present only while the preview is on.
// - `data-explorer-view="services" | "api" | "favorites"` is present only while the preview is on.
//
// Persistence: localStorage. A pre-hydration inline script in config.mts sets both attributes before first
// paint, so a reload never jumps by the rail's width. This module is the single source for the keys, the
// value sets and the attribute rule that script duplicates.
import { ref } from 'vue';

export type ExplorerPreview = 'on' | 'off';
export type ExplorerView = 'services' | 'api' | 'favorites';

/** localStorage key holding the switch; also hard-coded in config.mts's bootstrap script. */
export const EXPLORER_PREVIEW_KEY = 'cdk-docs-explorer-preview';

/** localStorage key holding the selected view; also hard-coded in config.mts's bootstrap script. */
export const EXPLORER_VIEW_KEY = 'cdk-docs-explorer-view';

/** The switch position a reader who never opened the picker sees. */
export const DEFAULT_EXPLORER_PREVIEW: ExplorerPreview = 'off';

/** The view shown first, and after a stored value is missing or unknown. */
export const DEFAULT_EXPLORER_VIEW: ExplorerView = 'api';

/** The shared switch position. SSR-safe default (off). */
export const explorerPreview = ref<ExplorerPreview>(DEFAULT_EXPLORER_PREVIEW);

/** The shared selected view. SSR-safe default (API). */
export const explorerView = ref<ExplorerView>(DEFAULT_EXPLORER_VIEW);

/** Whether the rail is unfolded below 960px, where it stays hidden until the Views button opens it. */
export const railOpen = ref(false);

export function isExplorerView(value: string | null): value is ExplorerView {
  return value === 'services' || value === 'api' || value === 'favorites';
}

function applyAttributes(): void {
  const el = document.documentElement;
  if (explorerPreview.value === 'on') {
    el.setAttribute('data-explorer-preview', 'on');
    el.setAttribute('data-explorer-view', explorerView.value);
  } else {
    el.removeAttribute('data-explorer-preview');
    el.removeAttribute('data-explorer-view');
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice still applies for this session.
  }
}

let initialized = false;

/** Initialize from localStorage. Client-only, idempotent. Unknown stored values fall back to the defaults. */
export function initExplorerPreview(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try {
    const preview = window.localStorage.getItem(EXPLORER_PREVIEW_KEY);
    if (preview === 'on') explorerPreview.value = 'on';
    const view = window.localStorage.getItem(EXPLORER_VIEW_KEY);
    if (isExplorerView(view)) explorerView.value = view;
  } catch {
    // Storage unavailable (private mode, quota): keep the defaults for this session.
  }
  applyAttributes();
}

/** Turn the preview on or off; persists immediately. Turning it on starts in the API view. */
export function setExplorerPreview(value: ExplorerPreview): void {
  explorerPreview.value = value;
  // Either way the rail starts folded: turning the preview off must not leave the covered sidebar inert.
  railOpen.value = false;
  if (value === 'on') explorerView.value = DEFAULT_EXPLORER_VIEW;
  if (typeof window === 'undefined') return;
  store(EXPLORER_PREVIEW_KEY, value);
  if (value === 'on') store(EXPLORER_VIEW_KEY, explorerView.value);
  applyAttributes();
}

/** Select a view; persists immediately. */
export function setExplorerView(view: ExplorerView): void {
  explorerView.value = view;
  if (typeof window === 'undefined') return;
  store(EXPLORER_VIEW_KEY, view);
  applyAttributes();
}
