<script setup lang="ts">
// The default theme's outline item (VPDocOutlineItem), with two additions. A member entry whose row is optional shows
// the same `?` mark the row does; the mark is hidden from assistive technology, which hears the kind's label instead
// ("optional" for an input, "may be undefined" for an output) -- docs/adr/2026-10-23-optional-prop-marker.md. A
// method entry shows its parameter names after the name: `grantRead(identity, objectsKeyPattern?)`, a trailing `?`
// on an optional parameter, `...` before a variadic one, `()` when empty. Those marks are glyphs too, so a screen
// reader gets hidden words instead: "optional" after the parameter, "variadic" before the rest parameter
// (docs/adr/2026-10-26-outline-method-parameters.md). The list takes the link's own color: it is the content the
// entry exists to show, so it meets the same contrast the name does. A `<wbr>` between the name and the list gives
// a long entry a break point at the parenthesis, so the column's `overflow-wrap: anywhere` does not split a word
// first. Markup, classes and styles are otherwise the default theme's own, so outline.css applies unchanged.
import { OPTIONAL_LABELS, formatParams, type OutlineItem } from "./outline-members";

defineProps<{
  headers: OutlineItem[];
  root?: boolean;
}>();

function onClick(event: Event) {
  // `currentTarget`, not `target`: a click on a mark or a parameter lands on its span, which has no href.
  const id = (event.currentTarget as HTMLAnchorElement).href.split("#")[1];
  const heading = document.getElementById(decodeURIComponent(id));
  heading?.focus({ preventScroll: true });
}
</script>

<template>
  <ul class="VPDocOutlineItem" :class="root ? 'root' : 'nested'">
    <li v-for="{ children, link, title, optional, params } in headers" :key="link">
      <a
        class="outline-link"
        :class="{ 'outline-link-method': params }"
        :href="link"
        @click="onClick"
        :title="params ? `${title}${formatParams(params)}` : title"
        >{{ title
        }}<span v-if="optional" class="outline-optional"
          ><span aria-hidden="true">?</span
          ><span class="outline-optional-label">{{ OPTIONAL_LABELS[optional] }}</span></span
        ><wbr v-if="params" /><span v-if="params" class="outline-params"
          >(<template v-for="(param, index) in params" :key="param.name"
            ><template v-if="index > 0">, </template><template v-if="param.variadic"
              ><span aria-hidden="true">...</span><span class="outline-optional-label">variadic </span></template
            >{{ param.name }}<template v-if="param.optional"
              ><span aria-hidden="true">?</span><span class="outline-optional-label"> optional</span></template
            ></template
          >)</span
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

/* The marks and the parameter list are display only: never part of a copied name. The list inherits the link's
   color on purpose: a quieter token fails the 4.5:1 contrast floor at rest. */
.outline-optional,
.outline-params {
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
