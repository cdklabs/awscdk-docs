// Shared client-side language state: the single language-selection mechanism.
//
// One reactive ref shared by every <LanguageTabs> instance on a page, the navbar
// LanguageToggle, and the sidebar display labels. Selecting a language in one
// place switches all of them.
//
// Persistence & shareability:
// - localStorage, so a preference is remembered across visits
// - URL `?lang=` query param via history.replaceState, so a copied link
//   reproduces the reader's language.
import { ref } from 'vue';
import { LANGUAGE_ORDER, type TabLanguage } from './languages-core';

// The vocabulary lives in the DOM-free languages-core.ts; re-exported here so
// existing consumers keep one import site.
export { LANGUAGE_LABELS, LANGUAGE_ORDER, LANGUAGE_SHORT_LABELS, type TabLanguage } from './languages-core';

const STORAGE_KEY = 'cdk-docs-language';

function isTabLanguage(value: string | null): value is TabLanguage {
  return value !== null && (LANGUAGE_ORDER as readonly string[]).includes(value);
}

/** The single shared language selection. SSR-safe default. */
export const activeLanguage = ref<TabLanguage>('ts');

let initialized = false;

/** Initialize from URL (?lang=) then localStorage. Client-only, idempotent. */
export function initLanguageState(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (isTabLanguage(fromUrl)) {
    activeLanguage.value = fromUrl;
    return;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isTabLanguage(stored)) {
    activeLanguage.value = stored;
  }
}

/** Switch the shared language; persists and reflects into the URL. */
export function setLanguage(lang: TabLanguage): void {
  activeLanguage.value = lang;
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, lang);
  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  window.history.replaceState(window.history.state, '', url);
}
