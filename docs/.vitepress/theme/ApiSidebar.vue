<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, shallowRef, watch } from "vue";
import { useData, useRoute, withBase } from "vitepress";
import ApiSidebarItem from "./ApiSidebarItem.vue";
import {
  activeAncestorKeys,
  apiSidebarAsset,
  chunkAsset,
  chunkForPath,
  chunkNames,
  filterSidebarTree,
  loadApiSidebar,
  normalizePath,
  preOpenedRootKeys,
  retainedGroupKeys,
  unloadedChunkForKey,
  withChunk,
  type ApiSidebarNode,
} from "./api-sidebar";
import { API_ROOT } from "../../../src/site-routes";
import { splitTerms, termRank } from "./filterSymbols";
import { activeLanguage, initLanguageState } from "./language-state";
import { sidebarFilterQuery } from "./sidebar-filter";
import { jumpToCurrentRequest } from "./sidebar-jump";
import { animateScrollTop } from "./smooth-scroll";
import { createCollapseMemory, effectiveExpanded } from "./sidebar-collapse";
import { createScrollMemory, createThrottledScrollSaver, isFullyVisible, revealScrollTop } from "./sidebar-scroll";

const route = useRoute();
const { site, theme } = useData();

const base = computed(() => site.value.base || "/");
const activePath = computed(() => normalizePath(route.path, base.value));
// Only the API section gets this sidebar; elsewhere the component is inert.
// normalizePath strips the base and outer slashes, so compare in that shape.
const API_SECTION = API_ROOT.replace(/^\/|\/$/g, "");
const isApi = computed(
  () => activePath.value === API_SECTION || activePath.value.startsWith(`${API_SECTION}/`),
);

const tree = shallowRef<ApiSidebarNode[]>([]);
const status = ref<"idle" | "loading" | "ready" | "error">("idle");
const expanded = ref<Set<string>>(new Set());
const rootEl = ref<HTMLElement | null>(null);

// Persistent disclosure memory: which groups the reader unfolded or
// folded by hand. Uses localStorage (not sessionStorage) so the choice
// survives a browser restart and a new tab.
const collapseMemory = createCollapseMemory(
  typeof window !== "undefined" ? window.localStorage : undefined,
);

// Per-route sidebar scroll memory: the sidebar is an inner scroller the
// browser never restores itself, so remember scrollTop per route and put
// it back on history traversal and full page loads.
const scrollMemory = createScrollMemory(
  typeof window !== "undefined" ? window.sessionStorage : undefined,
);
let scrollContainer: HTMLElement | null = null;
let traversal = false; // set by popstate, consumed by the route watcher
const recordScroll = createThrottledScrollSaver(
  (path, top) => scrollMemory.save(path, top),
  (flush) => requestAnimationFrame(flush),
);

// The VitePress sidebar (`aside.VPSidebar`) is the scroller, on desktop and
// inside the mobile drawer alike. Re-resolved on demand: the aside unmounts
// on sidebar-less pages, and a fresh one needs the listener re-attached
// (the old listener is garbage-collected with its element).
function findScrollContainer(): HTMLElement | null {
  const el = (rootEl.value?.closest(".VPSidebar") as HTMLElement | null) ?? null;
  if (el && el !== scrollContainer) {
    el.addEventListener("scroll", onSidebarScroll, { passive: true });
    scrollContainer = el;
  }
  return scrollContainer;
}

// Remember the position for the current route. Route and position are
// read here and handed over as values: reading either when the frame
// runs would file it under the incoming route.
function onSidebarScroll() {
  if (!scrollContainer || !isApi.value) return;
  recordScroll(activePath.value, scrollContainer.scrollTop);
}

function onPopState() {
  traversal = true;
}

// After the tree renders on a (re)loaded page: a remembered position wins
// (reload, hard back into the tab); otherwise bring the active entry into
// view so a deep link doesn't land with its sidebar entry off-screen.
function revealOnLoad() {
  nextTick(() => {
    const container = findScrollContainer();
    if (!container) return;
    const saved = scrollMemory.get(activePath.value);
    if (saved !== undefined) {
      // A remembered position wins over revealing the active entry: a
      // reload restores the exact scrollTop, even though that can leave
      // the active entry off-screen on a revisited route.
      container.scrollTop = saved;
      return;
    }
    scrollActiveIntoView(container);
  });
}

function scrollActiveIntoView(container: HTMLElement): boolean {
  const active = container.querySelector<HTMLElement>(".api-sidebar-link.active");
  if (!active) return false;
  // `null` means "do not scroll": the entry has no box yet (a closed drawer
  // hides the whole tree), or it is already in view. An entry with no box
  // cannot be scrolled to — only re-attempted once it has one — and
  // computing a target from its zero-size rect would jump the sidebar
  // somewhere unrelated. A collapsed group renders no
  // descendants at all, so its entries are absent here rather
  // than present-but-hidden, and the `!active` return above covers them.
  //
  // The visible region is the container box minus the pinned header block.
  // The header paints over tree rows even though the container contains them,
  // so visibility and focus scrolling both use its measured bottom edge.
  // Desktop starts the scrollport below the navbar; the drawer instead keeps
  // top padding, and this measurement handles both without a breakpoint value.
  const containerBox = container.getBoundingClientRect();
  const header = container.querySelector<HTMLElement>(".sidebar-header");
  const visibleTop = header
    ? Math.max(containerBox.top, header.getBoundingClientRect().bottom)
    : containerBox.top;
  const occluded = visibleTop - containerBox.top;
  // Keep the browser's OWN scroll-into-view clear of the block too: keyboard
  // focus landing on a row near the top would otherwise park it behind the
  // header. Set from the measured inset rather than a CSS literal, so there
  // is one source of truth — the block's height depends on whether the
  // favorites list is expanded.
  container.style.scrollPaddingTop = `${occluded}px`;
  const visibleBox = {
    top: visibleTop,
    bottom: containerBox.bottom,
    height: containerBox.bottom - visibleTop,
  };
  const activeBox = active.getBoundingClientRect();
  if (active.offsetParent !== null && activeBox.height > 0 && isFullyVisible(activeBox, visibleBox)) {
    return true;
  }
  const target = revealScrollTop(
    activeBox,
    visibleBox,
    active.offsetParent !== null,
    container.scrollTop,
    // Center within the VISIBLE region, not the whole scrollport: the offset
    // handed to the reveal is already relative to `visibleBox.top`, so
    // centering against the full height would land the entry off-center by
    // the header's height.
    container.clientHeight - occluded,
  );
  if (target === null) return false;
  // Duration-pinned reveal: native smooth scroll scales its duration with
  // distance, so a jump across the full index overshoots the ~300ms
  // budget. Reduced motion is honored inside the helper.
  animateScrollTop(container, target);
  return false;
}

// In-sidebar symbol filter: the navbar filter input publishes its query
// into shared state; a non-blank query prunes the tree to matching
// entries (plus their ancestor groups) and forces the remaining groups
// open. Whitespace-separated terms combine with AND, and a term satisfied
// by an ancestor heading counts for the whole subtree. The user's own
// `expanded` set is never touched, so clearing the query restores the
// pre-filter sidebar.
const filterTerms = computed(() => splitTerms(sidebarFilterQuery.value));
const filtering = computed(() => filterTerms.value.length > 0);
const displayTree = computed(() =>
  filtering.value
    ? filterSidebarTree(
      tree.value,
      filterTerms.value,
      (text, term) => termRank(text, term) !== undefined,
    )
    : tree.value,
);


function flashActive(active: HTMLElement) {
  active.classList.remove("locate-flash");
  void active.offsetWidth;
  active.classList.add("locate-flash");
  window.setTimeout(() => active.classList.remove("locate-flash"), 1600);
}
// Union the active page's ancestor groups into the open set (never
// auto-collapses a group the user opened themselves).
function syncActive() {
  if (status.value !== "ready") return;
  const ancestors = activeAncestorKeys(tree.value, activePath.value, base.value);
  if (ancestors.size === 0) return;
  const next = new Set(expanded.value);
  for (const key of ancestors) next.add(key);
  expanded.value = next;
}

// Generated page links live under `<API root>docs/`.
const DOCS_PREFIX = `${API_SECTION}/docs/`;

// Sections whose items are in the tree rather than in their chunk file.
const loadedChunks = new Set<string>();

function loadChunk(name: string): Promise<void> {
  if (loadedChunks.has(name)) return Promise.resolve();
  return loadApiSidebar(withBase(chunkAsset(name)), `chunk:${name}`).then((items) => {
    if (loadedChunks.has(name)) return;
    loadedChunks.add(name);
    tree.value = withChunk(tree.value, name, items);
  });
}

// Resolves even on a failed fetch: the skeleton stays usable and the chunk is retried when next needed.
function loadActiveChunk(): Promise<void> {
  const name = chunkForPath(tree.value, activePath.value, DOCS_PREFIX);
  return name ? loadChunk(name).catch(() => undefined) : Promise.resolve();
}

// The filter prunes the whole corpus, so it needs every section's items.
function loadAllChunks() {
  for (const name of chunkNames(tree.value)) {
    loadChunk(name).catch(() => undefined);
  }
}

function ensureLoaded() {
  if (!isApi.value || status.value === "loading" || status.value === "ready") {
    return;
  }
  const skeleton = apiSidebarAsset(theme.value.apiSidebarAsset ?? "");
  if (!skeleton) {
    status.value = "error";
    return;
  }
  status.value = "loading";
  loadApiSidebar(withBase(skeleton), "skeleton")
    .then((nodes) => {
      tree.value = nodes;
      return loadActiveChunk();
    })
    .then(() => {
      // Restore the reader's own disclosure choices on top of the
      // generated tree's pre-opened root groupings: an untouched default
      // stays open, a collapsed one stays collapsed, an opened one comes
      // back open. Prune first so a key for a module that no longer exists
      // leaves storage, within loaded sections only.
      collapseMemory.prune(
        retainedGroupKeys(tree.value, collapseMemory.entries().map(([key]) => key)),
      );
      expanded.value = effectiveExpanded(
        [...expanded.value, ...preOpenedRootKeys(tree.value)],
        collapseMemory.entries(),
      );
      status.value = "ready";
      // A query typed while the skeleton was in flight is already filtering.
      if (filtering.value) loadAllChunks();
      syncActive();
      revealOnLoad();
    })
    .catch(() => {
      status.value = "error";
    });
}

function toggle(key: string) {
  const next = new Set(expanded.value);
  const open = !next.has(key);
  if (open) next.add(key);
  else next.delete(key);
  expanded.value = next;
  // Only an explicit toggle is remembered. syncActive's auto-reveal does
  // not write here, otherwise visiting one deep page would pin its whole
  // ancestor chain open for good.
  collapseMemory.set(key, open);
  if (open) {
    const chunk = unloadedChunkForKey(tree.value, key);
    if (chunk) loadChunk(chunk).catch(() => undefined);
  }
}

// The display language is the shared client-side language selection
// driving every LanguageTabs group. Item labels flip with it in place;
// links, keys, and expansion state stay canonical.
provide("apiSidebar", { expanded, activePath, base, toggle, filtering, displayLang: activeLanguage });

onMounted(() => {
  // Idempotent; the sidebar renders on pages without any LanguageTabs
  // group, so it must hydrate the shared language selection itself.
  initLanguageState();
  window.addEventListener("popstate", onPopState);
  ensureLoaded();
});
onUnmounted(() => {
  window.removeEventListener("popstate", onPopState);
});
// Client-side navigation keeps this component mounted, so react to route
// changes: load on first entry into /api/, and re-open the active branch.
watch(isApi, ensureLoaded);
watch(filtering, (active) => {
  if (active && status.value === "ready") loadAllChunks();
});
// "Locate current page": unfold and reveal an off-screen entry, or flash an entry that is already visible.
watch(jumpToCurrentRequest, () => {
  if (!isApi.value || status.value !== "ready") return;
  const container = findScrollContainer();
  const active = container?.querySelector<HTMLElement>(".api-sidebar-link.active");
  if (container && active) {
    flashActive(active);
    const visible = scrollActiveIntoView(container);
    active.focus({ preventScroll: true });
    if (visible) return;
  }
  loadActiveChunk().then(() => {
    syncActive();
    nextTick(() => {
      const nextContainer = findScrollContainer();
      if (!nextContainer) return;
      const nextActive = nextContainer.querySelector<HTMLElement>(".api-sidebar-link.active");
      if (!nextActive) return;
      scrollActiveIntoView(nextContainer);
      nextActive.focus({ preventScroll: true });
    });
  });
});
watch(activePath, (next, prev) => {
  const wasTraversal = traversal;
  traversal = false;
  // Snapshot the outgoing page's position even when no scroll event fired
  // there (flush is 'pre': the old DOM — and container — is still mounted).
  if (scrollContainer && (prev === API_SECTION || prev.startsWith(`${API_SECTION}/`))) {
    scrollMemory.save(prev, scrollContainer.scrollTop);
  }
  syncActive();
  if (!isApi.value) return;
  if (status.value === "ready") {
    loadActiveChunk().then(syncActive);
  }
  nextTick(() => {
    const container = findScrollContainer();
    if (!container) return;
    if (wasTraversal) {
      // Back/forward: put the sidebar where it was on that page. Forward
      // (link) navigation deliberately restores nothing.
      const saved = scrollMemory.get(next);
      if (saved !== undefined) {
        container.scrollTop = saved;
      }
    }
  });
});
</script>

<template>
  <div v-if="isApi" ref="rootEl" class="api-sidebar">
    <p v-if="status === 'loading' || status === 'idle'" class="api-sidebar-status">
      Loading API index…
    </p>
    <p v-else-if="status === 'error'" class="api-sidebar-status">
      Could not load the API index.
      <a :href="withBase(`/api/`)">Browse the API reference →</a>
    </p>
    <p
      v-else-if="filtering && displayTree.length === 0"
      class="api-sidebar-status"
      role="status"
    >
      No matching entries
    </p>
    <nav v-else class="api-sidebar-nav" aria-label="API reference navigation">
      <ul class="api-sidebar-list">
        <ApiSidebarItem
          v-for="node in displayTree"
          :key="node.text"
          :node="node"
          :parent-key="''"
          :depth="0"
        />
      </ul>
    </nav>
  </div>
</template>
