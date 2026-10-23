<script setup lang="ts">
// The default theme's aside outline, with a type page's members nested under their section headings.
// Swapped in for VPDocAsideOutline by the alias in config.mts; the markup and styling are the default theme's own.
// Member rows are not headings, so the heading-built outline cannot list them: docgen writes them to the page's
// `outlineMembers` frontmatter instead (docs/adr/2026-10-22-outline-members.md).
import { getScrollOffset, onContentUpdated, useData } from "vitepress";
// The default theme's own helpers, so headings and the outline title resolve exactly as before.
import { getHeaders, resolveTitle } from "vitepress/dist/client/theme-default/composables/outline.js";
import { useAside } from "vitepress/dist/client/theme-default/composables/aside.js";
import { throttleAndDebounce } from "vitepress/dist/client/theme-default/support/utils.js";
import VPDocOutlineItem from "vitepress/dist/client/theme-default/components/VPDocOutlineItem.vue";
import { onMounted, onUnmounted, onUpdated, ref, shallowRef } from "vue";
import { nestOutlineMembers, type OutlineItem, type OutlineMembers } from "./outline-members";

const { frontmatter, theme } = useData();
const { isAsideEnabled } = useAside();

const headers = shallowRef<OutlineItem[]>([]);

onContentUpdated(() => {
  headers.value = nestOutlineMembers(
    getHeaders(frontmatter.value.outline ?? theme.value.outline) as OutlineItem[],
    frontmatter.value.outlineMembers as OutlineMembers | undefined,
  );
});

const container = ref<HTMLElement>();
const marker = ref<HTMLElement>();

// Active-link tracking. The default theme's tracker follows only the headings it collected itself, so a member entry
// would never light up while scrolling. This is the same algorithm over every outline entry, members included: the
// active entry is the last one whose target sits above the top of the viewport.
function flatten(items: OutlineItem[]): string[] {
  return items.flatMap((item) => [item.link, ...flatten(item.children)]);
}

function absoluteTop(element: HTMLElement | null): number {
  let top = 0;
  while (element !== document.body) {
    // Detached, hidden or fixed: not a scroll position.
    if (element === null) {
      return NaN;
    }
    top += element.offsetTop;
    element = element.offsetParent as HTMLElement | null;
  }
  return top;
}

let previous: HTMLElement | null = null;

function activate(hash: string | null): void {
  previous?.classList.remove("active");
  previous = hash == null ? null : container.value?.querySelector<HTMLElement>(`a[href="${decodeURIComponent(hash)}"]`) ?? null;
  if (!marker.value) {
    return;
  }
  if (previous) {
    previous.classList.add("active");
    marker.value.style.top = `${previous.offsetTop + 39}px`;
    marker.value.style.opacity = "1";
  } else {
    marker.value.style.top = "33px";
    marker.value.style.opacity = "0";
  }
}

function setActiveLink(): void {
  if (!isAsideEnabled.value) {
    return;
  }
  const scrollY = window.scrollY;
  const atBottom = Math.abs(scrollY + window.innerHeight - document.body.offsetHeight) < 1;
  const targets = flatten(headers.value)
    .map((link) => ({ link, top: absoluteTop(document.getElementById(decodeURIComponent(link.slice(1)))) }))
    .filter(({ top }) => !Number.isNaN(top))
    .sort((a, b) => a.top - b.top);
  if (!targets.length || scrollY < 1) {
    activate(null);
    return;
  }
  if (atBottom) {
    activate(targets[targets.length - 1].link);
    return;
  }
  let active: string | null = null;
  for (const { link, top } of targets) {
    if (top > scrollY + getScrollOffset() + 4) {
      break;
    }
    active = link;
  }
  activate(active);
}

const onScroll = throttleAndDebounce(setActiveLink, 100);

// Keep the outline from overlapping the footer. The default theme's aside wrapper
// (`.aside-container`) is `position: fixed; height: 100vh`, so its lower edge always
// sits at the viewport bottom. The default theme hides the footer on doc pages, but
// this site renders a `SiteFooter` on every page — so once the footer scrolls into
// view, the fixed aside paints over it. Cap the aside wrapper's height at the footer's
// top edge while the footer is visible; otherwise leave it at its natural height. The
// wrapper already has `overflow-y: auto`, so a tall outline just scrolls internally.
function boundAgainstFooter(): void {
  const asideContainer = container.value?.closest<HTMLElement>(".aside-container");
  if (!asideContainer) {
    return;
  }
  // VitePress renders a sibling `.aside-curtain` (fixed, bottom: 0) that fades the
  // outline's lower edge. It is pinned to the viewport bottom independently of the
  // container, so it must be bounded against the footer alongside it.
  const curtain = asideContainer.parentElement?.querySelector<HTMLElement>(".aside-curtain");
  const footer = document.querySelector<HTMLElement>("footer.site-footer");
  const footerTop = footer ? footer.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
  // .aside-container is fixed at top: 0 (its content is pushed down by padding-top),
  // so its own rect top is where the cap starts.
  const asideTop = asideContainer.getBoundingClientRect().top;
  if (footerTop < window.innerHeight) {
    // Footer is on screen: bound the wrapper's bottom to the footer's top (never negative),
    // and lift the curtain so its fade band sits above the footer rather than over it.
    asideContainer.style.maxHeight = `${Math.max(0, footerTop - asideTop)}px`;
    if (curtain) {
      curtain.style.bottom = `${Math.max(0, window.innerHeight - footerTop)}px`;
    }
  } else {
    // Footer is below the fold: no cap, restore natural behavior.
    asideContainer.style.maxHeight = "";
    if (curtain) {
      curtain.style.bottom = "";
    }
  }
}

const onScrollBound = throttleAndDebounce(boundAgainstFooter, 100);

onMounted(() => {
  requestAnimationFrame(setActiveLink);
  requestAnimationFrame(boundAgainstFooter);
  window.addEventListener("scroll", onScroll);
  window.addEventListener("scroll", onScrollBound);
  window.addEventListener("resize", onScrollBound);
});
onUpdated(() => {
  // A route change re-renders the outline.
  activate(location.hash);
  boundAgainstFooter();
});
onUnmounted(() => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("scroll", onScrollBound);
  window.removeEventListener("resize", onScrollBound);
  // Clear the inline styles written on the shared default-theme nodes, which this
  // component does not own, so a reused wrapper is not left with a stranded cap.
  const asideContainer = container.value?.closest<HTMLElement>(".aside-container");
  asideContainer?.style.setProperty("max-height", "");
  asideContainer?.parentElement?.querySelector<HTMLElement>(".aside-curtain")?.style.setProperty("bottom", "");
});
</script>

<template>
  <nav
    aria-labelledby="doc-outline-aria-label"
    class="VPDocAsideOutline"
    :class="{ 'has-outline': headers.length > 0 }"
    ref="container"
  >
    <div class="content">
      <div class="outline-marker" ref="marker" />

      <div aria-level="2" class="outline-title" id="doc-outline-aria-label" role="heading">
        {{ resolveTitle(theme) }}
      </div>

      <VPDocOutlineItem :headers="headers" :root="true" />
    </div>
  </nav>
</template>

<style scoped>
/* Copied from the default theme's VPDocAsideOutline, whose scoped styles do not reach a replacement component. */
.VPDocAsideOutline {
  display: none;
}

.VPDocAsideOutline.has-outline {
  display: block;
}

.content {
  position: relative;
  border-left: 1px solid var(--vp-c-divider);
  padding-left: 16px;
  font-size: 13px;
  font-weight: 500;
}

.outline-marker {
  position: absolute;
  top: 32px;
  left: -1px;
  z-index: 0;
  opacity: 0;
  width: 2px;
  border-radius: 2px;
  height: 18px;
  background-color: var(--vp-c-brand-1);
  transition:
    top 0.25s cubic-bezier(0, 1, 0.5, 1),
    background-color 0.5s,
    opacity 0.25s;
}

.outline-title {
  line-height: 32px;
  font-size: 14px;
  font-weight: 600;
}
</style>
