<!-- Doc-footer contribution links: "Edit this page" and "Report an issue with
     this page", rendered together below the doc content via the doc-after slot.
     VitePress's native editLink is disabled in config.mts so this component is
     the single source of the edit link. -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, onMounted, ref, watch } from "vue";
import { editLinkFor, ISSUES_REPO_URL, reportIssueUrl } from "./feedback";
import { agentMarkdownHref } from "../agent-markdown";
import { contentRevisedText } from "../page-history";
import { stampVersion } from "../../../src/site-stamp";

const { page, site, theme } = useData();

// The edit target depends only on the page's file path and the upstream file
// docgen recorded in frontmatter, so it is safe to compute during SSR. A
// generated page either links that upstream README or gets no link, so the
// template renders the anchor conditionally.
const editUrl = computed(() =>
  editLinkFor(page.value.filePath, page.value.frontmatter?.upstreamEditUrl),
);

// The agent-oriented Markdown twin, when docgen wrote one for this page: the same path with `.md` in place of
// `.html`. Frontmatter carries the path, so a page without a twin renders no link.
const markdownUrl = computed(() => {
  const twin = page.value.frontmatter?.agentMarkdown;
  return typeof twin === "string" ? agentMarkdownHref(twin, site.value.base) : undefined;
});

// When the page was last revised: the later of the site-wide revision date and the page's own recorded change,
// both compiled in (a constant and frontmatter), so it is the same during SSR and after hydration. Every page has
// one; only a page whose own change won carries a version.
const revised = computed(() => contentRevisedText(page.value.frontmatter ?? {}));

// Client-only: build the pre-filled issue link from the live page
// context. Never runs during SSR.
const issueUrl = ref(`${ISSUES_REPO_URL}/issues/new`);

function refresh() {
  if (typeof window === "undefined") return;
  issueUrl.value = reportIssueUrl({
    pageTitle: page.value.title,
    pageUrl: window.location.href,
    // The <head> build stamp wins; themeConfig covers pages rendered without one (dev server).
    cdkVersion: stampVersion(document) ?? theme.value.cdkVersion,
    userAgent: navigator.userAgent,
  });
}

onMounted(refresh);
watch(() => page.value.relativePath, refresh);
</script>

<template>
  <nav class="page-footer-links" aria-label="Page actions">
    <template v-if="editUrl">
      <a class="footer-link" :href="editUrl" target="_blank" rel="noreferrer">
        Edit this page
      </a>
      <span class="footer-link-separator" aria-hidden="true">·</span>
    </template>
    <a class="footer-link" :href="issueUrl" target="_blank" rel="noreferrer">
      Report an issue with this page
    </a>
    <template v-if="markdownUrl">
      <span class="footer-link-separator" aria-hidden="true">·</span>
      <a class="footer-link" :href="markdownUrl" download type="text/markdown">
        Download as Markdown
      </a>
    </template>
    <span class="footer-revised">{{ revised }}</span>
  </nav>
</template>

<style scoped>
/* VitePress theme variables only, so the block follows light/dark. */
.page-footer-links {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--vp-c-divider);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.footer-link {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.footer-link-separator {
  color: var(--vp-c-text-3);
}

/* Pushed to the row's far end so the links keep their reading order; wraps under them on narrow viewports. Inherits
   the footer's text-2 shade; text-3 stays reserved for the aria-hidden separators, since visible text in it fails
   the contrast gate. */
.footer-revised {
  margin-left: auto;
}
</style>
