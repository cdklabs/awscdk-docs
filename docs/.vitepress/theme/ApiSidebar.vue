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
  groupKeys,
  loadApiSidebar,
  normalizePath,
  preOpenedRootKeys,
  retainedGroupKeys,
  unloadedChunkForKey,
  withChunk,
  type ApiSidebarNode,
} from "./api-sidebar";
import { buildPackageSidebar, decodePackageModules } from "./api-sidebar-package";
import { API_ROOT } from "../../../src/site-routes";
import { splitTerms, termRank } from "./filterSymbols";
import { activeLanguage, initLanguageState } from "./language-state";
import { initNavStyle, navStyle, styleStorageKey, type NavStyle } from "./nav-style";
import { sidebarFilterQuery, toggleFilterCollapsed } from "./sidebar-filter";
import { jumpToCurrentRequest } from "./sidebar-jump";
import { animateScrollTop } from "./smooth-scroll";
import { enclosingStickyHeight, StickyHeadings } from "./sidebar-sticky";
import { createCollapseMemory, effectiveExpanded, EXPANDED_STORE_KEY } from "./sidebar-collapse";
import {
  createScrollMemory,
  createThrottledScrollSaver,
  isFullyVisible,
  revealScrollTop,
  SCROLL_STORE_KEY,
} from "./sidebar-scroll";

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

// The generated service tree: the skeleton with every loaded section's items
// in place. It is the only data ever fetched; the package style below is a
// regrouping of it (docs/adr/2026-10-23-sidebar-navigation-styles.md).
const serviceTree = shallowRef<ApiSidebarNode[]>([]);
// Items of every loaded chunk, by chunk name: the grouper reads leaves from
// here, and a name's presence is what marks a section as loaded.
const chunkItems = new Map<string, readonly ApiSidebarNode[]>();
const packageModules = computed(() => {
  const data = serviceTree.value[0]?.packageModules;
  return data ? decodePackageModules(data, serviceTree.value, API_ROOT) : [];
});
// Rebuilt from the loaded chunks, so an opened package fills in as its chunks
// arrive. Nothing is fetched for it. The rebuild walks every loaded leaf, and
// the filter streams in hundreds of chunks at once, so it is throttled: one
// rebuild at once, then at most one per cooldown while more chunks land, and
// none at all while the service style is showing (the tree is rebuilt on
// demand when the reader switches).
const packageTree = shallowRef<ApiSidebarNode[]>([]);
const PACKAGE_REBUILD_COOLDOWN_MS = 250;
let packageStale = true;
let packageCooldown: ReturnType<typeof setTimeout> | undefined;
function rebuildPackageTree() {
  packageStale = false;
  packageTree.value = buildPackageSidebar(packageModules.value, serviceTree.value, chunkItems, API_ROOT);
}
function ensurePackageTree() {
  if (packageStale) rebuildPackageTree();
}
function schedulePackageRebuild() {
  packageStale = true;
  if (navStyle.value !== "package") return;
  if (packageCooldown !== undefined) return;
  rebuildPackageTree();
  packageCooldown = setTimeout(() => {
    packageCooldown = undefined;
    if (packageStale) schedulePackageRebuild();
  }, PACKAGE_REBUILD_COOLDOWN_MS);
}
const tree = computed(() => (navStyle.value === "package" ? packageTree.value : serviceTree.value));
const status = ref<"idle" | "loading" | "ready" | "error">("idle");
// One open set per style: the two trees share no group keys, and a reader
// who folds a package must find it folded when they come back to that style.
const expandedByStyle = ref<Record<NavStyle, Set<string>>>({ service: new Set(), package: new Set() });
const expanded = computed(() => expandedByStyle.value[navStyle.value]);
function setExpanded(next: Set<string>) {
  expandedByStyle.value = { ...expandedByStyle.value, [navStyle.value]: next };
}
const rootEl = ref<HTMLElement | null>(null);

// Persistent disclosure memory: which groups the reader unfolded or
// folded by hand. Uses localStorage (not sessionStorage) so the choice
// survives a browser restart and a new tab. One store per style, under the
// style-suffixed key, so pruning one style's dead keys never touches the
// other's and the service store keeps its historical key.
const localStore = typeof window !== "undefined" ? window.localStorage : undefined;
const collapseMemories = {
  service: createCollapseMemory(localStore, styleStorageKey(EXPANDED_STORE_KEY, "service")),
  package: createCollapseMemory(localStore, styleStorageKey(EXPANDED_STORE_KEY, "package")),
};
const collapseMemory = computed(() => collapseMemories[navStyle.value]);
// Which styles have had their store pruned and defaults applied this session.
const initializedStyles = new Set<NavStyle>();

// Per-route sidebar scroll memory: the sidebar is an inner scroller the
// browser never restores itself, so remember scrollTop per route and put
// it back on history traversal and full page loads. Per style too: the same
// route sits at a different offset in each tree.
const sessionStore = typeof window !== "undefined" ? window.sessionStorage : undefined;
const scrollMemories = {
  service: createScrollMemory(sessionStore, styleStorageKey(SCROLL_STORE_KEY, "service")),
  package: createScrollMemory(sessionStore, styleStorageKey(SCROLL_STORE_KEY, "package")),
};
const scrollMemory = computed(() => scrollMemories[navStyle.value]);
let scrollContainer: HTMLElement | null = null;
let traversal = false; // set by popstate, consumed by the route watcher
const recordScroll = createThrottledScrollSaver(
  (path, top) => scrollMemory.value.save(path, top),
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
  if (scrollContainer) sticky.attach(scrollContainer);
  return scrollContainer;
}

// Pinned group headings: the nearest enclosing group stays visible under the
// header block while its entries scroll. Items register their own `<li>`.
const sticky = new StickyHeadings();

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
    const saved = scrollMemory.value.get(activePath.value);
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
  // Once the entry is in view, its nearest enclosing group heading is pinned
  // directly under the header, so that heading's height is occluded too.
  const visibleTop =
    (header
      ? Math.max(containerBox.top, header.getBoundingClientRect().bottom)
      : containerBox.top) + enclosingStickyHeight(active);
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
// entries (plus their ancestor groups) and opens the remaining groups by
// default. Whitespace-separated terms combine with AND, and a term satisfied
// by an ancestor heading counts for the whole subtree. The user's own
// `expanded` set is never touched, so clearing the query restores the
// pre-filter sidebar.
const filterTerms = computed(() => splitTerms(sidebarFilterQuery.value));
const filtering = computed(() => filterTerms.value.length > 0);
// Groups the reader folded during the current filter session. Kept apart from
// `expanded` so a fold made in the temporary filtered view is never saved:
// the set is emptied when the filter ends or the navigation style switches,
// and it is never written to storage. Editing the query keeps it, so refining
// a search does not undo the reader's own clicks.
const filterCollapsed = ref(new Set<string>());
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
// auto-collapses a group the user opened themselves). Runs against the
// active style's tree, so a style switch reveals the page in the new tree.
function syncActive() {
  if (status.value !== "ready") return;
  const ancestors = activeAncestorKeys(tree.value, activePath.value, base.value);
  if (ancestors.size === 0) return;
  const next = new Set(expanded.value);
  for (const key of ancestors) next.add(key);
  setExpanded(next);
}

// Generated page links live under `<API root>docs/`.
const DOCS_PREFIX = `${API_SECTION}/docs/`;

function loadChunk(name: string): Promise<void> {
  if (chunkItems.has(name)) return Promise.resolve();
  return loadApiSidebar(withBase(chunkAsset(name)), `chunk:${name}`).then((items) => {
    if (chunkItems.has(name)) return;
    chunkItems.set(name, items);
    // Both styles read from here: the service tree takes the items in
    // place, and the package tree is regrouped from the loaded chunks.
    serviceTree.value = withChunk(serviceTree.value, name, items);
    schedulePackageRebuild();
  });
}

// Resolves even on a failed fetch: the skeleton stays usable and the chunk is retried when next needed.
function loadActiveChunk(): Promise<void> {
  const name = chunkForPath(serviceTree.value, activePath.value, DOCS_PREFIX);
  return name ? loadChunk(name).catch(() => undefined) : Promise.resolve();
}

// The filter prunes the whole corpus, so it needs every section's items.
// The chunk files are the same in both styles.
function loadAllChunks() {
  for (const name of chunkNames(serviceTree.value)) {
    loadChunk(name).catch(() => undefined);
  }
}

// The chunk files an open package entry needs but does not have yet. A
// package is a top-level entry, so its key is its text.
function unloadedPackageChunks(key: string): string[] {
  ensurePackageTree();
  const entry = packageTree.value.find((node) => node.text === key);
  return (entry?.chunks ?? []).filter((name) => !chunkItems.has(name));
}

// Load what the open entries of the package style need: the packages the
// reader has open, which after a fresh switch is the one holding the active
// page (already fetched for the service style) and nothing else.
function loadOpenPackageChunks() {
  for (const key of expandedByStyle.value.package) {
    for (const name of unloadedPackageChunks(key)) loadChunk(name).catch(() => undefined);
  }
}

// The groups a style opens before any reader choice: the generated tree's
// pre-opened roots (Framework, Services) for the service style; the API
// Reference entry for the package style, where every package starts
// collapsed and the active page's own package is opened by syncActive.
function styleDefaults(style: NavStyle): string[] {
  return style === "package" ? ["API Reference"] : [...preOpenedRootKeys(serviceTree.value)];
}

// First use of a style this session: restore the reader's own disclosure
// choices on top of that style's defaults -- an untouched default stays open,
// a collapsed one stays collapsed, an opened one comes back open. Prune
// first so a key for a module that no longer exists leaves storage, within
// loaded sections only, and only in this style's own store.
function initStyle(style: NavStyle) {
  if (initializedStyles.has(style)) return;
  initializedStyles.add(style);
  const memory = collapseMemories[style];
  if (style === "package") ensurePackageTree();
  const styleTree = style === "package" ? packageTree.value : serviceTree.value;
  const live = style === "package"
    ? groupKeys(styleTree)
    : retainedGroupKeys(styleTree, memory.entries().map(([key]) => key));
  memory.prune(live);
  expandedByStyle.value = {
    ...expandedByStyle.value,
    [style]: effectiveExpanded([...expandedByStyle.value[style], ...styleDefaults(style)], memory.entries()),
  };
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
      serviceTree.value = nodes;
      return loadActiveChunk();
    })
    .then(() => {
      initStyle(navStyle.value);
      status.value = "ready";
      // A query typed while the skeleton was in flight is already filtering.
      if (filtering.value) loadAllChunks();
      syncActive();
      if (navStyle.value === "package") loadOpenPackageChunks();
      revealOnLoad();
    })
    .catch(() => {
      status.value = "error";
    });
}

function toggle(key: string) {
  // While filtering, a toggle folds or unfolds the group for this filter
  // session only. Every chunk is already loaded for the filter, so nothing
  // needs fetching, and neither `expanded` nor the store is touched.
  if (filtering.value) {
    filterCollapsed.value = toggleFilterCollapsed(filterCollapsed.value, key);
    return;
  }
  const next = new Set(expanded.value);
  const open = !next.has(key);
  if (open) next.add(key);
  else next.delete(key);
  setExpanded(next);
  // Only an explicit toggle is remembered. syncActive's auto-reveal does
  // not write here, otherwise visiting one deep page would pin its whole
  // ancestor chain open for good.
  collapseMemory.value.set(key, open);
  if (!open) return;
  if (navStyle.value === "package") {
    for (const name of unloadedPackageChunks(key)) loadChunk(name).catch(() => undefined);
  } else {
    const chunk = unloadedChunkForKey(serviceTree.value, key);
    if (chunk) loadChunk(chunk).catch(() => undefined);
  }
}

// A style switch regroups the data already here: no new skeleton, no new
// status. The new style gets its defaults and stored choices on first use,
// the active page is revealed in it, and the packages it has open fetch any
// chunk they still miss.
watch(navStyle, () => {
  // Folds made while filtering belong to the tree they were made in.
  filterCollapsed.value = new Set();
  if (status.value !== "ready") return;
  if (navStyle.value === "package") ensurePackageTree();
  initStyle(navStyle.value);
  syncActive();
  if (navStyle.value === "package") loadOpenPackageChunks();
  nextTick(() => {
    const container = findScrollContainer();
    if (container) scrollActiveIntoView(container);
  });
});

// The display language is the shared client-side language selection
// driving every LanguageTabs group. Item labels flip with it in place;
// links, keys, and expansion state stay canonical.
provide("apiSidebar", {
  expanded,
  activePath,
  base,
  toggle,
  filtering,
  filterCollapsed,
  displayLang: activeLanguage,
  sticky,
  findScrollContainer,
});

onMounted(() => {
  // Idempotent; the sidebar renders on pages without any LanguageTabs
  // group, so it must hydrate the shared language selection itself.
  initLanguageState();
  // The stored navigation style decides which tree renders first, so read it
  // before the skeleton arrives; no request depends on it.
  initNavStyle();
  window.addEventListener("popstate", onPopState);
  ensureLoaded();
});
onUnmounted(() => {
  window.removeEventListener("popstate", onPopState);
  sticky.detach();
  if (packageCooldown !== undefined) clearTimeout(packageCooldown);
});
// Client-side navigation keeps this component mounted, so react to route
// changes: load on first entry into /api/, and re-open the active branch.
watch(isApi, ensureLoaded);
watch(filtering, (active) => {
  if (active) {
    if (status.value === "ready") loadAllChunks();
    return;
  }
  // The filter ended (cleared, shortened, or Enter jumped): drop the folds
  // made in the filtered view so the pre-filter tree comes back exactly.
  filterCollapsed.value = new Set();
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
    scrollMemory.value.save(prev, scrollContainer.scrollTop);
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
      const saved = scrollMemory.value.get(next);
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
