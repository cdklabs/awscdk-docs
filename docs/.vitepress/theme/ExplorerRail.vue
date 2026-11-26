<script setup lang="ts">
// Explorer rail: a 72px column at the sidebar's left edge with the API and Favorites views and the Settings
// button. It renders only while the Explorer preview is on and the page has the API sidebar, and it is a
// plain disclosure of two views, not a tablist: each view is a <button> with aria-pressed.
//
// Settings opens the same panel the top-bar gear opens with the preview off. That panel is rendered here
// while the preview is on (and in SettingsMenu.vue otherwise), so exactly one copy is ever in the page.
// SettingsMenu.vue keeps the shared open state and the outside-click rule for both copies.
//
// Below 960px the rail stays hidden until ExplorerViewsButton.vue unfolds it over a scrim; picking a view,
// Escape or a tap on the scrim folds it again.
import { useRoute } from "vitepress";
import { computed, onMounted, ref } from "vue";
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

// VitePress closes the whole drawer when Escape is released. Focus has moved by then, so the keyup is
// stopped at the window, in the capture phase, ahead of VitePress's own listener.
function swallowEscapeRelease(): void {
  window.addEventListener("keyup", (event) => event.stopPropagation(), { capture: true, once: true });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (settingsOpen.value || railOpen.value) swallowEscapeRelease();
  if (settingsOpen.value) {
    settingsOpen.value = false;
    settingsButton.value?.focus();
  } else {
    foldRail();
  }
}

onMounted(() => {
  mounted.value = true;
});
</script>

<template>
  <div v-if="enabled" class="ExplorerRailRoot" @keydown="onKeydown">
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
