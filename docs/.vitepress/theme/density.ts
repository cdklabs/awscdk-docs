// Layout-density state, mirroring code-theme.ts.
//
// Spacing and small font sizes across the API layout are expressed as
// `--density-*` custom properties (declared once on `:root` in density.css at
// today's values). A reader's density choice drives which preset block wins:
//
// - 'balanced' (the default): the attribute is removed entirely, so the bare
//   `:root` tokens apply and every area renders exactly as it does today.
// - 'compact' / 'spacious': `data-density="compact" | "spacious"` on <html>,
//   and the matching `[data-density=...]` block in density.css overrides the
//   tokens. The Layout group in ThemePicker.vue sets the choice.
//
// Persistence: localStorage. A pre-hydration inline script in config.mts
// re-applies a stored non-default choice before first paint, so a reload never
// flashes the wrong density. This module is the single source for the key, the
// value set, the attribute, and the apply rule the bootstrap script duplicates.
import { ref } from 'vue';

export type Density = 'compact' | 'balanced' | 'spacious';

/** localStorage key; also hard-coded in config.mts's bootstrap script. */
export const DENSITY_KEY = 'cdk-docs-density';

/** The single shared density selection. SSR-safe default (Balanced). */
export const density = ref<Density>('balanced');

function isDensity(value: string | null): value is Density {
  return value === 'compact' || value === 'balanced' || value === 'spacious';
}

function apply(value: Density): void {
  const el = document.documentElement;
  if (value === 'balanced') {
    el.removeAttribute('data-density');
  } else {
    el.setAttribute('data-density', value);
  }
}

let initialized = false;

/** Initialize from localStorage. Client-only, idempotent. Unknown stored
 *  values fall back to balanced. */
export function initDensity(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const stored = window.localStorage.getItem(DENSITY_KEY);
  if (isDensity(stored)) {
    density.value = stored;
  }
  apply(density.value);
}

/** Switch the shared density; persists and applies immediately. */
export function setDensity(value: Density): void {
  density.value = value;
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DENSITY_KEY, value);
  apply(value);
}
