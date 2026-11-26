<script setup lang="ts">
// Prominent global language slider. Reads and writes the shared client-side
// language state that drives every <LanguageTabs> group and the sidebar display
// labels — one selection, reflected everywhere, with the URL path unchanged
// (`?lang=` carries the choice).
//
// A segmented control (WAI-ARIA radio-group pattern), placed right of the search
// box. nav-controls.css shows every option by its language name and shortens
// TypeScript to its abbreviation, "TS", below 1100px; the hidden full name keeps
// the abbreviation inside the accessible name. The phone menu stacks the options
// vertically.
//
// Renders only when the build enables 2+ languages (enabled-languages.ts,
// compiled into the bundle — see that module for why it is not themeConfig).
import { computed, onBeforeUpdate, onMounted, ref } from "vue";
import {
  ENABLED_LANGUAGES,
  LANGUAGE_TOGGLE_VISIBLE,
} from "./enabled-languages";
import {
  activeLanguage,
  initLanguageState,
  LANGUAGE_LABELS,
  LANGUAGE_SHORT_LABELS,
  setLanguage,
  type TabLanguage,
} from "./language-state";

/** Languages enabled at build time, in canonical display order. */
const enabled = computed<readonly TabLanguage[]>(() => ENABLED_LANGUAGES);

const visible = LANGUAGE_TOGGLE_VISIBLE;

// Roving tabindex per the WAI-ARIA radio-group pattern: only the
// checked segment is in the page tab order; Arrow keys move focus AND
// selection (Home/End jump to the ends).
const optionRefs = ref<HTMLButtonElement[]>([]);
onBeforeUpdate(() => {
  optionRefs.value = [];
});

function setOptionRef(el: unknown, index: number): void {
  if (el instanceof HTMLButtonElement) {
    optionRefs.value[index] = el;
  }
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const count = enabled.value.length;
  let next: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = (index + 1) % count;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = (index - 1 + count) % count;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  setLanguage(enabled.value[next]);
  optionRefs.value[next]?.focus();
}

// Idempotent: hydrate the shared selection from ?lang=/localStorage even
// on pages that mount no LanguageTabs group.
onMounted(initLanguageState);
</script>

<template>
  <div
    v-if="visible"
    class="language-toggle"
    role="radiogroup"
    aria-label="Select programming language"
  >
    <button
      v-for="(lang, i) in enabled"
      :key="lang"
      :ref="(el) => setOptionRef(el, i)"
      type="button"
      role="radio"
      class="language-option"
      :class="{ active: lang === activeLanguage }"
      :aria-checked="lang === activeLanguage"
      :title="LANGUAGE_LABELS[lang]"
      :tabindex="lang === activeLanguage ? 0 : -1"
      @click="setLanguage(lang)"
      @keydown="onKeydown($event, i)"
    >
      <span class="language-abbr" :data-lang="lang">{{
        LANGUAGE_SHORT_LABELS[lang]
      }}</span>
      <!-- The full language name. Below 1100px it keeps the visible "TS"
           inside TypeScript's accessible name. -->
      <span v-if="lang !== activeLanguage" class="visually-hidden">{{
        LANGUAGE_LABELS[lang]
      }}</span>
      <span v-if="lang === activeLanguage" class="language-label">{{
        LANGUAGE_LABELS[lang]
      }}</span>
    </button>
  </div>
</template>

<style scoped>
.language-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 2px;
  background-color: var(--vp-c-bg-alt);
  /* Same rendered height as the adjacent search trigger so the two sit on a
   * common baseline. The pagefind plugin hard-codes `height: 40px` on
   * `.nav-search-btn-wait` (no CSS variable exposes it), so the value is pinned
   * here and guarded by a regression test (test/nav-controls.test.ts) that reads
   * the plugin's source. */
  box-sizing: border-box;
  height: 40px;
}

.language-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  transition: color 0.25s, background-color 0.25s;
  /* Options stretch to fill the 40px track so the selected fill and the
   * bar's inset underline span its full inner height. */
  align-self: stretch;
}

.language-option:hover {
  color: var(--vp-c-text-1);
}

.language-option:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

/* The selected option's base fill only. nav-controls.css marks the selection:
 * a brand underline in the bar, a brand fill in the phone menu. */
.language-option.active {
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-bg-elv);
}

/* nav-controls.css decides when the badge paints (TypeScript's "TS", below
 * 1100px in the bar) and how it is typeset. */
.language-abbr {
  font-variant-ligatures: none;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Size and color come from nav-controls.css. */
.language-label {
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
}
</style>
