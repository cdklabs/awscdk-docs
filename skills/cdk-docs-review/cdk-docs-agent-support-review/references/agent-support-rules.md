# Agent support rules: the lookup

Rows are grouped by family: twins and index, signals, search, content, gate. See the
`cdk-docs-review-principles` skill for the shared lookup convention. The contract these rows enforce is
[`docs/adr/2026-10-15-seo-and-agent-discoverability.md`](https://github.com/cdklabs/awscdk-docs/blob/main/docs/adr/2026-10-15-seo-and-agent-discoverability.md)
(the SEO ADR below).

## Twins and index

**[AGENT-TWIN-MISSING] (BLOCKING)**: A new generated page type, or a new hand-written page an agent should
read, ships with no Markdown twin, or a page advertises a twin that is not produced. SEO ADR: "Every
generated page ships a plain-Markdown twin", and the `agentMarkdown` frontmatter is "the only existence
signal the site consults, so no page can advertise a twin that was not produced." Check the frontmatter,
the `<link rel="alternate" type="text/markdown">` and the file in `dist-agent-markdown/`.

**[AGENT-TWIN-CONTENT-LOSS] (BLOCKING)**: New page content the twin transform drops: a new section, table
or callout wrapped in markup the transform treats as structural or Pagefind plumbing. The twin "keeps
TypeScript signatures, examples, member tables, warnings and cross-links"; an agent reading the twin
never sees what it drops.

- **Detection method (doc-absent detail):** for one affected page, diff the visible text of the canonical
  HTML (canonical language only) against the twin. Anything present in one and absent in the other that is
  not on the deliberate-drop list is the finding.

**[AGENT-INDEX-WRONG] (BLOCKING)**: `llms.txt` lists a link that does not resolve, an overview that is not
emitted, or loses its documented-version line or sort order (module id, code-point order, package root
first).

**[AGENT-TWIN-SECOND-RENDERER] (RECOMMENDED)**: A change that renders twin content independently of the
finished canonical page. SEO ADR: the twin "is a transform of the finished canonical page ... not a second
renderer, so there is one source of truth." Two renderers drift.

## Signals

**[AGENT-SIG-CONTRADICT] (BLOCKING)**: Two machine-readable signals for one page disagree: canonical,
JSON-LD `url` and sitemap `<loc>` not equal, or one carrying a `?lang=` query. SEO ADR: "a machine-readable
statement that contradicts another is worse than none", which is why all three resolve through `pageUrl`
in `docs/.vitepress/page-url.ts`. A new URL computed anywhere else is the finding.

**[AGENT-SIG-WRONG-DATE] (BLOCKING)**: JSON-LD `dateModified` (or the footer stamp) derived from build or
deploy time instead of `contentRevised()`. SEO ADR: "not a build timestamp, so a rebuild with no content
change does not re-date any page." A crawler then treats every page as changed on every deploy.

**[AGENT-SIG-JSONLD-ESCAPE] (BLOCKING)**: JSON-LD serialized without escaping `<`, `>`, `&`, U+2028 and
U+2029, so docstring text can close the `<script>` element.

**[AGENT-SIG-RELATIVE-URL] (BLOCKING)**: An absolute URL in a machine contract (`versions.json`, sitemap,
canonical, JSON-LD, `llms.txt`) emitted as relative, or built from a literal instead of `DOCS_SITE_URL`.
An agent fetching the file out of page context cannot resolve it, and a preview deploy points at
production.

**[AGENT-SIG-SCHEMA-TYPE] (RECOMMENDED)**: A JSON-LD node with a schema.org type or property that does not
fit the page (a `TechArticle` on the home page, a missing `@id` link to the `WebSite` node). Verify against
schema.org before citing.

## Search

**[AGENT-SEARCH-NAMES-LOST] (BLOCKING)**: `data-pagefind-ignore` moved to wrap a member or type name,
heading or summary, so the name stops being searchable. Ignore only the noise (parameter and return
detail, source paths, non-canonical language variants), never the identifier a reader searches for.

- **Detection method (doc-absent detail):** on the built fixture, run the Pagefind search for one member
  name the change touches at base and head.

**[AGENT-SEARCH-VARIANT-INDEXED] (RECOMMENDED)**: A non-canonical language variant left indexed, so search
returns the same member four times. `src/docgen/variants.ts` marks non-canonical variants
`data-pagefind-ignore`.

## Content

**[AGENT-CONTENT-LANGUAGE-SPECIFIC] (RECOMMENDED)**: New hand-authored or generated prose that is
TypeScript-only on a page that serves four language variants from one document: "pass `props.bucketName`"
on the Python view, a TypeScript snippet with no translated variant. An agent working in Python quotes
it as if it applied. Write language-neutral prose or emit per-language variants.

**[AGENT-CONTENT-UNVERIFIABLE-COMMAND] (RECOMMENDED)**: A command or install line an agent will run that
no test pins. `test/skills.test.ts` pins the skill install command "as one exact string" so upstream drift
fails the build; a new copy-paste command owes the same.

## Gate

**[AGENT-GATE-WEAKENED] (BLOCKING)**: `agent-readiness.config.json` `minPassed` lowered, or
`scripts/agent-readiness-run.cjs` changed to read the CLI's exit status or to skip the 200 check. SEO ADR:
the CLI "exits 0 regardless of outcome", so the verdict must come from the parsed report.

- **Conditional:** not a finding when the PR updates the SEO ADR to record a maintainer decision.
