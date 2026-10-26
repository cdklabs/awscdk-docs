<script setup lang="ts">
// Navigation-style control: By service / By package, rendered as the same
// segmented aria-pressed toggle the theme pickers use, so the Settings panel
// reads as one family of controls. The segments carry text rather than icons:
// "service" and "package" have no glyph a reader would recognize unprompted,
// and the panel has the room.
//
// State and persistence live in nav-style.ts; ApiSidebar.vue regroups the data
// it already holds when the shared ref changes, so a click costs no request.
// Hydration: like ThemePicker, the active state is gated on `mounted` so the
// server-rendered default never shows as the stored choice until the client
// has read storage.
import { onMounted, ref } from "vue";
import { initNavStyle, navStyle, setNavStyle, type NavStyle } from "./nav-style";

const OPTIONS: { value: NavStyle; label: string; title: string }[] = [
  { value: "service", label: "By service", title: "Group the API reference by service" },
  { value: "package", label: "By package", title: "Group the API reference by package" },
];

const mounted = ref(false);

onMounted(() => {
  initNavStyle();
  mounted.value = true;
});
</script>

<template>
  <div class="NavStylePicker">
    <span class="nav-style-group-label">Navigation</span>
    <div class="nav-style-group" role="group" aria-label="Navigation">
      <button
        v-for="option in OPTIONS"
        :key="option.value"
        type="button"
        class="nav-style-option"
        :class="{ active: mounted && navStyle === option.value }"
        :aria-pressed="mounted && navStyle === option.value"
        :title="option.title"
        @click="setNavStyle(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Same track, caption and segment rules as ThemePicker.vue's labeled layout,
   so the group sits flush under the theme pickers in the Settings panel. */
.NavStylePicker {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  margin-top: 6px;
}

.nav-style-group-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.nav-style-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 2px 1px;
  background-color: var(--vp-c-bg-alt);
  box-sizing: border-box;
  height: 40px;
}

.nav-style-option {
  display: inline-flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  /* WCAG 2.5.8 (Target Size, Minimum): never below 24px on either axis. */
  min-width: 24px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  color: var(--vp-c-text-2);
  transition: color 0.25s, background-color 0.25s;
  align-self: stretch;
}

.nav-style-option:hover {
  color: var(--vp-c-text-1);
}

.nav-style-option:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

.nav-style-option.active {
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-1);
}
</style>
