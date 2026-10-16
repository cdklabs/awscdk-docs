<!-- Not-found page body. Offers a human-readable line plus explicit links a
     crawler or agent can follow. The status code is not this component's job:
     the static host serves this as `404.html` with a genuine 404 status.

     Every link goes through `withBase` because `base` is configurable
     (DOCS_BASE), and every target exists in this site: home, the API reference
     index, and the versions page. The `.html` suffix on the versions link is
     required because `cleanUrls` is off in this build. -->
<script setup lang="ts">
import { withBase } from "vitepress";
import { API_ROOT, VERSIONS_ROUTE } from "../../../src/site-routes";

const nextSteps = [
  {
    text: "API reference index",
    link: API_ROOT,
    hint: "every documented module, class and interface",
  },
  {
    text: "Versions",
    link: `${VERSIONS_ROUTE}.html`,
    hint: "which library version these docs describe",
  },
  { text: "Documentation home", link: "/", hint: "start here" },
];
</script>

<template>
  <div class="not-found">
    <p class="not-found-code">404</p>
    <h1 class="not-found-title">This page does not exist</h1>
    <p class="not-found-message">
      No document is published at this address. Nothing here has moved or
      been renamed silently — if you followed a link to a specific symbol,
      search for it from any page or start from the API reference index.
    </p>
    <ul class="not-found-links">
      <li v-for="item in nextSteps" :key="item.link">
        <a class="not-found-link" :href="withBase(item.link)">{{ item.text }}</a>
        <span class="not-found-hint"> — {{ item.hint }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.not-found {
  padding: 64px 24px 96px;
  margin: 0 auto;
  max-width: 640px;
  text-align: left;
}

.not-found-code {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--vp-c-text-3);
}

.not-found-title {
  margin: 8px 0 0;
  font-size: 28px;
  line-height: 36px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  border-top: none;
  padding-top: 0;
}

.not-found-message {
  margin: 16px 0 0;
  font-size: 15px;
  line-height: 24px;
  color: var(--vp-c-text-2);
}

.not-found-links {
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 15px;
  line-height: 24px;
}

.not-found-link {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.25s;
}

.not-found-link:hover {
  color: var(--vp-c-brand-2);
}

.not-found-hint {
  color: var(--vp-c-text-3);
}
</style>
