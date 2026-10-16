// Independent code-block theme, mirroring language-state.ts.
//
// The build's Shiki dual-theme output embeds both palettes on every token as
// `--shiki-light` / `--shiki-dark` CSS vars, and VitePress's stock CSS picks one
// via the html `.dark` class. So an independent code theme needs no second Shiki
// pass: when the reader decouples the code theme from the site theme, we set
// `data-code-theme="light" | "dark"` on <html> and code-theme.css keys the var
// selection off that attribute instead.
//
// Tri-state model, mirroring the site picker:
// - 'light' / 'dark': an explicit choice, decoupled from the site theme.
// - 'auto' (the "Default" state): the attribute is removed entirely, so the stock
//   `.dark`-keyed rules drive the code blocks and follow the site theme.
//
// Persistence: localStorage. A pre-hydration inline script in config.mts
// re-applies a stored decoupled choice before first paint, so a reload never
// flashes the wrong code colors.
import { ref } from 'vue';

export type CodeTheme = 'light' | 'auto' | 'dark';

/** localStorage key; also hard-coded in config.mts's bootstrap script. */
export const CODE_THEME_KEY = 'cdk-docs-code-theme';

/** The single shared code-theme selection. SSR-safe default. */
export const codeTheme = ref<CodeTheme>('auto');

function isCodeTheme(value: string | null): value is CodeTheme {
  return value === 'light' || value === 'auto' || value === 'dark';
}

function apply(theme: CodeTheme): void {
  const el = document.documentElement;
  if (theme === 'auto') {
    el.removeAttribute('data-code-theme');
  } else {
    el.setAttribute('data-code-theme', theme);
  }
}

let initialized = false;

/** Initialize from localStorage. Client-only, idempotent. */
export function initCodeTheme(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const stored = window.localStorage.getItem(CODE_THEME_KEY);
  if (isCodeTheme(stored)) {
    codeTheme.value = stored;
  }
  apply(codeTheme.value);
}

/** Switch the shared code theme; persists and applies immediately. */
export function setCodeTheme(theme: CodeTheme): void {
  codeTheme.value = theme;
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CODE_THEME_KEY, theme);
  apply(theme);
}
