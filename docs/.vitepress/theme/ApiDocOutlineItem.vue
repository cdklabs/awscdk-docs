<script setup lang="ts">
// The default theme's outline item (VPDocOutlineItem), with one addition: a member entry whose row is optional shows
// the same `?` mark the row does. The mark is hidden from assistive technology, which hears the kind's label instead
// ("optional" for an input, "may be undefined" for an output). Markup, classes and styles are otherwise the default
// theme's own, so outline.css applies unchanged. See docs/adr/2026-10-23-optional-prop-marker.md.
import { OPTIONAL_LABELS, type OutlineItem } from "./outline-members";

defineProps<{
  headers: OutlineItem[];
  root?: boolean;
}>();

function onClick(event: Event) {
  // `currentTarget`, not `target`: a click on the mark lands on its span, which has no href.
  const id = (event.currentTarget as HTMLAnchorElement).href.split("#")[1];
  const heading = document.getElementById(decodeURIComponent(id));
  heading?.focus({ preventScroll: true });
}
</script>

<template>
  <ul class="VPDocOutlineItem" :class="root ? 'root' : 'nested'">
    <li v-for="{ children, link, title, optional } in headers" :key="link">
      <a class="outline-link" :href="link" @click="onClick" :title="title"
        >{{ title
        }}<span v-if="optional" class="outline-optional"
          ><span aria-hidden="true">?</span
          ><span class="outline-optional-label">{{ OPTIONAL_LABELS[optional] }}</span></span
        ></a
      >
      <template v-if="children?.length">
        <ApiDocOutlineItem :headers="children" />
      </template>
    </li>
  </ul>
</template>

<style scoped>
/* Copied from the default theme's VPDocOutlineItem, whose scoped styles do not reach a replacement component. Its
   line-height, nowrap and ellipsis are left out: this item only renders inside the aside outline, where outline.css
   replaces exactly those, and leaving them here would make the result depend on stylesheet order. */
.root {
  position: relative;
  z-index: 1;
}

.nested {
  padding-right: 16px;
  padding-left: 16px;
}

.outline-link {
  display: block;
  font-size: 14px;
  font-weight: 400;
  color: var(--vp-c-text-2);
  transition: color 0.5s;
}

.outline-link:hover,
.outline-link.active {
  color: var(--vp-c-text-1);
  transition: color 0.25s;
}

.outline-link.nested {
  padding-left: 13px;
}

/* The mark is display only: never part of a copied name. */
.outline-optional {
  user-select: none;
}

/* Same technique as the member rows' label: read by assistive technology, never painted. */
.outline-optional-label {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
