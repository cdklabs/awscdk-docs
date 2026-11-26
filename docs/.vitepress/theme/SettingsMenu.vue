<script setup lang="ts">
// Settings dropdown: a compact gear-icon disclosure in the desktop navbar that
// hosts the low-frequency reader preferences — the three tri-state pickers,
// Site theme, Code theme and Layout, and the API sidebar's Navigation style —
// behind the gear to keep the nav row uncluttered.
//
// Disclosure pattern: the trigger is a real <button> with aria-expanded /
// aria-controls, Enter/Space toggle natively, Escape closes and returns focus to
// the trigger, and any click outside closes the panel. Focus is not trapped, so
// the rest of the navbar stays tabbable. The panel is a plain labeled region;
// its content (ThemePicker) carries its own group semantics and state.
//
// With the Explorer preview on, the gear leaves the bar and the rail's Settings button
// (ExplorerRail.vue) opens a copy of this panel there. The open state is shared through
// explorer-preview.ts. This component's outside-click rule skips the rail's button and panel;
// ExplorerRail.vue closes the panel for clicks inside the sidebar, which never reach the document.
import { onBeforeUnmount, onMounted, ref } from "vue";
import ExplorerPreviewPicker from "./ExplorerPreviewPicker.vue";
import { explorerPreview, settingsOpen as open } from "./explorer-preview";
import NavStylePicker from "./NavStylePicker.vue";
import ThemePicker from "./ThemePicker.vue";

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
// The panel moves to the rail while the preview is on. Gated on mount so hydration still matches the server
// render, which always has the panel here.
const mounted = ref(false);

function toggle(): void {
  open.value = !open.value;
}

function onDocumentClick(event: MouseEvent): void {
  // The composed path is read at dispatch time, so a click on a control that unmounts while handling it
  // (the preview switch moves the panel to the rail) still counts as inside.
  const path = event.composedPath() as Element[];
  const inside =
    path.includes(root.value as HTMLElement) ||
    path.some((el) => el.matches?.("[data-settings-trigger], .explorer-settings-panel"));
  if (open.value && root.value && !inside) {
    open.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) {
    open.value = false;
    trigger.value?.focus();
  }
}

onMounted(() => {
  mounted.value = true;
  document.addEventListener("click", onDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
});
</script>

<template>
  <div ref="root" class="SettingsMenu" @keydown="onKeydown">
    <button
      ref="trigger"
      type="button"
      class="settings-trigger"
      aria-label="Settings"
      title="Settings"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-controls="settings-menu-panel"
      @click="toggle"
    >
      <span class="glyph glyph-gear settings-gear" aria-hidden="true" />
    </button>
    <div
      v-if="!mounted || explorerPreview === 'off'"
      v-show="open"
      id="settings-menu-panel"
      class="settings-panel"
      aria-label="Settings"
    >
      <!-- group-labels: the panel has room for a visible caption on each
           tri-state group. -->
      <ThemePicker group-labels />
      <!-- Navigation style (by service / by package) for the API sidebar: a
           reader preference like the themes, so it lives in the same panel. -->
      <NavStylePicker />
      <!-- Opt-in sidebar variant with a view rail; the last group so it reads as an experiment. -->
      <ExplorerPreviewPicker v-if="mounted" />
    </div>
  </div>
</template>

<style scoped>
.SettingsMenu {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.settings-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* WCAG 2.5.8 (Target Size, Minimum) on the narrow axis. */
  width: 32px;
  border-radius: 8px;
  color: var(--vp-c-text-2);
  transition: color 0.25s, background-color 0.25s;
  /* Same rendered height as the search trigger and the language slider so the
   * nav controls share one baseline. The pagefind plugin hard-codes
   * `height: 40px` on `.nav-search-btn-wait` and exposes no variable, so the
   * value is pinned here like LanguageToggle.vue and guarded by a regression
   * test that reads the plugin's source (test/nav-controls.test.ts). */
  box-sizing: border-box;
  height: 40px;
}

.settings-trigger:hover,
.settings-trigger[aria-expanded="true"] {
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-default-soft);
}

.settings-trigger:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

.settings-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 100;
  min-width: 200px;
  padding: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background-color: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-3);
}

.settings-gear {
  width: 18px;
  height: 18px;
}

/* The navigation group sits 6px under the theme pickers. The child's root
   element carries this component's scope attribute, so a scoped rule reaches it. */
.settings-panel > .NavStylePicker,
.settings-panel > .ExplorerPreviewPicker {
  margin-top: 6px;
}
</style>
