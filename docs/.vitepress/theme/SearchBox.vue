<script setup lang="ts">
// Navbar site search. Replaces VitePress's VPNavBarSearch (aliased in config.mts): a
// trigger button in the nav row opens a modal dialog whose input queries the
// docgen-built JSON index with MiniSearch (plain JavaScript, no WebAssembly). The
// index is fetched on first open and kept for the session. Starred pages sort to
// the top of equal-footing results.
import { useData, useRouter, withBase } from "vitepress";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { apiPathFrom, favoritesStore, rankFavoritesFirst } from "./favorites";
import { loadSiteSearch, type SearchHit, type SiteSearch } from "./search-client";

const { theme } = useData();
const router = useRouter();

const open = ref(false);
const query = ref("");
const hits = ref<SearchHit[]>([]);
const active = ref(0);
const status = ref<"idle" | "loading" | "ready" | "failed">("idle");
const inputEl = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

let engine: SiteSearch | undefined;

const assetPath = computed(() => {
  const file = theme.value.searchAsset as string | undefined;
  return file ? withBase(`/search/${file}`) : "";
});

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

async function ensureEngine(): Promise<SiteSearch | undefined> {
  if (engine) {
    return engine;
  }
  status.value = "loading";
  try {
    engine = await loadSiteSearch(assetPath.value);
    status.value = "ready";
    return engine;
  } catch {
    status.value = "failed";
    return undefined;
  }
}

function rank(results: SearchHit[]): SearchHit[] {
  try {
    const store = favoritesStore();
    if (store.list().length === 0) {
      return results;
    }
    return rankFavoritesFirst(results, (hit) => {
      const path = apiPathFrom(hit.link);
      return path !== undefined && store.isFavorite(path);
    });
  } catch {
    return results;
  }
}

async function runSearch() {
  const typed = query.value;
  const search = await ensureEngine();
  // The user kept typing while the index loaded: a later run owns the results.
  if (!search || typed !== query.value) {
    return;
  }
  hits.value = rank(search.search(typed));
  active.value = 0;
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch(query, () => {
  if (debounce) {
    clearTimeout(debounce);
  }
  debounce = setTimeout(() => void runSearch(), 80);
});

async function show() {
  open.value = true;
  void ensureEngine();
  await nextTick();
  inputEl.value?.focus();
  inputEl.value?.select();
}

function hide() {
  open.value = false;
}

async function go(hit: SearchHit) {
  hide();
  await router.go(withBase(hit.link));
}

function scrollActiveIntoView() {
  const item = listEl.value?.children[active.value] as HTMLElement | undefined;
  item?.scrollIntoView({ block: "nearest" });
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (hits.value.length > 0) {
      active.value = (active.value + 1) % hits.value.length;
      scrollActiveIntoView();
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (hits.value.length > 0) {
      active.value = (active.value - 1 + hits.value.length) % hits.value.length;
      scrollActiveIntoView();
    }
  } else if (e.key === "Enter") {
    e.preventDefault();
    const hit = hits.value[active.value];
    if (hit) {
      void go(hit);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    hide();
  }
}

// Ctrl+K / Cmd+K opens the dialog from anywhere; Escape closes it.
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (open.value) {
      hide();
    } else {
      void show();
    }
  } else if (e.key === "Escape" && open.value) {
    hide();
  }
}

onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
onUnmounted(() => window.removeEventListener("keydown", onGlobalKeydown));

const emptyMessage = computed(() => {
  if (status.value === "failed") {
    return "Search is unavailable: the index could not be loaded.";
  }
  if (status.value === "loading") {
    return "Loading the search index…";
  }
  if (query.value.trim() && hits.value.length === 0) {
    return "No pages match.";
  }
  return "";
});
</script>

<template>
  <div class="site-search">
    <button
      class="site-search-button"
      type="button"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="show()"
    >
      <span class="glyph glyph-search site-search-glyph" aria-hidden="true" />
      <span class="site-search-button-text">Search</span>
      <kbd class="site-search-keys" aria-hidden="true">{{ isMac ? "⌘" : "Ctrl" }} K</kbd>
    </button>

    <Teleport to="body">
      <div v-if="open" class="site-search-mask" @click.self="hide()">
        <div
          class="site-search-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Search the documentation"
        >
          <div class="site-search-box">
            <span class="glyph glyph-search site-search-glyph" aria-hidden="true" />
            <input
              id="site-search-input"
              ref="inputEl"
              v-model="query"
              class="site-search-input"
              type="search"
              autocomplete="off"
              spellcheck="false"
              placeholder="Search (e.g. bucket module:aws-s3 kind:construct)"
              aria-label="Search query"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="site-search-results"
              :aria-expanded="hits.length > 0"
              :aria-activedescendant="hits.length > 0 ? `site-search-result-${active}` : undefined"
              @keydown="onInputKeydown"
            />
            <button class="site-search-close" type="button" aria-label="Close search" @click="hide()">
              <kbd>Esc</kbd>
            </button>
          </div>
          <ul
            v-show="hits.length > 0"
            id="site-search-results"
            ref="listEl"
            class="site-search-results"
            role="listbox"
            aria-label="Search results"
          >
            <li
              v-for="(hit, i) in hits"
              :id="`site-search-result-${i}`"
              :key="hit.link"
              class="site-search-result"
              :class="{ active: i === active }"
              role="option"
              :aria-selected="i === active"
              @mousemove="active = i"
            >
              <a class="site-search-link" :href="withBase(hit.link)" @click.prevent="go(hit)">
                <span class="site-search-title">{{ hit.title }}</span>
                <span class="site-search-meta">
                  <span class="site-search-kind">{{ hit.kind }}</span>
                  <span class="site-search-module">{{ hit.module }}</span>
                </span>
                <span v-if="hit.summary" class="site-search-summary">{{ hit.summary }}</span>
              </a>
            </li>
          </ul>
          <p v-if="emptyMessage" class="site-search-empty" aria-live="polite">{{ emptyMessage }}</p>
          <p v-else-if="!query.trim()" class="site-search-hint">
            Type to search titles and summaries. Scope with <code>module:aws-s3</code> or <code>kind:construct</code>.
          </p>
        </div>
      </div>
    </Teleport>
  </div>
</template>
