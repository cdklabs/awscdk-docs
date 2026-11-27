<script setup lang="ts">
// Explorer preview switch: Off / On, rendered as the same segmented aria-pressed toggle NavStylePicker uses,
// so the Settings panel reads as one family of controls. State and persistence live in explorer-preview.ts.
// Hydration: like NavStylePicker, the active state is gated on `mounted` so the server-rendered default
// never shows as the stored choice until the client has read storage.
import { onMounted, ref } from "vue";
import {
  explorerPreview,
  initExplorerPreview,
  setExplorerPreview,
  type ExplorerPreview,
} from "./explorer-preview";

const OPTIONS: { value: ExplorerPreview; label: string; title: string }[] = [
  { value: "off", label: "Off", title: "Use the current sidebar" },
  { value: "on", label: "On", title: "Try the sidebar with a view rail" },
];

const mounted = ref(false);

onMounted(() => {
  initExplorerPreview();
  mounted.value = true;
});

function choose(value: ExplorerPreview): void {
  if (explorerPreview.value === value) return;
  setExplorerPreview(value);
}
</script>

<template>
  <div class="ExplorerPreviewPicker">
    <span class="explorer-preview-group-label">Explorer preview</span>
    <div class="explorer-preview-group" role="group" aria-label="Explorer preview">
      <button
        v-for="option in OPTIONS"
        :key="option.value"
        type="button"
        class="explorer-preview-option"
        :class="{ active: mounted && explorerPreview === option.value }"
        :aria-pressed="mounted && explorerPreview === option.value"
        :title="option.title"
        :data-value="option.value"
        @click="choose(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Same track, caption and segment rules as NavStylePicker.vue. The root sets no outer margin: each host
   places it (SettingsMenu.vue under the navigation group, explorer-preview.css as a mobile nav-screen row). */
.ExplorerPreviewPicker {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.explorer-preview-group-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.explorer-preview-group {
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

.explorer-preview-option {
  display: inline-flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
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

.explorer-preview-option:hover {
  color: var(--vp-c-text-1);
}

.explorer-preview-option:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

.explorer-preview-option.active {
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-1);
}
</style>
