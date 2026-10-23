<script setup lang="ts">
// The default theme's outline item, rendering a method entry's parameter list after its name. The markup and
// classes are VPDocOutlineItem's own, so the aside outline's active-link tracking and the outline.css wrapping
// rules keep working unchanged. A method entry reads `grantRead(identity, objectsKeyPattern?)`: names only, a
// trailing `?` on an optional parameter, `...` before a variadic one, `()` when empty. The marks are glyphs, so a
// screen reader gets hidden words instead: "optional" after the parameter, "variadic" before the rest parameter
// (docs/adr/2026-10-23-outline-method-parameters.md). A `<wbr>` between the name and the list gives a long entry a
// break point at the parenthesis, so the column's `overflow-wrap: anywhere` does not split a word first.
import { formatParams, type OutlineItem } from "./outline-members";

defineProps<{
  headers: OutlineItem[];
  root?: boolean;
}>();

function onClick(event: Event): void {
  // The parameter spans make the click target a child of the link, so read the href off the link itself.
  const id = (event.currentTarget as HTMLAnchorElement).href.split("#")[1];
  const heading = document.getElementById(decodeURIComponent(id));
  heading?.focus({ preventScroll: true });
}
</script>

<template>
  <ul class="VPDocOutlineItem" :class="root ? 'root' : 'nested'">
    <li v-for="{ children, link, title, params } in headers" :key="link">
      <a
        class="outline-link"
        :class="{ 'outline-link-method': params }"
        :href="link"
        @click="onClick"
        :title="params ? `${title}${formatParams(params)}` : title"
      >
        <span class="outline-name">{{ title }}</span><wbr v-if="params" /><span v-if="params" class="outline-params"
          >(<template v-for="(param, index) in params" :key="param.name"
            ><template v-if="index > 0">, </template><template v-if="param.variadic"
              ><span aria-hidden="true">...</span><span class="visually-hidden">variadic </span></template
            >{{ param.name }}<template v-if="param.optional"
              ><span aria-hidden="true">?</span><span class="visually-hidden"> optional</span></template
            ></template
          >)</span
        >
      </a>
      <template v-if="children?.length">
        <ApiDocOutlineItem :headers="children" />
      </template>
    </li>
  </ul>
</template>

<style scoped>
/* Copied from the default theme's VPDocOutlineItem, whose scoped styles do not reach a replacement component. */
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
  line-height: 32px;
  font-size: 14px;
  font-weight: 400;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

/* The parameter list is secondary to the name: one step quieter, same size, so a long list wraps as ordinary text
   and the name still leads the entry. Hover and active lift it with the rest of the link. */
.outline-params {
  color: var(--vp-c-text-3);
  transition: color 0.5s;
}

.outline-link:hover .outline-params,
.outline-link.active .outline-params {
  color: var(--vp-c-text-2);
  transition: color 0.25s;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
