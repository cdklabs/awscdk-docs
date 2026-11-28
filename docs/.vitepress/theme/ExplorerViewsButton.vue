<script setup lang="ts">
// "Views" button, first item in the sidebar drawer below 960px (CSS hides it from 960px up). It shows the
// current view and unfolds the rail, which stays hidden on a phone until then. Pressing it moves focus to the
// selected view button; picking a view, Escape or a tap on the scrim folds the rail and returns focus here.
import { useRoute } from "vitepress";
import { computed, nextTick, onMounted, ref } from "vue";
import { API_ROOT } from "../../../src/site-routes";
import { EXPLORER_VIEWS, explorerPreview, explorerView, railOpen } from "./explorer-preview";

// The glyph and the text of the selected view, from the table the rail renders.
const face = computed(() => EXPLORER_VIEWS.find((view) => view.value === explorerView.value) ?? EXPLORER_VIEWS[0]);

const route = useRoute();
const mounted = ref(false);
const enabled = computed(
  () => mounted.value && explorerPreview.value === "on" && route.path.includes(API_ROOT),
);

onMounted(() => {
  mounted.value = true;
});

async function toggle(): Promise<void> {
  railOpen.value = !railOpen.value;
  if (!railOpen.value) return;
  await nextTick();
  document.querySelector<HTMLElement>(".ExplorerRail .explorer-rail-button.selected")?.focus();
}
</script>

<template>
  <button
    v-if="enabled"
    type="button"
    class="explorer-views-button"
    :class="{ open: railOpen }"
    :aria-expanded="railOpen"
    aria-controls="explorer-rail"
    @click="toggle"
  >
    <span class="glyph explorer-views-icon" :class="face.glyph" aria-hidden="true" />
    <span class="explorer-views-label">Views</span>
    <span class="explorer-views-current">{{ face.label }}</span>
  </button>
</template>
