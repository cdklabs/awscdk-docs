# SEO and Agent Discoverability

## Status

Accepted

## Context

The reference is a large generated corpus (~23,600 pages) served under a
version-scoped sub-path of `docs.aws.amazon.com` (`/cdk/api/v2/…`), built as
parallel VitePress shards and merged by `scripts/merge-shards.cjs`. Making it
discoverable to both search crawlers and reading agents requires machine
signals the pages did not originally emit — a canonical URL, a sitemap,
structured data, plain-Markdown twins, an `llms.txt` index — plus a route to
the official AWS CDK agent skill and a CI gate that guards the whole set.

Three facts constrain every signal below. The site serves four language
variants of each API page from one document, selected by a `?lang=` query the
client reads (see [multi-language](./2026-10-15-multi-language.md)); a
machine-readable statement that contradicts another is worse than none, so all
absolute-URL signals resolve routes the same way and carry no query; and
anything placed in `docs/public/` is copied into every shard, so per-page
agent artifacts cannot live there.

Absolute URLs use `DOCS_SITE_URL` (default
`https://docs.aws.amazon.com/cdk/api/`, overridable for a preview host; see
[publishing-and-hosting](./2026-10-15-publishing-and-hosting.md)), normalized
to a trailing slash, which already carries the deploy sub-path.

## Decision

### Canonical URLs

Each page declares `<link rel="canonical">` equal to its own absolute URL: the
site prefix, the version segment, the page path, and `.html` on every route
but the home page, which is the bare site URL. The href carries no `?lang=`
query — the language variants are one document, which is the case a canonical
exists to state. The URL comes from a single `pageUrl` helper
(`docs/.vitepress/page-url.ts`), which the canonical, the JSON-LD `url`, and
the sitemap `<loc>` all resolve, so a page's canonical and its sitemap entry
are equal by construction. The version segment is part of the canonical, so
`v2` and any future major are distinct canonical pages rather than variants.

### Sitemap

VitePress writes the sitemap: `config.mts` sets
`sitemap: { hostname: docsSiteUrl() }`, so every build emits a `sitemap.xml`
listing the pages it rendered, with VitePress's own `srcExclude`/`rewrites`/
`cleanUrls` rules applied. `scripts/sitemap-merge.cjs` unions the shards'
`<url>` entries keyed by `<loc>`, sorts them, and copies them verbatim;
`merge-shards.cjs` merges `sitemap.xml` actively (like `hashmap.json`) rather
than overlaying it. The protocol limit is enforced at the merge: up to 50,000
URLs is one `sitemap.xml`; past that the union is split into `sitemap-1.xml`,
`sitemap-2.xml`, … behind a `sitemap.xml` sitemap index, whose `<loc>`s are
resolved against the site URL recovered from the entries (the root page's
`<loc>` is the bare hostname). Only the canonical tree is listed — no `?lang=`
variants, no Markdown twins. No `robots.txt` with a `Sitemap:` line: the
platform owns `/robots.txt`, and a file at `/cdk/api/robots.txt` is not
consulted.

### Structured data (JSON-LD)

`docs/.vitepress/structured-data.ts` emits one `application/ld+json` node per
page: the home page is a `WebSite`, every other page a `TechArticle`
referencing the site node by `@id`. `dateModified` is `contentRevised()` — the
same version-history value the footer's "Content revised" stamp shows (see
[versions-and-history](./2026-10-15-versions-and-history.md)), not a build
timestamp, so a rebuild with no content change does not re-date any page.
Resolution is day-level. JSON for the script element escapes `<`, `>`, `&`,
U+2028 and U+2029 as `\uXXXX` so the text cannot close the element. The module
takes no VitePress import, so tests assert against the produced object.

### Agent Markdown twins

Every generated page ships a plain-Markdown twin at its own URL with `.md` for
`.html`. The twin is a transform of the finished canonical page
(`src/docgen/agent-markdown.ts`), not a second renderer, so there is one source
of truth for what a page says. It parses the page with `htmlparser2` (a regex
cannot pair the nested per-language signature markup), after swapping anything
that merely looks like markup — fenced/indented code, autolinks,
`<placeholder>` tokens — for placeholders restored byte for byte. It drops
frontmatter, the breadcrumb `<nav>`, every non-canonical language variant, Vue
components (`<Badge>` and any PascalCase tag), Pagefind markers and structural
`<div>`s; member lists become bullets, the type hierarchy becomes
`Extends:`/`Implements:` lines, `:::` containers become titled blockquotes.
Headings, prose, fenced code, tables and links pass through.

docgen writes the twins to a sibling tree outside `docs/`,
`dist-agent-markdown/v2/docs/<page>.md`, laid out site-root-relative, via the
optional `GenerateOptions.agentOutDir`. The canonical page records its twin in
frontmatter as `agentMarkdown: "/v2/docs/<page>.md"` — the only existence
signal the site consults, so no page can advertise a twin that was not
produced. The footer's "Download as Markdown" link and a
`<link rel="alternate" type="text/markdown">` in `<head>` both render from it.
`merge-shards.cjs` overlays the tree once, after the shards and before the page
count, behind an explicit `--agent-markdown <dir>` flag; a missing tree fails
the merge. The hand-written homepage is the one exception: it declares
`agentMarkdown: "/index.md"`, and `scripts/agent-markdown-overlay.cjs`
transforms its finished Markdown into the root twin during the same overlay
step, keeping the advertised file and its producer together. The ~27 MB
compressed corpus is overlaid once, with no per-shard cost.

### llms.txt index

docgen writes `llms.txt` at the root of the agent-markdown tree
(`src/docgen/llms-txt.ts`), and the overlay carries it to the site root beside
`sitemap.xml`; the merge step is untouched because every build runs the same
docgen and writes the identical file. It lists module overviews, not pages:
one line per emitted `…-readme` overview (package root and every submodule;
see [docgen-sources-and-modules](./2026-10-15-docgen-sources-and-modules.md)),
titled by the overview's H1, annotated with the module id, linked at the
overview's Markdown twin, sorted by module id in code-point order so the
package root heads its submodules. The summary names the documented version and
points at `sitemap.xml` for the full page set — no `llms-full.txt`, which would
be tens of megabytes. Every page advertises the index unconditionally as
`<link rel="alternate" type="text/plain">` beside the twin link. The site title
lives in `src/site-routes.ts` as `SITE_TITLE` so docgen and the theme name it
from one constant. Whether the platform's root `/llms.txt` references this one
is a cross-team concern this repository cannot settle.

### Link to the AWS CDK agent skill (do not vendor)

A reader reaches the official skill through one in-site page, `docs/skills.md`,
which carries the documented `npx skills add` install command verbatim in a
`bash` fence (so the theme's copy button applies), one paragraph on what the
skill covers, and outbound links to the skill directory and upstream README.
The command string is pinned as an exact literal in a test, so upstream drift
fails the build rather than shipping a line that does not work. The site does
not fetch, vendor or repackage the Apache-2.0 skill files: `npx skills add`
fetches against upstream on the reader's machine, there is exactly one
published copy, and vendoring would incur silent drift plus NOTICE/attribution
obligations. The page is reachable from a `Skills` navbar entry (link
`/skills`) and a home `Agent Skills` feature card. The navbar holds **exactly
three** text entries — API Reference, Skills, Versions — and that count is
load-bearing: a fourth text entry overflows the shared control row at
1000–1280px (see
[navbar-footer-and-layout](./2026-10-15-navbar-footer-and-layout.md)), so the
entry count is pinned and `Home` is forbidden from returning (the site title
already links home).

### Agent-readiness CI gate

A `docs:agent-readiness` task (declared in `.projenrc.ts`) builds the fixture
site, serves it on an OS-assigned loopback port, and scans it with
`botvisibility` (a devDependency). `botvisibility` is the only candidate that
scans a loopback target — `isreadyai` and `foglift-scan` both reject private
addresses before running any check — which decided the tool for this
not-yet-public site. The CLI exits 0 regardless of outcome, so
`scripts/agent-readiness-run.cjs` derives the verdict from the parsed `--json`
report, after confirming the URL returns 200 (a 404 page would score as a real
report). It asserts two floors from `agent-readiness.config.json`:
`minLevel: 0` (coarse, currently inert — level 0 is the floor of the scale) and
`minPassed: 6`, the threshold that actually binds, so losing a check that
passes today turns the gate red. The scan targets the entry point only; the
checks are site-wide properties. The report is uploaded as an artifact on every
run, including failures.

## Consequences

- Every build emits `sitemap.xml`, per-page canonical and JSON-LD, per-page
  Markdown twins advertised from `<head>` and footer, and a root `llms.txt`;
  the merged site unions the sitemaps and overlays the twins and index once.
- Changing the published prefix (`DOCS_SITE_URL`) moves the canonical, sitemap,
  and JSON-LD `url` together, since all three resolve routes through `pageUrl`;
  a preview deploy gets a sitemap and canonicals rooted at its host.
- Bumping `CONTENT_REVISED_DATE` re-dates every page without a later release of
  its own, in both the JSON-LD and the footer.
- The twin keeps TypeScript signatures, examples, member tables, warnings and
  cross-links and drops the other languages, badges, breadcrumb and search
  plumbing; widening what it keeps is a change to one transform. The merge step
  has one non-shard input, and a missing twin tree or module index fails the
  build.
- The install command is deliberately duplicated between upstream and this
  repo; the pin turns silent drift into a failing test. Readers who want the
  skill's contents still leave the site to read the single published copy.
- The agent-readiness gate reports a regression as a count (the named checks
  live in the uploaded report, not the failure message, so renames upstream do
  not break it). If the site becomes public, `isreadyai` and `foglift-scan`
  re-enter scope, since each refuses only private addresses.
- If a future VitePress applies `base` to sitemap URLs itself, the hostname
  would double the prefix; the e2e assertion that fixture pages appear at
  exactly their public URL is what catches it.

### Rejected alternatives

- **Vendoring or build-time fetching the agent skill** — third-party content
  on an uncontrolled cadence; a mirror drifts the day it lands.
- **A runtime manifest of which pages have twins** — 23k entries for a yes/no
  the build already records in frontmatter.
- **`llms-full.txt` concatenating every twin** — tens of megabytes.
- **Generating the sitemap in docgen or crawling the merged dist** — docgen
  does not know the authored pages or exclusion rules; a post-merge crawl is a
  second walk over ~23,600 files and would list any stray HTML (the 404 page).
