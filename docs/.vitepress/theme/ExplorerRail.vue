<script setup lang="ts">
// Explorer rail: a 72px column at the sidebar's left edge with the API and Favorites views, and nothing else.
// It renders only while the Explorer preview is on and the page has the API sidebar, and it is a plain
// disclosure of two views, not a tablist: each view is a <button> with aria-pressed.
//
// Below 960px the rail stays hidden until ExplorerViewsButton.vue unfolds it over a scrim; picking a view,
// Escape from anywhere, a route change, a tap on the scrim or moving keyboard focus out of the rail folds it
// again. The scrim keeps pointers off the tree behind it. The covered controls (the Views button, the filter,
// the Favorites list and the tree) are `inert` while the rail is unfolded, so they leave the accessibility tree
// and the tab order too, and Tab wraps between the two view buttons. The focus rule below is the fallback.
import { useRoute } from "vitepress";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { API_ROOT } from "../../../src/site-routes";
import { explorerPreview, explorerView, railOpen, setExplorerView, type ExplorerView } from "./explorer-preview";

const VIEWS: { value: ExplorerView; label: string; glyph: string }[] = [
  { value: "api", label: "API", glyph: "glyph-api" },
  { value: "favorites", label: "Favorites", glyph: "glyph-star" },
];

const route = useRoute();
const mounted = ref(false);
const enabled = computed(
  () => mounted.value && explorerPreview.value === "on" && route.path.includes(API_ROOT),
);

function views(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".explorer-views-button");
}

function pick(view: ExplorerView): void {
  setExplorerView(view);
  if (railOpen.value) {
    railOpen.value = false;
    views()?.focus();
  }
}

function foldRail(): void {
  if (!railOpen.value) return;
  railOpen.value = false;
  views()?.focus();
}

// VitePress closes the whole drawer when Escape is released. Focus has moved by then, so the Escape keyup is
// stopped at the window, in the capture phase, ahead of VitePress's own listener. Other keys (a modifier
// released first, say) pass through and leave the listener in place for the Escape release. If the window
// loses focus before the release, the release never arrives here, so a blur removes the listener too.
function swallowEscapeRelease(): void {
  const done = (): void => {
    window.removeEventListener("keyup", onKeyup, { capture: true });
    window.removeEventListener("blur", done);
  };
  const onKeyup = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    done();
  };
  window.addEventListener("keyup", onKeyup, { capture: true });
  window.addEventListener("blur", done);
}

// Escape folds the rail wherever focus is: the Views button and the tree behind the scrim must not leave the
// rail unfolded when VitePress closes the drawer.
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !enabled.value || !railOpen.value) return;
  swallowEscapeRelease();
  foldRail();
}

// While the rail is unfolded, focus stays in the rail. Anywhere else (the Views button, the filter and the tree
// behind the scrim) folds it: the rail and scrim cover those controls. Focus is already where the reader put it,
// so it is not moved.
function onDocumentFocusin(event: FocusEvent): void {
  if (!railOpen.value || !enabled.value) return;
  const target = event.target as Element | null;
  if (!target?.closest || target.closest(".ExplorerRailRoot")) return;
  railOpen.value = false;
}

// Everything the unfolded rail and its scrim cover. Set synchronously with the fold state, so a fold can move
// focus back to the Views button in the same tick.
function setCoveredInert(inert: boolean): void {
  const covered = document.querySelectorAll<HTMLElement>(".VPSidebar .sidebar-header, .VPSidebar .api-sidebar");
  for (const element of covered) element.inert = inert;
}

// Tab wraps inside the unfolded rail: nothing behind it can take focus, and leaving it for the browser's own UI
// would skip the way back to the Views button.
function onRailKeydown(event: KeyboardEvent): void {
  if (event.key !== "Tab" || !railOpen.value) return;
  const buttons = [...document.querySelectorAll<HTMLElement>(".ExplorerRail .explorer-rail-button")];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(railOpen, (open) => setCoveredInert(open), { flush: "sync" });

// The rail is a drawer only while it is enabled and the viewport is narrow. Leaving either state folds it, so
// the sidebar never stays inert behind a rail that no longer acts as a drawer.
watch(enabled, (on) => {
  if (!on) railOpen.value = false;
});

const narrow =
  typeof window === "undefined" || !window.matchMedia ? undefined : window.matchMedia("(max-width: 959px)");

function onNarrowChange(event: MediaQueryListEvent): void {
  if (!event.matches) railOpen.value = false;
}

watch(
  () => route.path,
  () => {
    railOpen.value = false;
  },
);

onMounted(() => {
  mounted.value = true;
  // The shared fold state can be left over from another page, so a rail that mounts later starts folded.
  railOpen.value = false;
  document.addEventListener("keydown", onDocumentKeydown);
  document.addEventListener("focusin", onDocumentFocusin);
  document.addEventListener("keydown", onRailKeydown);
  narrow?.addEventListener("change", onNarrowChange);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onDocumentKeydown);
  document.removeEventListener("focusin", onDocumentFocusin);
  document.removeEventListener("keydown", onRailKeydown);
  narrow?.removeEventListener("change", onNarrowChange);
  setCoveredInert(false);
});
</script>

<template>
  <div v-if="enabled" class="ExplorerRailRoot">
    <div v-if="railOpen" class="explorer-rail-scrim" @click="foldRail" />
    <nav id="explorer-rail" class="ExplorerRail" :class="{ open: railOpen }" aria-label="Sidebar views">
      <button
        v-for="view in VIEWS"
        :key="view.value"
        type="button"
        class="explorer-rail-button"
        :class="{ selected: explorerView === view.value }"
        :aria-pressed="explorerView === view.value"
        :data-view="view.value"
        @click="pick(view.value)"
      >
        <span class="glyph explorer-rail-icon" :class="view.glyph" aria-hidden="true" />
        <span class="explorer-rail-label">{{ view.label }}</span>
      </button>
    </nav>
  </div>
</template>
