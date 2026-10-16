# AWS CDK Versions

Current releases of the AWS CDK packages with links to release notes, docs and
the release date.

<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { data } from './versions.data'
import { VERSIONS_JSON_PATH } from '../src/site-routes'
import { stampGeneratedAt } from '../src/site-stamp'

// Site-relative docs paths (starting with '/') honor the VitePress
// `base` (same base-path discipline as the other site-relative paths); external URLs pass
// through and open in a new tab.
const isExternal = (url: string) => !url.startsWith('/')
const docsHref = (url: string) => (isExternal(url) ? url : withBase(url))

const jsonHref = withBase(`/${VERSIONS_JSON_PATH}`)

// The <head> build stamp wins when present: a downstream republisher rewrites it, and this date has to follow.
// Unstamped pages (SSR, dev server) show the snapshot's own refresh time. A stamped blank is a rewrite that
// dropped the date, so the sentence goes rather than rendering a dangling "Last updated .".
const stamped = typeof document === 'undefined' ? undefined : stampGeneratedAt(document)
const lastUpdated = computed(() => {
  const value = stamped ?? data.generatedAt
  return value.length > 0 ? value.slice(0, 10) : undefined
})
</script>

<table class="versions-table">
  <thead>
    <tr>
      <th scope="col">Package</th>
      <th scope="col">Current version</th>
      <th scope="col">Released</th>
    </tr>
  </thead>
  <tbody>
    <tr v-for="pkg of data.packages" :key="pkg.name">
      <th scope="row">
        {{ pkg.label }}<br />
        <code class="versions-pkg-name">{{ pkg.name }}</code>
      </th>
      <td>
        <a :href="pkg.current.releaseUrl" target="_blank" rel="noopener">
          v{{ pkg.current.version }}
        </a>
        <span class="versions-docs-sep">·</span>
        <a
          :href="docsHref(pkg.docsUrl)"
          :target="isExternal(pkg.docsUrl) ? '_blank' : undefined"
          :rel="isExternal(pkg.docsUrl) ? 'noopener' : undefined"
        >docs</a>
      </td>
      <td>{{ pkg.current.releaseDate }}</td>
    </tr>
  </tbody>
</table>

<p class="versions-generated-at">
  <template v-if="lastUpdated">Last updated {{ lastUpdated }}. </template><a :href="jsonHref">Download version information as JSON</a>.<br />
  AWS CDK v1 is end-of-support since {{ data.v1EndOfSupport }}; its final release shipped shortly after.
</p>

<style scoped>
/* Theme variables only, so both color schemes keep AA contrast
   (custom.css stays variable-overrides-only). */
.versions-table th[scope='row'] {
  text-align: left;
  font-weight: 600;
}

.versions-pkg-name {
  font-size: 0.8em;
  color: var(--vp-c-text-2);
}

.versions-docs-sep {
  color: var(--vp-c-text-2);
  margin: 0 0.15em;
}

.versions-generated-at {
  font-size: 0.85em;
  color: var(--vp-c-text-2);
}
</style>
