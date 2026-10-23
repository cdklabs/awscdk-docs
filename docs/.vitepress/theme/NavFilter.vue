<script setup lang="ts">
// Navbar symbol filter. Typing narrows the API sidebar in place — the query is
// published into the shared `sidebarFilterQuery` state consumed by ApiSidebar.vue;
// there is no popup. Enter jumps to the best-ranked symbol match from the
// generated symbol index, fetched lazily on first focus. Distinct from
// Pagefind full-text search.
import { useData, useRouter, withBase } from "vitepress";
import { computed, ref, watch } from "vue";
import { apiSidebarAsset } from "./api-sidebar";
import { filterSymbols, type SymbolEntry } from "./filterSymbols";
import { isFilterActive, sidebarFilterQuery } from "./sidebar-filter";

const query = ref("");
const symbols = ref<SymbolEntry[]>([]);
const inputEl = ref<HTMLInputElement | null>(null);
const router = useRouter();
const { theme } = useData();

// Publish into the shared filter state so the API sidebar narrows as the user
// types; a below-minimum query publishes as blank.
watch(query, (value) => {
  sidebarFilterQuery.value = isFilterActive(value) ? value : "";
});

// Single in-flight load of the symbol index, kicked off on first focus. Kept
// as a promise (not a boolean) so the Enter handler can await it: a fast
// typist can press Enter before the fetch resolves. A failed load clears the
// promise so a later focus or Enter retries; when the index is absent,
// Enter-to-jump stays inert.
let loadPromise: Promise<void> | undefined;
function load(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const asset = apiSidebarAsset(theme.value.symbolsAsset ?? "");
        const res = asset ? await fetch(withBase(asset)) : undefined;
        if (res?.ok) {
          symbols.value = await res.json();
          return;
        }
      } catch {
        // fall through to retry on the next focus/Enter
      }
      loadPromise = undefined;
    })();
  }
  return loadPromise;
}

const best = computed(() =>
  isFilterActive(query.value) ? filterSymbols(symbols.value, query.value, 1)[0] : undefined,
);

function clear() {
  query.value = "";
}

// The visible "×" affordance: clearing via the button returns focus to the input
// so the user can type a new query immediately. (Escape needs no refocus.)
function onClear() {
  clear();
  inputEl.value?.focus();
}

// Enter jumps to the best-ranked symbol for the query as typed at press time:
// capture the query synchronously, await the (possibly still in-flight) index
// load, then rank. If the user kept typing while the index loaded, the captured
// query is stale — drop the navigation rather than jump somewhere wrong.
//
// The jump clears the box and, after the navigation, returns focus to it so
// the next query can be typed straight away.
async function onEnter() {
  const pressed = query.value;
  if (!isFilterActive(pressed)) {
    return;
  }
  await load();
  if (query.value !== pressed) {
    return;
  }
  const target = filterSymbols(symbols.value, pressed, 1)[0];
  if (target) {
    clear();
    await router.go(withBase(target.link));
    inputEl.value?.focus();
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    clear();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    void onEnter();
  }
}
</script>

<template>
  <div class="nav-filter">
    <div class="nav-filter-box">
      <span class="nav-filter-icon" aria-hidden="true" />
      <input
        ref="inputEl"
        v-model="query"
        class="nav-filter-input"
        type="text"
        placeholder="Filter navigation…"
        aria-label="Filter navigation in the sidebar"
        @focus="load()"
        @keydown="onKeydown"
      />
      <!-- Rendered only while the input has a value (v-if), so the hidden
           control is never announced or tab-reachable when empty. -->
      <button
        v-if="query.length > 0"
        class="nav-filter-clear"
        type="button"
        aria-label="Clear filter"
        @click="onClear"
      >
        <span class="glyph glyph-clear nav-filter-clear-glyph" aria-hidden="true" />
      </button>
    </div>
    <div class="nav-filter-status">
      <p class="nav-filter-hint" aria-live="polite">
        <template v-if="best">
          <kbd class="nav-filter-key"
            ><span class="glyph glyph-enter nav-filter-enter-glyph" aria-hidden="true" /><span class="visually-hidden">Enter</span></kbd
          >{{ ' ' }}
          <span>opens</span>{{ ' ' }}
          <span class="nav-filter-best" :title="best.name">{{ best.name }}</span>
        </template>
      </p>
      <!-- Withheld while filtering: the row is too narrow for both, and the
           hint describes what Enter does instead. -->
      <slot v-if="!isFilterActive(query)" name="status-actions" />
    </div>
  </div>
</template>

<style scoped>
/* Colors come from VitePress theme variables so light and dark mode are handled
   automatically.

   The control mirrors VitePress's own navbar search button (.DocSearch-Button)
   so it reads as a native affordance: same 40px height, 8px radius, transparent
   border on a --vp-c-bg-alt fill, brand-colored border on hover/focus, an inset
   magnifier icon, and the 13px/500 muted placeholder. */
.nav-filter {
  display: block;
  /* Mounted at the top of the sidebar (sidebar-nav-before slot), above the
     favorites list and the API nav tree it filters. */
  margin: 0;
}

.nav-filter-box {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 10px 0 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background-color: var(--vp-c-bg-alt);
  transition: border-color 0.25s;
}

.nav-filter-box:hover,
.nav-filter-box:focus-within {
  border-color: var(--vp-c-brand-1);
}

/* Focus gets its own indicator on top of the shared brand border so a keyboard
   user can distinguish focus from hover. Same 2px inset outline the theme's
   other focusable controls use, so it reads as one treatment and costs no
   layout shift. */
.nav-filter-box:focus-within {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

/* Same magnifier the navbar search button uses (its --icon SVG), masked so it
   tracks the theme's text colors. */
.nav-filter-icon {
  flex: none;
  width: 14px;
  height: 14px;
  margin-right: 8px;
  background-color: var(--vp-c-text-2);
  transition: background-color 0.25s;
  mask: var(--nav-filter-icon) no-repeat center / contain;
  -webkit-mask: var(--nav-filter-icon) no-repeat center / contain;
  --nav-filter-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' stroke-width='1.6' viewBox='0 0 20 20'%3E%3Cpath fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' d='m14.386 14.386 4.088 4.088-4.088-4.088A7.533 7.533 0 1 1 3.733 3.733a7.533 7.533 0 0 1 10.653 10.653z'/%3E%3C/svg%3E");
}

.nav-filter-box:hover .nav-filter-icon,
.nav-filter-box:focus-within .nav-filter-icon {
  background-color: var(--vp-c-text-1);
}

.nav-filter-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 500;
}

.nav-filter-input:focus {
  outline: none;
}

.nav-filter-input::placeholder {
  color: var(--vp-c-text-2);
  transition: color 0.25s;
}

.nav-filter-box:hover .nav-filter-input::placeholder {
  color: var(--vp-c-text-1);
}

.nav-filter-clear {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: 6px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition: color 0.25s;
}

.nav-filter-clear:hover {
  color: var(--vp-c-text-1);
}

.nav-filter-clear:focus-visible {
  outline: 1px solid var(--vp-c-brand-1);
}

.nav-filter-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 18px;
  margin: 2px 0 0;
}

.nav-filter-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 0 12px;
  overflow: hidden;
  color: var(--vp-c-text-3);
  font-size: 12px;
  line-height: 18px;
}

.nav-filter-key {
  display: flex;
  flex: none;
  align-items: center;
}

.nav-filter-best {
  min-width: 0;
  overflow: hidden;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Same technique as BackToTop's label: the key glyph is decorative, so the key
   name has to reach assistive technology as real text. */
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

.nav-filter-clear-glyph {
  width: 14px;
  height: 14px;
}

.nav-filter-enter-glyph {
  width: 12px;
  height: 12px;
}
</style>
