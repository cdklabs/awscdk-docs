<script setup lang="ts">
// "Locate current page" asks the API sidebar to reveal the active entry or flash it when already visible.
import { computed } from "vue";
import { useData, useRoute } from "vitepress";
import { API_ROOT } from "../../../src/site-routes";
import { normalizePath } from "./api-sidebar";
import { requestJumpToCurrent } from "./sidebar-jump";

const route = useRoute();
const { site } = useData();

const base = computed(() => site.value.base || "/");
const activePath = computed(() => normalizePath(route.path, base.value));
const show = computed(() => activePath.value.startsWith(API_ROOT.replace(/^\//, "")));
</script>

<template>
  <button
    v-if="show"
    type="button"
    class="sidebar-jump-current"
    @click="requestJumpToCurrent()"
  >
    <span class="glyph glyph-locate jump-to-current-glyph" aria-hidden="true" />
    <span class="sidebar-jump-current-text">Locate current page</span>
  </button>
</template>

<style scoped>
.sidebar-jump-current {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 24px of hit area (WCAG 2.5.8) from a row the sidebar header reserves at
     18px: the padding grows the button's box, the negative block margin gives
     the 6px back to the flow, so the header keeps one height whether this
     control renders or not. */
  min-height: 24px;
  margin: -3px 0;
  padding: 3px 4px;
  border: none;
  background: none;
  font-size: 12px;
  line-height: 18px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.2s;
}

.sidebar-jump-current:hover,
.sidebar-jump-current:focus-visible {
  color: var(--vp-c-brand-1);
}

.sidebar-jump-current:focus-visible {
  outline: 1px solid var(--vp-c-brand-1);
  outline-offset: 1px;
}

.jump-to-current-glyph {
  width: 12px;
  height: 12px;
}
</style>
