<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { withBase } from "vitepress";
import type { Ref } from "vue";
import { displayLabel, groupKey, isActiveLink, type ApiSidebarNode } from "./api-sidebar";
import { isOpenWhileFiltering } from "./sidebar-filter";
import { collapseScrollDelta, isStuck, type StickyHeadings } from "./sidebar-sticky";

interface ApiSidebarContext {
  expanded: Ref<Set<string>>;
  activePath: Ref<string>;
  base: Ref<string>;
  toggle: (key: string) => void;
  /** True while the in-sidebar symbol filter is active. */
  filtering: Ref<boolean>;
  /** Groups folded during the current filter session; empty outside it. */
  filterCollapsed: Ref<Set<string>>;
  /** Shared display language; label variants flip with it. */
  displayLang: Ref<string>;
  /** Tracks which group heading is pinned under the header block. */
  sticky: StickyHeadings;
  /** The sidebar's scroll container, once mounted. */
  findScrollContainer: () => HTMLElement | null;
}

const props = defineProps<{
  node: ApiSidebarNode;
  parentKey: string;
  depth: number;
}>();

// Provided by the ApiSidebar root; always present when this renders.
const ctx = inject<ApiSidebarContext>("apiSidebar")!;

// A section still in its chunk file has no items yet but is a group.
const isGroup = computed(
  () => !!props.node.chunk || (Array.isArray(props.node.items) && props.node.items.length > 0),
);
const key = computed(() => groupKey(props.parentKey, props.node.text));
// The active language's display label: flips in place on a language switch while
// the key, link target, and filter stay on the canonical `node.text`.
const label = computed(() => displayLabel(props.node, ctx.displayLang.value));
// Full canonical FQN for the leaf link's `title`/`aria-label` when the short
// display label is in effect: the visible text drops the owner qualifier
// (`CfnTopic.SubscriptionProperty` -> `SubscriptionProperty`), so hover and
// assistive tech keep the owner-qualified name. Scoped to the short-label case:
// a per-language variant is the entry's name in that language, so overriding its
// accessible name would break label-in-name for voice control.
const canonicalName = computed(() =>
  !isGroup.value && props.node.label !== undefined && label.value === props.node.label
    ? props.node.text
    : undefined,
);
// The level tag is `aria-hidden`, so the level is spelled out here, appended
// after the visible name so label-in-name still holds for voice control
// ("click Bucket" matches; "L2 construct Bucket" would not).
const accessibleName = computed(() => {
  const level = !isGroup.value ? props.node.level : undefined;
  const base = canonicalName.value ?? label.value;
  return level ? `${base} (${level} construct)` : canonicalName.value;
});
// While the symbol filter is active every surviving group starts open so
// matches are reachable, and the reader may fold it for the rest of the filter
// session; those folds live in the root's `filterCollapsed` set. The user's own
// expanded set is left untouched and takes over again the moment the filter
// is cleared.
const open = computed(() =>
  ctx.filtering.value
    ? isOpenWhileFiltering(ctx.filterCollapsed.value, key.value)
    : ctx.expanded.value.has(key.value),
);
const active = computed(() =>
  isActiveLink(props.node.link, ctx.activePath.value, ctx.base.value),
);

function onToggle() {
  // The root decides where the toggle lands: the filter session's fold set
  // while filtering, the saved expansion state otherwise.
  const group = itemEl.value;
  const heading = group?.firstElementChild;
  // A heading clicked while pinned is far below its natural row. Collapsing
  // shrinks the group to that row, so bring it back under the header block
  // instead of leaving the reader at an unrelated position.
  const wasPinned =
    open.value &&
    !!group &&
    heading instanceof HTMLElement &&
    isStuck(heading.getBoundingClientRect().top, group.getBoundingClientRect().top);
  ctx.toggle(key.value);
  if (!wasPinned) return;
  nextTick(() => {
    const container = ctx.findScrollContainer();
    if (!container || !group) return;
    const header = container.querySelector<HTMLElement>(".sidebar-header");
    const headerBottom = header
      ? header.getBoundingClientRect().bottom
      : container.getBoundingClientRect().top;
    container.scrollTop += collapseScrollDelta(group.getBoundingClientRect().top, headerBottom);
  });
}

// Eligible to pin under the header: a collapsible group that is not a kind
// group. Only those `<li>`s are handed to the sticky tracker.
const itemEl = ref<HTMLElement | null>(null);
const sticky = computed(() => isGroup.value && !props.node.kindGroup);
watch(
  [itemEl, sticky],
  ([el, eligible], [prevEl]) => {
    if (prevEl && prevEl !== el) ctx.sticky.unregister(prevEl);
    if (!el) return;
    if (eligible) ctx.sticky.register(el);
    else ctx.sticky.unregister(el);
  },
  { flush: "post" },
);
onBeforeUnmount(() => {
  if (itemEl.value) ctx.sticky.unregister(itemEl.value);
});
</script>

<template>
  <!-- Fixed structural section: a non-collapsible heading whose children are
       always visible. Not a button: there is nothing to toggle. -->
  <li
    v-if="node.section"
    class="api-sidebar-item api-sidebar-section"
    :style="{ '--api-sidebar-depth': depth }"
  >
    <p class="api-sidebar-section-title">{{ label }}</p>
    <ul class="api-sidebar-list">
      <ApiSidebarItem
        v-for="child in node.items"
        :key="child.text + (child.link || '')"
        :node="child"
        :parent-key="key"
        :depth="depth + 1"
      />
    </ul>
  </li>
  <li v-else ref="itemEl" class="api-sidebar-item" :style="{ '--api-sidebar-depth': depth }" :data-depth="depth" :data-kind-group="node.kindGroup ? '' : undefined">
    <button
      v-if="isGroup"
      type="button"
      class="api-sidebar-group"
      :aria-expanded="open"
      @click="onToggle"
    >
      <span class="api-sidebar-caret" :class="{ open }" aria-hidden="true">›</span>
      <span class="api-sidebar-text">{{ label }}</span>
    </button>
    <a
      v-else
      class="api-sidebar-link"
      :class="{ active }"
      :href="withBase(node.link || '')"
      :title="canonicalName"
      :aria-label="accessibleName"
      :aria-current="active ? 'page' : undefined"
    >
      <!-- Construct level tag. Visually subordinate to the name and hidden from
           assistive tech, which gets the level from the link's aria-label. The
           glyph is drawn by the stylesheet from `data-level` rather than as DOM
           text, so the link's visible text stays the name alone. Only leveled
           constructs render it. -->
      <span v-if="node.level" class="api-sidebar-level" aria-hidden="true" :data-level="node.level"></span
      ><span class="api-sidebar-name">{{ label }}</span></a
    >

    <!-- Collapsed subtrees are not rendered. `v-show` would create every
         descendant and only set `display: none`, putting the whole ~96,500-node
         symbol tree in the DOM of every API page. Unmounting is safe because a
         child holds no state of its own: expansion lives in the root's shared
         `expanded` key set (and, while filtering, its `filterCollapsed` set), and
         `syncActive` derives the active page's ancestors
         from the tree data rather than the DOM. -->
    <ul v-if="isGroup && open" class="api-sidebar-list">
      <ApiSidebarItem
        v-for="child in node.items"
        :key="child.text + (child.link || '')"
        :node="child"
        :parent-key="key"
        :depth="depth + 1"
      />
    </ul>
  </li>
</template>
