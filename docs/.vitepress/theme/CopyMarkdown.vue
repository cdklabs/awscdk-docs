<!-- "Copy Markdown" split button rendered from the doc-before slot beside the favorite star. The main button copies
     the page's Markdown twin; the options button opens a one-item menu that links the file in a new tab. A page
     without a twin (no `agentMarkdown` frontmatter) renders nothing. -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { agentMarkdownHref } from "../agent-markdown";
import { copyMarkdownFrom, type CopyResult } from "../copy-markdown";

const { page, site } = useData();

const markdownUrl = computed(() => {
  const twin = page.value.frontmatter?.agentMarkdown;
  return typeof twin === "string" ? agentMarkdownHref(twin, site.value.base) : undefined;
});

const RESULT_MS = 2000;
const result = ref<CopyResult | undefined>(undefined);
const menuOpen = ref(false);
const root = ref<HTMLElement | null>(null);
const optionsButton = ref<HTMLButtonElement | null>(null);
const viewLink = ref<HTMLAnchorElement | null>(null);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

const label = computed(() =>
  result.value === "copied" ? "Copied" : result.value === "failed" ? "Copy failed" : "Copy Markdown"
);

async function copy(): Promise<void> {
  if (!markdownUrl.value) return;
  result.value = await copyMarkdownFrom(markdownUrl.value, {
    fetch: (url) => fetch(url),
    clipboard: navigator.clipboard,
  });
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => (result.value = undefined), RESULT_MS);
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
  } else if (event.key === "Tab") {
    closeMenu(false);
  }
}

function onDocumentPointerDown(event: Event): void {
  if (menuOpen.value && root.value && !root.value.contains(event.target as Node)) {
    closeMenu(false);
  }
}

onMounted(() => document.addEventListener("pointerdown", onDocumentPointerDown));
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  clearTimeout(resetTimer);
});
</script>

<template>
  <div v-if="markdownUrl" ref="root" class="copy-markdown" data-pagefind-ignore>
    <div class="copy-markdown-split">
      <button type="button" class="copy-markdown-main" @click="copy">{{ label }}</button>
      <button
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
      @keydown="onMenuKeydown"
    >
      <a
        ref="viewLink"
        class="copy-markdown-item"
        role="menuitem"
        :href="markdownUrl"
        target="_blank"
        rel="noopener noreferrer"
        @click="closeMenu(false)"
      >
        View as Markdown
      </a>
    </div>
    <span class="copy-markdown-status" role="status" aria-live="polite">{{ result ? label : "" }}</span>
  </div>
</template>

<style scoped>
/* VitePress theme variables only, so the control follows light/dark. */
.copy-markdown {
  position: relative;
  display: inline-block;
  margin-bottom: 8px;
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
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
}

.copy-markdown-main {
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
  display: block;
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
.copy-markdown-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
