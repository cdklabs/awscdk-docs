<!-- Site-wide footer: community links plus the standard AWS legal line. Rendered
     through the layout-bottom slot instead of VitePress's native
     themeConfig.footer, which the default theme hides on every sidebar page
     (every generated /api/** page). This component renders on all layouts. -->
<script setup lang="ts">
import { useSidebar } from "vitepress/theme-without-fonts";

// On sidebar pages the default theme's sidebar is fixed-positioned, so
// the footer needs matching left padding to stay out from under it.
const { hasSidebar } = useSidebar();

// Computed at render time (build time during SSG), so the year never
// goes stale in the source.
const year = new Date().getFullYear();

// The GitHub link targets the framework source, not this docs repository;
// docs defects go through the per-page links (theme/feedback.ts).
const communityLinks = [
  { text: "GitHub", link: "https://github.com/aws/aws-cdk" },
  { text: "Slack", link: "https://cdk.dev/" },
  {
    text: "Stack Overflow",
    link: "https://stackoverflow.com/questions/tagged/aws-cdk",
  },
  {
    text: "AWS re:Post",
    link: "https://repost.aws/topics/TA9fmRfPodSgylDF8ojd9A_w/aws-cloud-development-kit-cdk",
  },
];
</script>

<template>
  <footer class="site-footer" :class="{ 'has-sidebar': hasSidebar }">
    <div class="site-footer-container">
      <nav class="site-footer-community" aria-label="Community">
        <a
          v-for="item in communityLinks"
          :key="item.link"
          class="site-footer-link"
          :href="item.link"
          target="_blank"
          rel="noreferrer"
        >
          {{ item.text }}
        </a>
      </nav>
      <p class="site-footer-legal">
        <a
          class="site-footer-link"
          href="https://github.com/cdklabs/awscdk-docs/blob/main/THIRD_PARTY_LICENSES"
          target="_blank"
          rel="noreferrer"
        >Third-party licenses</a>
        <span class="site-footer-separator" aria-hidden="true">|</span>
        <a
          class="site-footer-link"
          href="https://aws.amazon.com/privacy"
          target="_blank"
          rel="noreferrer"
        >Privacy</a>
        <span class="site-footer-separator" aria-hidden="true">|</span>
        <a
          class="site-footer-link"
          href="https://aws.amazon.com/terms/"
          target="_blank"
          rel="noreferrer"
        >Site terms</a>
        <span class="site-footer-separator" aria-hidden="true">|</span>
        <!-- awsdocs-boot.js binds this id to the Shortbread preferences modal. -->
        <a
          id="awsdocs-cookie-preferences-link"
          class="site-footer-link site-footer-cookie-preferences"
          href="#"
          @click.prevent
        >Cookie preferences</a>
        <span class="site-footer-separator" aria-hidden="true">|</span>
        <span class="site-footer-copyright"
        >© {{ year }}, Amazon Web Services, Inc. or its affiliates. All
          rights reserved.</span>
      </p>
    </div>
  </footer>
</template>

<style scoped>
/* VitePress theme variables only, so the block follows light/dark. */
.site-footer {
  border-top: 1px solid var(--vp-c-gutter);
  padding: 24px 24px;
  background-color: var(--vp-c-bg);
}

.site-footer-container {
  margin: 0 auto;
  max-width: var(--vp-layout-max-width);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-2);
  text-align: center;
}

.site-footer-community {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
}

.site-footer-legal {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.site-footer-link {
  color: var(--vp-c-text-2);
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.25s;
}

.site-footer-link:hover {
  color: var(--vp-c-brand-1);
}

.site-footer-separator {
  color: var(--vp-c-text-3);
}

/* The sidebar is fixed-positioned on desktop; mirror VPContent's
   has-sidebar offsets so the footer is not covered by it. */
@media (min-width: 960px) {
  .site-footer.has-sidebar {
    padding-left: calc(var(--vp-sidebar-width) + 24px);
  }
}

@media (min-width: 1440px) {
  .site-footer.has-sidebar {
    padding-left: calc(
      (100vw - var(--vp-layout-max-width)) / 2 + var(--vp-sidebar-width) + 24px
    );
  }
}
</style>
