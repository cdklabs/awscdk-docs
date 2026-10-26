// API-sidebar navigation style, mirroring code-theme.ts.
//
// The sidebar can group the same loaded data two ways: by service (the
// generated tree, the default) or by package (the regrouping
// api-sidebar-package.ts builds from the same skeleton and chunks, see
// docs/adr/2026-10-23-sidebar-navigation-styles.md). The choice is a plain
// reader preference: it changes how `ApiSidebar.vue` arranges what it has
// already fetched, and nothing else. No html attribute, no stylesheet switch,
// no extra request, so there is no pre-hydration bootstrap script either; the
// sidebar reads the stored choice when it mounts, before it renders a tree.
//
// Persistence: localStorage. The key suffixes the sidebar's collapse and
// scroll memory keys too, so each style remembers its own state.
import { ref } from 'vue';

export type NavStyle = 'service' | 'package';

/** localStorage key holding the chosen style. */
export const NAV_STYLE_KEY = 'cdk-docs-nav-style';

/** The style a reader who never opened the picker sees. */
export const DEFAULT_NAV_STYLE: NavStyle = 'service';

/** The single shared selection. SSR-safe default. */
export const navStyle = ref<NavStyle>(DEFAULT_NAV_STYLE);

export function isNavStyle(value: string | null): value is NavStyle {
  return value === 'service' || value === 'package';
}

/**
 * The storage key a per-style sidebar memory uses: the existing key for the
 * default style, so a current reader loses nothing, and a `:<style>` suffix for
 * every other style, so loading one style never prunes the other's saved state.
 */
export function styleStorageKey(baseKey: string, style: NavStyle): string {
  return style === DEFAULT_NAV_STYLE ? baseKey : `${baseKey}:${style}`;
}

let initialized = false;

/** Initialize from localStorage. Client-only, idempotent. Unknown stored values fall back to the default. */
export function initNavStyle(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try {
    const stored = window.localStorage.getItem(NAV_STYLE_KEY);
    if (isNavStyle(stored)) {
      navStyle.value = stored;
    }
  } catch {
    // Storage unavailable (private mode, quota): keep the default for this session.
  }
}

/** Switch the shared style; persists immediately. */
export function setNavStyle(style: NavStyle): void {
  navStyle.value = style;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NAV_STYLE_KEY, style);
  } catch {
    // Storage unavailable: the choice still applies for this session.
  }
}
