<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { Ref } from "vue";
import { displayLabel, groupKey, isActiveLink, isUnloadedChunk, type ApiSidebarNode } from "./api-sidebar";
import { pageHref } from "./page-href";
import { isOpenWhileFiltering } from "./sidebar-filter";
import { collapseScrollDelta, isStuck, type StickyHeadings } from "./sidebar-sticky";

interface ApiSidebarContext {
  expanded: Ref<Set<string>>;
  activePath: Ref<string>;
  base: Ref<string>;
  toggle: (key: string) => void;
  /** Fetches a closed group's chunk once its heading has been in view for a moment. */
  watchHeading: (el: Element, key: string) => void;
  unwatchHeading: (el: Element) => void;
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
  /** True while the Explorer's Services view is showing; only it renders counts. */
  servicesView: Ref<boolean>;
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
// The number at a row's right edge, in the Services view only: a closed
// service's construct count from the skeleton (which the API view's service
// rows carry too, and do not show), a part's or kind group's row count, a
// module's type count. While filtering, a service's count is its matching
// rows, so it follows the pruned items rather than the skeleton.
const count = computed(() => {
  if (!ctx.servicesView.value || props.node.count === undefined) return undefined;
  if (ctx.filtering.value && isGroup.value && !props.node.kindGroup) return props.node.items?.length ?? 0;
  return props.node.count;
});
// A service row reads as one name with its count: `S3, 16 constructs`, or
// `S3, 5 matches` while filtering. The name is composed from the row's own
// content (the visible name, then the count with hidden text around it)
// rather than an `aria-label`: an override would have to repeat the visible
// text exactly, count included, to keep label-in-name (WCAG 2.5.3), and the
// count is itself part of the visible text. Kind groups and module rows keep
// their visible text as their name; their counts are decorative.
const countNoun = computed(() => {
  if (count.value === undefined || props.node.kindGroup || !isGroup.value) return undefined;
  if (ctx.filtering.value) return count.value === 1 ? " match" : " matches";
  return count.value === 1 ? " construct" : " constructs";
});
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
// An open group whose own child list holds the active page link. The
// stylesheet accents this group's nesting guide line, so only the innermost
// group around the current page is marked.
const activeParent = computed(
  () =>
    isGroup.value &&
    open.value &&
    (props.node.items ?? []).some(
      (child) => !child.section && isActiveLink(child.link, ctx.activePath.value, ctx.base.value),
    ),
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

// A closed group backed by a chunk file hands its heading to the root, which fetches
// any chunk it still misses once the heading has been in view for a moment.
const headingEl = ref<HTMLElement | null>(null);
const preloadable = computed(
  () => isGroup.value && !open.value && (isUnloadedChunk(props.node) || !!props.node.chunks?.length),
);
watch(
  [headingEl, preloadable, key],
  ([el, eligible, groupKey], previous) => {
    const prevEl = previous?.[0];
    if (prevEl && (prevEl !== el || !eligible)) ctx.unwatchHeading(prevEl);
    if (el && eligible) ctx.watchHeading(el, groupKey);
  },
  { flush: "post", immediate: true },
);

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
  if (headingEl.value) ctx.unwatchHeading(headingEl.value);
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
  <!-- A part of an open service in the Services view (Modules, Constructs,
       Types): a sub-heading that is not a control, over a list named by it.
       Its rows sit at the part's own depth, under the service's row, so the
       part adds a heading but no indent. -->
  <li
    v-else-if="node.part"
    class="api-sidebar-item api-sidebar-part"
    :style="{ '--api-sidebar-depth': depth }"
    :data-part="node.text"
  >
    <p class="api-sidebar-part-title">
      <span class="api-sidebar-part-name">{{ label }}</span>
      <span v-if="count !== undefined" class="api-sidebar-count">{{ count }}</span>
    </p>
    <ul class="api-sidebar-list" :aria-label="label">
      <ApiSidebarItem
        v-for="child in node.items"
        :key="child.text + (child.link || '')"
        :node="child"
        :parent-key="key"
        :depth="depth"
      />
    </ul>
  </li>
  <li v-else ref="itemEl" class="api-sidebar-item" :style="{ '--api-sidebar-depth': depth }" :data-depth="depth" :data-kind-group="node.kindGroup ? '' : undefined" :data-active-parent="activeParent ? '' : undefined">
    <button
      v-if="isGroup"
      ref="headingEl"
      type="button"
      class="api-sidebar-group"
      :aria-expanded="open"
      @click="onToggle"
    >
      <span class="api-sidebar-caret" :class="{ open }" aria-hidden="true">›</span>
      <!-- The row's name and count are flex items, which the name computation separates with a space, so the
           hidden comma ends the name span and the hidden noun ends the count: `S3, 16 constructs`. -->
      <span class="api-sidebar-text"
        >{{ label }}<span v-if="countNoun !== undefined" class="api-sidebar-hidden">,</span></span
      >
      <span v-if="countNoun !== undefined" class="api-sidebar-count"
        >{{ count }}<span class="api-sidebar-hidden">{{ countNoun }}</span></span
      >
      <span v-else-if="count !== undefined" class="api-sidebar-count" aria-hidden="true">{{ count }}</span>
    </button>
    <a
      v-else
      class="api-sidebar-link"
      :class="{ active, 'api-sidebar-module': node.moduleRow }"
      :href="pageHref(node.link || '')"
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
      ><span class="api-sidebar-name">{{ label }}</span
      ><span v-if="count !== undefined" class="api-sidebar-count" aria-hidden="true">{{ count }}</span></a
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
