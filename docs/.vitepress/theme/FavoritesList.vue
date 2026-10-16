<!--
  "Favorites" quick-access section rendered at the top of the sidebar via the
  default theme's `sidebar-nav-before` layout slot. Populated in onMounted to
  avoid hydration mismatches on a statically generated site.

  Collapsible and collapsed by default: the section sits above the primary
  FRAMEWORK/SERVICES tree, so an always-open list would push the tree down. The
  header is a real disclosure button with the same aria contract and caret as the
  nav tree's own groups; the count stays visible while collapsed for
  discoverability.
-->
<script setup lang="ts">
import { useRoute, withBase } from "vitepress";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { API_ROOT } from "../../../src/site-routes";
import {
  favoritesStore,
  readCollapsed,
  writeCollapsed,
  type FavoriteEntry,
} from "./favorites";

const route = useRoute();

const entries = ref<readonly FavoriteEntry[]>([]);
// Collapsed until storage says otherwise, and read in onMounted with the
// entries: reading it during setup would run on the server too, where
// there is no localStorage, and a first paint that disagreed with the
// stored choice would flicker.
const collapsed = ref(true);
const visible = computed(
  () => route.path.includes(API_ROOT) && entries.value.length > 0,
);

let unsubscribe: (() => void) | undefined;
onMounted(() => {
  entries.value = favoritesStore().list();
  collapsed.value = readCollapsed(
    typeof localStorage === "undefined" ? undefined : localStorage,
  );
  unsubscribe = favoritesStore().subscribe((next) => {
    entries.value = next;
  });
});
onUnmounted(() => unsubscribe?.());

function linkFor(entry: FavoriteEntry): string {
  return withBase(entry.path.endsWith("/") ? entry.path : `${entry.path}.html`);
}

function unstar(entry: FavoriteEntry): void {
  favoritesStore().remove(entry.path);
}

function toggle(): void {
  collapsed.value = !collapsed.value;
  writeCollapsed(
    collapsed.value,
    typeof localStorage === "undefined" ? undefined : localStorage,
  );
}
</script>

<template>
  <nav v-if="visible" class="favorites-section" aria-label="Favorites">
    <button
      type="button"
      class="favorites-toggle"
      :aria-expanded="!collapsed"
      aria-controls="favorites-list"
      @click="toggle"
    >
      <span
        class="favorites-caret"
        :class="{ open: !collapsed }"
        aria-hidden="true"
        >›</span
      >
      <span class="favorites-heading">★ Favorites ({{ entries.length }})</span>
    </button>
    <ul v-show="!collapsed" id="favorites-list" class="favorites-list">
      <li v-for="entry in entries" :key="entry.path" class="favorites-item">
        <a class="favorites-link" :href="linkFor(entry)">{{ entry.title }}</a>
        <button
          type="button"
          class="favorites-remove"
          :title="`Remove ${entry.title} from favorites`"
          :aria-label="`Remove ${entry.title} from favorites`"
          @click="unstar(entry)"
        >
          ✕
        </button>
      </li>
    </ul>
  </nav>
</template>
