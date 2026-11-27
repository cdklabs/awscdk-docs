<script setup lang="ts">
// Explorer rail: a 72px column at the sidebar's left edge with the API and Favorites views, and nothing else.
// It renders only while the Explorer preview is on and the page has the API sidebar, and it is a plain
// disclosure of two views, not a tablist: each view is a <button> with aria-pressed.
//
// Below 960px the rail stays hidden until ExplorerViewsButton.vue unfolds it over a scrim; picking a view,
// Escape from anywhere, a route change, a tap on the scrim or moving keyboard focus out of the rail folds it
// again. The scrim keeps pointers off the tree behind it, and the focus rule does the same for the keyboard.
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

// While the rail is unfolded, focus may sit in the rail or on the Views button. Anywhere else
// (the filter and tree behind the scrim) folds it. Focus is already where the reader put it, so it is not moved.
function onDocumentFocusin(event: FocusEvent): void {
  if (!railOpen.value || !enabled.value) return;
  const target = event.target as Element | null;
  if (!target?.closest || target.closest(".ExplorerRailRoot, .explorer-views-button")) return;
  railOpen.value = false;
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
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onDocumentKeydown);
  document.removeEventListener("focusin", onDocumentFocusin);
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
