<script setup lang="ts">
// "Locate current page" asks the API sidebar to reveal the active entry or flash it when already visible.
//
// In the Explorer's Services view a page that is in no service (a framework or `constructs` page) has nothing to
// locate: the control stays in place and focusable but is dimmed (`aria-disabled`, not `disabled`, so keyboard
// focus still reaches it), activation does nothing, and a tooltip says why. The tooltip shows on hover, on
// keyboard focus and on activation; it stays while the pointer is over the control or the tooltip (the hover
// handlers sit on the root that holds both, and the tooltip bridges the gap to the control), or the control has
// focus, or it was activated (each trigger is tracked on its own), and it hides on Escape from anywhere, on a
// tap elsewhere, and once no trigger holds (WCAG 1.4.13). It is always in the DOM while the control is dimmed,
// so `aria-describedby` has a target.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useData, useRoute } from "vitepress";
import { API_ROOT } from "../../../src/site-routes";
import { normalizePath } from "./api-sidebar";
import { swallowEscapeRelease } from "./escape-release";
import { jumpToCurrentUnavailable, requestJumpToCurrent } from "./sidebar-jump";

const route = useRoute();
const { site } = useData();

const base = computed(() => site.value.base || "/");
const activePath = computed(() => normalizePath(route.path, base.value));
const show = computed(() => activePath.value.startsWith(API_ROOT.replace(/^\//, "")));
const unavailable = computed(() => jumpToCurrentUnavailable.value);

const TOOLTIP_ID = "sidebar-jump-current-tip";
const rootEl = ref<HTMLElement | null>(null);
// Each trigger on its own, so the tooltip stays while any of them holds (WCAG 1.4.13): the pointer leaving does
// not hide a tooltip the focused control still owes, and blur does not hide one the pointer still hovers.
const hovered = ref(false);
const focused = ref(false);
const activated = ref(false);
const tipOpen = computed(() => hovered.value || focused.value || activated.value);

function dismiss(): void {
  hovered.value = false;
  focused.value = false;
  activated.value = false;
}

function activate(): void {
  if (!unavailable.value) {
    requestJumpToCurrent();
    return;
  }
  // Activation on a dimmed control opens the tooltip; Escape, blur and a tap elsewhere hide it. Leaving alone
  // does not, since the activation still holds it.
  activated.value = true;
}

function onBlur(): void {
  focused.value = false;
  // An activation belongs to the focused control; leaving it ends the activation too.
  activated.value = false;
}

// Escape hides the tooltip wherever focus is: a tooltip opened by hover while the filter has focus must be
// dismissible without moving the pointer. The release is stopped too, or in the drawer the same Escape would
// close the drawer and move focus out of it.
function onDocumentKeydown(event: KeyboardEvent): void {
  // Only while a tooltip is on screen: the live control records hover and focus too, with nothing rendered,
  // and an Escape swallowed then would stop the search dialog from closing.
  if (event.key === "Escape" && unavailable.value && tipOpen.value) {
    dismiss();
    event.stopPropagation();
    swallowEscapeRelease();
  }
}

// A tap (or click) anywhere outside the control hides the tooltip.
function onDocumentPointerDown(event: PointerEvent): void {
  if (!tipOpen.value) return;
  const target = event.target as Node | null;
  if (rootEl.value && target && rootEl.value.contains(target)) return;
  dismiss();
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeydown);
});
</script>

<template>
  <span
    v-if="show"
    ref="rootEl"
    class="sidebar-jump-current-root"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <button
      type="button"
      class="sidebar-jump-current"
      :class="{ unavailable }"
      :aria-disabled="unavailable ? 'true' : undefined"
      :aria-describedby="unavailable ? TOOLTIP_ID : undefined"
      @click="activate"
      @focus="focused = true"
      @blur="onBlur"
    >
      <span class="glyph glyph-locate jump-to-current-glyph" aria-hidden="true" />
      <span class="sidebar-jump-current-text">Locate current page</span>
    </button>
    <span
      v-if="unavailable"
      :id="TOOLTIP_ID"
      role="tooltip"
      class="sidebar-jump-current-tip"
      :class="{ open: tipOpen }"
    >This page is not in Services</span>
  </span>
</template>

<style scoped>
.sidebar-jump-current-root {
  position: relative;
  display: inline-flex;
}

.sidebar-jump-current {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 24px of hit area (WCAG 2.5.8), matching the 24px row the sidebar header
     reserves, so the header keeps one height whether this control renders or
     not. */
  min-height: 24px;
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

/* Nothing to locate: dimmed, still focusable, and no hover accent. A dimmed
   control is exempt from the contrast rule. Only the contents are dimmed, so
   the focus ring keeps its full strength. */
.sidebar-jump-current.unavailable,
.sidebar-jump-current.unavailable:hover {
  cursor: not-allowed;
  color: var(--vp-c-text-2);
}

.sidebar-jump-current.unavailable > * {
  opacity: 0.6;
}

/* Right-aligned under the button with a 4px gap, over the sidebar content.
   Hidden with `visibility`, not `display`, so it keeps its box for
   `aria-describedby` and shows without reflow. Its `::before` fills the gap,
   so the pointer can move from the control onto the tooltip without
   leaving the root and hiding it. */
.sidebar-jump-current-tip {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 3;
  padding: 4px 8px;
  border-radius: 6px;
  background-color: var(--vp-c-text-1);
  color: var(--vp-c-bg);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 7, 22, 0.22);
  visibility: hidden;
}

.sidebar-jump-current-tip::before {
  content: "";
  position: absolute;
  top: -4px;
  right: 0;
  left: 0;
  height: 4px;
}

.sidebar-jump-current-tip.open {
  visibility: visible;
}

.jump-to-current-glyph {
  width: 12px;
  height: 12px;
}
</style>
