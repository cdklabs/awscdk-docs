<script setup lang="ts">
// Two tri-state theme controls, rendered as compact segmented icon toggles:
//
// - SITE theme: Light / Device / Dark. "Device" follows the OS
//   `prefers-color-scheme` and reacts live to OS changes.
// - CODE theme: Light / Default / Dark. "Default" means code blocks follow the
//   site theme; Light or Dark decouples them. State and persistence live in
//   code-theme.ts; the rendering switch is pure CSS over the Shiki dual-theme
//   vars (code-theme.css), no re-highlighting.
//
// Placement: the desktop navbar renders this inside the Settings dropdown, which
// passes `group-labels` for a visible caption per group; the mobile nav screen
// mounts it directly, unlabeled and side by side.
//
// SITE state plumbing: VitePress drives its appearance through VueUse's
// useColorMode on the localStorage key `vitepress-theme-appearance`, where
// 'auto' means "follow prefers-color-scheme". This picker runs its own
// useColorMode instance on the same key, so writes propagate to VitePress's
// internal instance in the same tab and to other tabs via the storage event.
//
// - Light / Dark persist an explicit override ('light' / 'dark').
// - Device stores 'auto': the site follows the OS setting and updates live.
// - No flash of the wrong theme: VitePress's pre-hydration inline script treats
//   a missing key or 'auto' as prefers-color-scheme; the code theme has its own
//   bootstrap script in config.mts.
//
// Icon-only buttons take their accessible names from the descriptive `title`
// strings so the two groups' buttons stay distinguishable by name alone. The
// active state is exposed through aria-pressed, never color alone.
import { useColorMode } from "@vueuse/core";
import { onMounted, ref } from "vue";
import {
  codeTheme,
  initCodeTheme,
  setCodeTheme,
  type CodeTheme,
} from "./code-theme";

// VitePress's appearance storage key. Not re-exported from the public
// 'vitepress' entry point, so mirrored here and guarded by a test that
// fails if it drifts from the VitePress client source.
const APPEARANCE_KEY = "vitepress-theme-appearance";

// Visible per-group captions. Off by default; SettingsMenu.vue turns them
// on because its panel has the room.
const { groupLabels = false } = defineProps<{ groupLabels?: boolean }>();

type Mode = "light" | "auto" | "dark";

// Mirror VitePress's useDark configuration exactly (valueDark: 'dark',
// valueLight: '') so both instances apply the identical class to <html>.
const mode = useColorMode({
  storageKey: APPEARANCE_KEY,
  emitAuto: true,
  modes: { light: "", dark: "dark" },
});

const SITE_OPTIONS: { value: Mode; label: string; title: string }[] = [
  { value: "light", label: "Light", title: "Light site theme" },
  { value: "auto", label: "Device", title: "Follow the device theme" },
  { value: "dark", label: "Dark", title: "Dark site theme" },
];

const CODE_OPTIONS: { value: CodeTheme; label: string; title: string }[] = [
  { value: "light", label: "Light", title: "Light code blocks" },
  { value: "auto", label: "Default", title: "Code blocks follow the site theme" },
  { value: "dark", label: "Dark", title: "Dark code blocks" },
];

function selectSite(value: Mode) {
  mode.value = value;
}

function selectCode(value: CodeTheme) {
  setCodeTheme(value);
}

// Gates the rendered active state to avoid a hydration mismatch. The server has
// no localStorage so it renders the middle option active; Vue's hydration does
// not force-patch a plain `class` attribute, so the highlight would stay wrong
// until the reader clicked. Flipping this flag after hydration forces one
// re-render that repaints the class.
const mounted = ref(false);

// Idempotent: the navbar and the mobile nav-screen each mount a copy; both
// share the one codeTheme ref, so their active states stay in sync.
onMounted(() => {
  initCodeTheme();
  mounted.value = true;
});
</script>

<template>
  <div class="ThemePicker" :class="{ 'theme-picker-labeled': groupLabels }">
    <span v-if="groupLabels" class="theme-picker-group-label">Site theme</span>
    <div class="theme-picker-group" role="group" aria-label="Site theme">
      <button
        v-for="option in SITE_OPTIONS"
        :key="option.value"
        type="button"
        class="theme-picker-option"
        :class="{ active: mounted && mode === option.value }"
        :aria-pressed="mounted && mode === option.value"
        :aria-label="option.title"
        :title="option.title"
        @click="selectSite(option.value)"
      >
        <!-- Sun (Light) -->
        <span v-if="option.value === 'light'" class="glyph glyph-sun theme-picker-icon" aria-hidden="true" />
        <!-- Monitor (Device: follow prefers-color-scheme) -->
        <span v-else-if="option.value === 'auto'" class="glyph glyph-monitor theme-picker-icon" aria-hidden="true" />
        <!-- Moon (Dark) -->
        <span v-else class="glyph glyph-moon theme-picker-icon" aria-hidden="true" />
      </button>
    </div>

    <span v-if="groupLabels" class="theme-picker-group-label">Code theme</span>
    <div class="theme-picker-group" role="group" aria-label="Code theme">
      <!-- Decorative code-brackets glyph marking this as the CODE control.
           Hidden once `group-labels` supplies a visible caption. -->
      <span class="glyph glyph-code theme-picker-group-glyph" aria-hidden="true" />
      <button
        v-for="option in CODE_OPTIONS"
        :key="option.value"
        type="button"
        class="theme-picker-option"
        :class="{ active: mounted && codeTheme === option.value }"
        :aria-pressed="mounted && codeTheme === option.value"
        :aria-label="option.title"
        :title="option.title"
        @click="selectCode(option.value)"
      >
        <!-- Sun (Light) -->
        <span v-if="option.value === 'light'" class="glyph glyph-sun theme-picker-icon" aria-hidden="true" />
        <!-- Chain link (Default: code follows the site theme) -->
        <span v-else-if="option.value === 'auto'" class="glyph glyph-link theme-picker-icon" aria-hidden="true" />
        <!-- Moon (Dark) -->
        <span v-else class="glyph glyph-moon theme-picker-icon" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.ThemePicker {
  display: inline-flex;
  align-items: center;
  /* Tight gap: two tri-state groups render side by side, so the doubled
   * control must not squeeze the centered search out of the nav row.
   * Width is recovered from chrome, never from the segments, which stay
   * at or above the 24px WCAG 2.5.8 minimum target size. */
  gap: 2px;
}

/* Labeled layout (SettingsMenu.vue's panel): the two groups stack under
 * their captions instead of competing for nav-row width. Segments and the
 * 40px track are unchanged, so state, target sizes and accessible names
 * are identical in both layouts. */
.ThemePicker.theme-picker-labeled {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.theme-picker-group-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.theme-picker-group-label:not(:first-child) {
  margin-top: 6px;
}

/* The glyph only disambiguates the icon rows when they sit side by side. */
.theme-picker-labeled .theme-picker-group-glyph {
  display: none;
}

.theme-picker-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 2px 1px;
  background-color: var(--vp-c-bg-alt);
  /* Same rendered height as the adjacent search trigger and language
   * slider so the three controls share a baseline: `.site-search-button`
   * is 40px in site-search.css, pinned here and guarded by a regression
   * test (test/nav-controls.test.ts). */
  box-sizing: border-box;
  height: 40px;
}

.theme-picker-group-glyph {
  margin: 0 0 0 2px;
  color: var(--vp-c-text-3);
  flex: none;
  width: 12px;
  height: 12px;
}

.theme-picker-icon {
  width: 15px;
  height: 15px;
}

.theme-picker-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* WCAG 2.5.8 (Target Size, Minimum): never below 24px. */
  width: 24px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  transition: color 0.25s, background-color 0.25s;
  /* Segments stretch to fill the 40px track so the active "thumb"
   * highlight spans the control's full inner height (mirrors the
   * language slider). */
  align-self: stretch;
}

.theme-picker-option:hover {
  color: var(--vp-c-text-1);
}

.theme-picker-option:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

.theme-picker-option.active {
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-1);
}
</style>
