<script setup lang="ts">
// Explorer rail: a 72px column at the sidebar's left edge with the API and Favorites views and the Settings
// button. It renders only while the Explorer preview is on and the page has the API sidebar, and it is a
// plain disclosure of two views, not a tablist: each view is a <button> with aria-pressed.
//
// Settings opens the same panel the top-bar gear opens with the preview off. That panel is rendered here
// while the preview is on (and in SettingsMenu.vue otherwise), so at most one copy is ever in the page.
// The open state is shared (explorer-preview.ts). SettingsMenu.vue closes the panel on a click outside the
// sidebar; the sidebar stops its clicks from reaching the document, so this component closes it on a click
// inside the sidebar with a capture-phase listener.
//
// Below 960px the rail stays hidden until ExplorerViewsButton.vue unfolds it over a scrim; picking a view,
// Escape from anywhere, a route change, a tap on the scrim or moving keyboard focus out of the rail folds it
// again. The scrim keeps pointers off the tree behind it, and the focus rule does the same for the keyboard.
import { useRoute } from "vitepress";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { API_ROOT } from "../../../src/site-routes";
import ExplorerPreviewPicker from "./ExplorerPreviewPicker.vue";
import {
  explorerPreview,
  explorerView,
  railOpen,
  setExplorerView,
  settingsOpen,
  type ExplorerView,
} from "./explorer-preview";
import NavStylePicker from "./NavStylePicker.vue";
import ThemePicker from "./ThemePicker.vue";

const VIEWS: { value: ExplorerView; label: string; glyph: string }[] = [
  { value: "api", label: "API", glyph: "glyph-api" },
  { value: "favorites", label: "Favorites", glyph: "glyph-star" },
];

const route = useRoute();
const mounted = ref(false);
const enabled = computed(
  () => mounted.value && explorerPreview.value === "on" && route.path.includes(API_ROOT),
);

const settingsButton = ref<HTMLButtonElement | null>(null);

function views(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".explorer-views-button");
}

function pick(view: ExplorerView): void {
  setExplorerView(view);
  if (railOpen.value) {
    railOpen.value = false;
    settingsOpen.value = false;
    views()?.focus();
  }
}

function foldRail(): void {
  if (!railOpen.value) return;
  railOpen.value = false;
  settingsOpen.value = false;
  views()?.focus();
}

function toggleSettings(): void {
  settingsOpen.value = !settingsOpen.value;
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

// Escape closes the Settings panel first and then folds the rail, wherever focus is: the Views button and
// the tree behind the scrim must not leave the rail unfolded when VitePress closes the drawer. Focus goes back
// to the Settings button only when it was in the rail; a reader who tabbed on into the filter or the tree
// keeps their place, as with the top-bar gear.
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !enabled.value || !(settingsOpen.value || railOpen.value)) return;
  swallowEscapeRelease();
  if (settingsOpen.value) {
    settingsOpen.value = false;
    if (document.activeElement?.closest(".ExplorerRailRoot")) settingsButton.value?.focus();
  } else {
    foldRail();
  }
}

// While the rail is unfolded, focus may sit in the rail, its Settings panel or the Views button. Anywhere else
// (the filter and tree behind the scrim) folds it. Focus is already where the reader put it, so it is not moved.
function onDocumentFocusin(event: FocusEvent): void {
  if (!railOpen.value || !enabled.value) return;
  const target = event.target as Element | null;
  if (!target?.closest || target.closest(".ExplorerRailRoot, .explorer-views-button")) return;
  railOpen.value = false;
  settingsOpen.value = false;
}

// `.VPSidebar` stops click propagation, so clicks inside it never reach SettingsMenu.vue's document listener.
function onDocumentClickCapture(event: MouseEvent): void {
  if (!settingsOpen.value || !enabled.value) return;
  const path = event.composedPath() as Element[];
  if (!path.some((el) => el.matches?.("[data-settings-trigger], .explorer-settings-panel"))) {
    settingsOpen.value = false;
  }
}

watch(
  () => route.path,
  () => {
    railOpen.value = false;
    settingsOpen.value = false;
  },
);

onMounted(() => {
  mounted.value = true;
  // The shared open state can be left over from a page without the rail (the switch flipped from the gear on
  // the home page), so a rail that mounts later starts folded and with the panel closed. A rail that is
  // already mounted when the switch flips does not run this again, so the panel stays open beside it.
  railOpen.value = false;
  settingsOpen.value = false;
  document.addEventListener("keydown", onDocumentKeydown);
  document.addEventListener("click", onDocumentClickCapture, true);
  document.addEventListener("focusin", onDocumentFocusin);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onDocumentKeydown);
  document.removeEventListener("click", onDocumentClickCapture, true);
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
      <span class="explorer-rail-gap" />
      <button
        ref="settingsButton"
        type="button"
        class="explorer-rail-button"
        :class="{ selected: settingsOpen }"
        data-settings-trigger
        aria-haspopup="true"
        :aria-expanded="settingsOpen"
        aria-controls="settings-menu-panel"
        @click="toggleSettings"
      >
        <span class="glyph glyph-gear explorer-rail-icon" aria-hidden="true" />
        <span class="explorer-rail-label">Settings</span>
      </button>
    </nav>
    <div
      v-show="settingsOpen"
      id="settings-menu-panel"
      class="explorer-settings-panel"
      aria-label="Settings"
    >
      <ThemePicker group-labels />
      <NavStylePicker />
      <ExplorerPreviewPicker />
    </div>
  </div>
</template>
