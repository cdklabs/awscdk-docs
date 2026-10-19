<script setup lang="ts">
// Prominent global language slider. Reads and writes the shared client-side
// language state that drives every <LanguageTabs> group and the sidebar display
// labels — one selection, reflected everywhere, with the URL path unchanged
// (`?lang=` carries the choice).
//
// A segmented slider (WAI-ARIA radio-group pattern) with a per-language text
// abbreviation per segment, placed right of the search box. The active language
// shows its full label next to the abbreviation, so the selection is never
// indicated by color alone.
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
      <!-- The full language, so the visible abbreviation is part of the
           accessible name rather than replaced by it. -->
      <span v-if="lang !== activeLanguage" class="visually-hidden">{{
        LANGUAGE_LABELS[lang]
      }}</span>
      <span v-if="lang === activeLanguage" class="language-label">
        <span class="language-label-text">{{ LANGUAGE_LABELS[lang] }}</span>
        <!-- Width sizers: every enabled label, overlapped in the same grid cell,
             so the column is as wide as the widest one and the slider width does
             not track the active language. Rendering all of them lets the browser
             measure. Hidden from paint, assistive tech, and the search index. -->
        <span
          v-for="sizer in enabled"
          :key="`sizer-${sizer}`"
          class="language-label-sizer"
          aria-hidden="true"
          >{{ LANGUAGE_LABELS[sizer] }}</span
        >
      </span>
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
   * common baseline: `.site-search-button` is 40px in site-search.css, and a
   * regression test (test/nav-controls.test.ts) keeps the two values equal. */
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
  /* Segments stretch to fill the 40px track so the active "thumb"
   * highlight spans the control's full inner height. */
  align-self: stretch;
}

.language-option:hover {
  color: var(--vp-c-text-1);
}

.language-option:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

/* The sliding "thumb": the checked segment lifts off the track. */
.language-option.active {
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-1);
}

.language-abbr {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid currentColor;
  /* Typeset to fit the unchanged 22x20 box, so the control height and the
   * search-box baseline alignment hold. */
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  font-variant-ligatures: none;
}

.language-option.active .language-abbr {
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
  /* brand-2 clears AA on the soft tint over the elevated segment; brand-1 does
   * not. test/theme.test.ts pins both. */
  color: var(--vp-c-brand-2);
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

.language-label {
  /* Overlapping single-cell grid: the visible text and one sizer per enabled
   * language all occupy 1 / 1, so the cell's width is the widest label's width
   * whatever the selection. Costs ~50px of nav-row width, only at >=1280px where
   * the label renders. */
  display: inline-grid;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  color: var(--vp-c-text-1);
}

.language-label-text,
.language-label-sizer {
  grid-area: 1 / 1;
  white-space: nowrap;
}

.language-label-sizer {
  /* visibility, not display:none — a removed box measures nothing. */
  visibility: hidden;
  pointer-events: none;
}
</style>
