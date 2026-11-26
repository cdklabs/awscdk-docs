<!--
  Star/unstar toggle for API pages. An icon-only button with hover text that
  teleports into the `type-action-fav` mount point of the docgen-emitted chip
  row, so the star sits with the page's other actions. An API page with no chip
  row of its own — a module or submodule overview — keeps the `breadcrumb-fav`
  spot in its breadcrumb bar, and a page with neither keeps the standalone
  doc-before placement. A page whose frontmatter says it has a chip row renders
  nothing until that mount point resolves, so the star never paints in a
  fallback placement and then jumps. State is read in onMounted so the
  SSG-rendered markup never mismatches hydration.
-->
<script setup lang="ts">
import { onContentUpdated, useData, useRoute } from "vitepress";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { favoritesStore, apiPathFrom, MAX_FAVORITES } from "./favorites";

const route = useRoute();
const { page } = useData();

const mounted = ref(false);
const starred = ref(false);
const capped = ref(false);
// The mount point the star teleports into. Re-resolved on every content
// update: SPA navigation replaces the rendered page and its elements.
const barTarget = ref<HTMLElement | null>(null);
// Whether that mount point is the chip row, which styles the star as a pill.
const inRow = ref(false);
// Whether THIS page has a chip row at all, known from frontmatter at
// server-render time. The mount point can only be queried in the browser, so
// without this the star would paint in its fallback placement and then move.
const hasRow = computed(() => page.value.frontmatter?.typeHeader === true);

// `route.path` carries the site base.
const pagePath = computed(() => apiPathFrom(route.path));
const isApiPage = computed(() => pagePath.value !== undefined);

function refresh(): void {
  const path = pagePath.value;
  starred.value = path !== undefined && favoritesStore().isFavorite(path);
  capped.value = false;
}

function resolveTarget(): void {
  if (typeof document === "undefined") {
    barTarget.value = null;
    inRow.value = false;
    return;
  }
  const row = document.querySelector<HTMLElement>(
    ".vp-doc .type-header-row .type-action-fav"
  );
  barTarget.value =
    row ??
    document.querySelector<HTMLElement>(
      ".vp-doc .type-breadcrumb .breadcrumb-fav"
    );
  inRow.value = row !== null;
}
onContentUpdated(resolveTarget);

let unsubscribe: (() => void) | undefined;
onMounted(() => {
  mounted.value = true;
  refresh();
  resolveTarget();
  unsubscribe = favoritesStore().subscribe(refresh);
});
onUnmounted(() => unsubscribe?.());
watch(pagePath, refresh);

const hoverText = computed(() =>
  starred.value ? "Remove from favorites" : "Add to favorites"
);

function toggle(): void {
  const path = pagePath.value;
  if (path === undefined) {
    return;
  }
  const result = favoritesStore().toggle({
    path,
    title: page.value.title || path,
  });
  starred.value = result.favorited;
  capped.value = result.rejected;
}
</script>

<template>
  <Teleport
    v-if="mounted && isApiPage && (inRow || !hasRow)"
    :to="barTarget ?? 'body'"
    :disabled="!barTarget"
  >
    <span
      class="favorite-star"
      :class="inRow ? 'in-row' : barTarget ? 'in-bar' : 'standalone'"
    >
      <span v-if="capped" class="favorite-star-cap" role="status">
        Favorites are limited to {{ MAX_FAVORITES }} pages — unstar one
        first.
      </span>
      <button
        type="button"
        class="favorite-star-button"
        :class="{ starred }"
        :aria-pressed="starred"
        :aria-label="hoverText"
        :title="hoverText"
        @click="toggle"
      >
        <span class="favorite-star-icon" aria-hidden="true">{{
          starred ? "★" : "☆"
        }}</span>
      </button>
    </span>
  </Teleport>
</template>
