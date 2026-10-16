// Pure helper for the agent-oriented Markdown twin link. No VitePress imports, so
// both the Node-side config (`<link rel="alternate">`) and the theme component
// (the footer download link) share it and Jest can test it directly.

/**
 * Site-absolute href of a page's Markdown twin. `twin` is the site-root-relative path docgen
 * recorded in frontmatter (`/v2/docs/<page>.md`); `base` is the site base with its slashes
 * (`/` or `/cdk/api/`), so the result mirrors the page's own hosted URL with `.md` for `.html`.
 */
export function agentMarkdownHref(twin: string, base: string): string {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${twin.replace(/^\/+/, "")}`;
}
