<script setup lang="ts">
// LanguageTabs -- headerless language-variant group.
//
// Usage in (generated) markdown -- one child div per embedded language:
//
//   <LanguageTabs :langs="['ts','python']">
//   <div class="lang-variant" data-lang="ts">
//
//   ...TypeScript variant (markdown)...
//
//   </div>
//   <div class="lang-variant" data-lang="python">
//
//   ...Python variant (markdown)...
//
//   </div>
//   </LanguageTabs>
//
// Plain `div` children (not named slots) keep markdown-it on the type-6
// HTML-block path, the same pattern the generated props tables use. Every
// instance reads the one shared reactive language, so the navbar language slider
// switches every group on the page (and, via localStorage + ?lang=, on every
// subsequent page). All languages' content is in the HTML; non-active variants
// are hidden with CSS.
//
// This component renders no controls of its own: selection is driven solely by
// the navbar slider. It is a pure show/hide wrapper.
import { computed, onMounted } from 'vue';
import {
  activeLanguage,
  initLanguageState,
  LANGUAGE_ORDER,
  type TabLanguage,
} from './language-state';

const props = defineProps<{
  /** Which languages this block embeds, e.g. ['ts','python']. */
  langs: TabLanguage[];
}>();

const ordered = computed(() =>
  LANGUAGE_ORDER.filter((l) => props.langs.includes(l)),
);

// If the shared selection is a language this block doesn't carry,
// show the first embedded one without clobbering the global choice.
const shown = computed<TabLanguage>(() =>
  ordered.value.includes(activeLanguage.value)
    ? activeLanguage.value
    : ordered.value[0],
);

onMounted(initLanguageState);
</script>

<template>
  <div class="lang-tabs" :data-active="shown">
    <slot />
  </div>
</template>

<style scoped>
/* No chrome: the group is a transparent container whose only job is to show the
 * active language's variant. Spacing comes from the variant content itself. */

/* Hide every variant that is not the active language. Static rules per
 * supported language keep this scoped-CSS friendly. */
.lang-tabs[data-active='ts'] :deep(.lang-variant:not([data-lang='ts'])),
.lang-tabs[data-active='python'] :deep(.lang-variant:not([data-lang='python'])),
.lang-tabs[data-active='java'] :deep(.lang-variant:not([data-lang='java'])),
.lang-tabs[data-active='dotnet'] :deep(.lang-variant:not([data-lang='dotnet'])),
.lang-tabs[data-active='go'] :deep(.lang-variant:not([data-lang='go'])) {
  display: none;
}
</style>
