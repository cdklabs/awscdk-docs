<!-- Navbar aws-cdk-lib version badge: shows which release the docs were generated
     from and links to the Versions page. -->
<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";
import { VERSIONS_ROUTE } from "../../../src/site-routes";
import { stampVersion } from "../../../src/site-stamp";

const { theme } = useData();

// Read in setup, which on the client runs before the first render, so hydration already shows the stamped value.
// `undefined` means the page carries no stamp (SSR, dev server) and only then does themeConfig apply — reading
// themeConfig unconditionally would let the copy inside the metadata chunk win over a rewritten stamp.
const stamped = typeof document === "undefined" ? undefined : stampVersion(document);

// Absent whenever aws-cdk-lib is not installed: config.mts guards the
// package.json read and leaves cdkVersion undefined. Treat a blank string
// the same way so the badge never renders as a bare "v".
const version = computed<string | undefined>(() => {
  const value = stamped ?? theme.value.cdkVersion;
  return typeof value === "string" && value.length > 0 ? value : undefined;
});
</script>

<template>
  <a
    v-if="version"
    class="version-badge"
    :href="withBase(VERSIONS_ROUTE)"
    :aria-label="`v${version} — aws-cdk-lib, browse all versions`"
    :title="`Generated from aws-cdk-lib ${version}`"
  >
    <span class="version-badge-label">v{{ version }}</span>
  </a>
</template>
