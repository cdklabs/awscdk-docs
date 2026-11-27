<!-- "Copy Markdown" split button (a labeled region, so landmark navigation reaches it). On a type page it
     teleports into the `type-action-copy` mount point of the docgen-emitted chip row, beside the favorite star;
     every other API page keeps the doc-before slot at the top of the page. On a page whose frontmatter says it has
     a chip row, the control waits in `doc-before` taking no space until that mount point resolves, so it never
     paints in the fallback placement and then jumps, while the served HTML still carries the link to the twin for
     an agent or crawler that reads the markup without running JavaScript. The main button copies the page's
     Markdown twin; the options button opens a one-item menu that links the file in a new tab. A page without a
     twin (no `agentMarkdown` frontmatter) renders nothing. -->
<script setup lang="ts">
import { onContentUpdated, useData } from "vitepress";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { agentMarkdownHref } from "../agent-markdown";
import { copyMarkdownFrom, type CopyResult } from "../copy-markdown";

const { page, site } = useData();

const markdownUrl = computed(() => {
  const twin = page.value.frontmatter?.agentMarkdown;
  return typeof twin === "string" ? agentMarkdownHref(twin, site.value.base) : undefined;
});

const RESULT_MS = 2000;
const REANNOUNCE_MS = 100;
const result = ref<CopyResult | undefined>(undefined);
// What the live region says. It lags `result` by a beat on purpose, see `copy()`; the button text does not.
const announcement = ref("");
const menuOpen = ref(false);
// Set once hydration has run, so a test (or any script) can tell a live button from the server-rendered shell.
const ready = ref(false);
const root = ref<HTMLElement | null>(null);
// The chip row's copy mount point, re-resolved on every content update: SPA
// navigation replaces the rendered page and its row element.
const rowTarget = ref<HTMLElement | null>(null);
// Whether THIS page has a chip row, known from frontmatter at server-render
// time. The mount point itself can only be queried in the browser, so without
// this the control would paint in `doc-before` first and move on mount,
// shifting the whole header on every type-page load.
const hasRow = computed(() => page.value.frontmatter?.typeHeader === true);
const optionsButton = ref<HTMLButtonElement | null>(null);
const viewLink = ref<HTMLAnchorElement | null>(null);
let resetTimer: ReturnType<typeof setTimeout> | undefined;
// Counts clicks and navigations. A copy that finished after either one is stale and must not touch the page.
let generation = 0;

const label = computed(() =>
  result.value === "copied" ? "Copied" : result.value === "failed" ? "Copy failed" : "Copy Markdown"
);

async function copy(): Promise<void> {
  if (!markdownUrl.value) return;
  // A pointer press on this button is inside `root`, so the outside-press handler leaves an open menu alone.
  if (menuOpen.value) closeMenu(false);
  const mine = ++generation;
  const outcome = await copyMarkdownFrom(markdownUrl.value, {
    fetch: (url) => fetch(url),
    clipboard: {
      writeText: (text) => navigator.clipboard.writeText(text),
      write: (items) => navigator.clipboard.write(items as ClipboardItem[]),
    },
    item:
      typeof ClipboardItem === "undefined"
        ? undefined
        : (text) =>
            new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) }),
  });
  if (mine !== generation) return;
  // The button shows the result at once. The live region is cleared first and refilled after REANNOUNCE_MS, so a
  // repeat of the same result still changes it and screen readers speak again. A single tick is not enough, since
  // both updates would land before the browser paints. The clipboard write has already started, so the click's
  // user activation is not at stake.
  result.value = outcome;
  announcement.value = "";
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    result.value = undefined;
    announcement.value = "";
  }, RESULT_MS);
  await new Promise((resolve) => setTimeout(resolve, REANNOUNCE_MS));
  if (mine !== generation) return;
  announcement.value = label.value;
}

async function openMenu(): Promise<void> {
  menuOpen.value = true;
  await nextTick();
  viewLink.value?.focus();
}

function closeMenu(restoreFocus: boolean): void {
  menuOpen.value = false;
  if (restoreFocus) optionsButton.value?.focus();
}

function toggleMenu(): void {
  if (menuOpen.value) closeMenu(false);
  else void openMenu();
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    // The menu has one item, so both arrows land on it.
    event.preventDefault();
    viewLink.value?.focus();
  } else if (event.key === " ") {
    // Space activates a menu item. Without this the link's default action scrolls the page behind the menu.
    event.preventDefault();
    viewLink.value?.click();
  } else if (event.key === "Tab") {
    closeMenu(false);
  }
}

// Focus moving to an element outside the control closes the menu. A null relatedTarget (a window or tab switch)
// is ignored. This covers focus that moves by script or by a screen reader, which sends no pointer press.
function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null;
  if (menuOpen.value && next && root.value && !root.value.contains(next)) closeMenu(false);
}

function onDocumentPointerDown(event: Event): void {
  if (menuOpen.value && root.value && !root.value.contains(event.target as Node)) {
    closeMenu(false);
  }
}

// The component stays mounted across client-side navigation: drop any open menu or result from the last page.
watch(
  () => page.value.relativePath,
  () => {
    generation++;
    menuOpen.value = false;
    result.value = undefined;
    announcement.value = "";
    clearTimeout(resetTimer);
  }
);

function resolveRowTarget(): void {
  rowTarget.value =
    typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>(".vp-doc .type-header-row .type-action-copy");
}
onContentUpdated(resolveRowTarget);

onMounted(() => {
  ready.value = true;
  resolveRowTarget();
  document.addEventListener("pointerdown", onDocumentPointerDown);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  clearTimeout(resetTimer);
});
</script>

<template>
  <Teleport :to="rowTarget ?? 'body'" :disabled="!rowTarget">
  <section
    v-if="markdownUrl"
    ref="root"
    class="copy-markdown"
    :class="hasRow ? (rowTarget ? 'in-row' : 'pending') : 'standalone'"
    @focusout="onFocusOut"
    aria-label="Page Markdown"
    :data-ready="ready ? '' : undefined"
    data-pagefind-ignore
  >
    <div class="copy-markdown-split">
      <button type="button" class="copy-markdown-main" @click="copy">{{ label }}</button>
      <button
        id="copy-markdown-options"
        ref="optionsButton"
        type="button"
        class="copy-markdown-options"
        aria-label="More Markdown options"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        aria-controls="copy-markdown-menu"
        @click="toggleMenu"
        @keydown.escape.prevent="closeMenu(true)"
      >
        <span aria-hidden="true">▾</span>
      </button>
    </div>
    <div
      v-show="menuOpen"
      id="copy-markdown-menu"
      class="copy-markdown-menu"
      role="menu"
      aria-labelledby="copy-markdown-options"
      @keydown="onMenuKeydown"
    >
      <a
        ref="viewLink"
        class="copy-markdown-item"
        role="menuitem"
        :href="markdownUrl"
        target="_blank"
        rel="noopener noreferrer"
        @click="closeMenu(true)"
      >
        <span
          >View as Markdown<span aria-hidden="true"> ↗</span
          ><span class="copy-markdown-sr-only"> (opens in a new tab)</span></span
        >
      </a>
    </div>
    <span class="copy-markdown-status" role="status" aria-live="polite">{{ announcement }}</span>
  </section>
  </Teleport>
</template>

<style scoped>
/* VitePress theme variables only, so the control follows light/dark. */
.copy-markdown {
  position: relative;
  display: inline-block;
}

.copy-markdown.standalone {
  margin-bottom: 8px;
}

/* A type page renders the control in `doc-before` until the chip row's mount
   point resolves, then teleports it. While it waits it must take no space:
   the row reserves its own room for the pills, and painting them above the
   breadcrumb first would shift the whole page. Hidden this way rather than
   left unrendered so the served HTML still carries the link to the Markdown
   twin for an agent or crawler reading the markup without running JavaScript. */
.copy-markdown.pending {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  /* Out of the tab order and the accessibility tree as well as out of the
     layout: the buttons do nothing until the handlers are attached, and a
     keyboard user must not land on two invisible ones before the breadcrumb. */
  visibility: hidden;
}

.copy-markdown-split {
  display: inline-flex;
}

.copy-markdown-main,
.copy-markdown-options {
  padding: 4px 10px;
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
}

.copy-markdown-main {
  min-width: 8.5em;
  border-radius: 6px 0 0 6px;
}

.copy-markdown-options {
  border-left: 0;
  border-radius: 0 6px 6px 0;
}

.copy-markdown-main:hover,
.copy-markdown-options:hover {
  border-color: var(--vp-c-brand-1);
}

.copy-markdown-menu {
  position: absolute;
  z-index: 10;
  top: 100%;
  left: 0;
  min-width: 100%;
  margin-top: 4px;
  padding: 4px;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  box-shadow: var(--vp-shadow-2);
}

.copy-markdown-item {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  font-size: 13px;
  white-space: nowrap;
  color: var(--vp-c-text-1);
  text-decoration: none;
  border-radius: 4px;
}

.copy-markdown-item:hover,
.copy-markdown-item:focus-visible {
  background: var(--vp-c-bg-soft);
}

/* Visually hidden live region: announces the result without a second visible copy of it. */
.copy-markdown-status,
.copy-markdown-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
