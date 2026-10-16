<script setup lang="ts">
// Floating "back to top" control: returns the reader to the top of the document,
// animating the window scroller only, so the sidebar's scroll position and its
// per-route memory are untouched. Hidden until a meaningful scroll distance.
import { onMounted, onUnmounted, ref } from "vue";
import { animateScrollTop } from "./smooth-scroll";

// One viewport is "meaningful": above that the masthead is long gone and
// scrolling back by hand is real work; below it the control would flash
// in on every small scroll.
const visible = ref(false);

// Passive + rAF-throttled, matching the sidebar's onSidebarScroll shape:
// the handler only flips a ref, and at most once per frame.
let ticking = false;
function onScroll(): void {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    visible.value = window.scrollY > window.innerHeight;
    ticking = false;
  });
}

function toTop(): void {
  // Hand focus to the top-of-document target before moving: once the page
  // reaches the top this control hides itself, and `display: none` on a
  // still-focused button throws focus to <body>, leaving a keyboard or screen
  // reader user with no focused element. preventScroll keeps the animation as
  // the sole owner of the movement.
  const heading = document.querySelector<HTMLElement>(".vp-doc h1, main h1, h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
  animateScrollTop(document.documentElement, 0);
}

onMounted(() => {
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
});
onUnmounted(() => window.removeEventListener("scroll", onScroll));
</script>

<template>
  <Transition name="back-to-top">
    <button v-show="visible" type="button" class="back-to-top" @click="toTop()">
      <span class="glyph glyph-top back-to-top-glyph" aria-hidden="true" />
      <span class="visually-hidden">Back to top</span>
    </button>
  </Transition>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  right: 24px;
  bottom: 24px;
  /* The theme's floating-control elevation (type tooltips, settings menu). */
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 50%;
  background-color: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

.back-to-top:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.back-to-top:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

/* Accessible name without visible text: the glyph is the whole visual,
   so there is no visible label for an accessible name to mismatch
   (WCAG 2.5.3 concerns labels that ARE visible). */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.back-to-top-enter-active,
.back-to-top-leave-active {
  transition: opacity 0.2s;
}

.back-to-top-enter-from,
.back-to-top-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .back-to-top-enter-active,
  .back-to-top-leave-active {
    transition: none;
  }
}

/* WCAG 2.5.5 touch-target floor, same breakpoint band as responsive.css. */
@media (max-width: 767px) {
  .back-to-top {
    width: 44px;
    height: 44px;
    right: 16px;
    bottom: 16px;
  }
}

.back-to-top-glyph {
  width: 16px;
  height: 16px;
}
</style>
