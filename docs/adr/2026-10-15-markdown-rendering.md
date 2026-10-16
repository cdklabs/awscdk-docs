# Markdown and Signature Rendering

## Status

Accepted

## Context

Generated type pages mix two kinds of content: structured jsii metadata
(signatures, type references) that docgen renders itself, and upstream
README prose pulled verbatim from `aws-cdk-lib` and `@aws-cdk/*-alpha`.
Both must render correctly and safely across a ~21.9k-page tree served
from either a domain root (`base: /`) or a sub-path, while remaining
cheap to generate and easy to unit-test. Docstrings and type names
originate upstream, so every interpolation into generated HTML is an XSS
surface.

## Decision

### Signatures: custom tokenizer, not Shiki

Render type signatures with a custom tokenizer (`src/docgen/signatures.ts`)
that walks jsii metadata (`Method`, `Parameter`, `TypeReference`) directly
and emits `<pre class="signature">` blocks with classified spans
(`sig-name`, `sig-param`, `sig-type`, `type-param`, `sig-default`,
`sig-punct`, `sig-fluent`) and real `<a>` links for documented types. jsii
signatures are already structured data, so no lexing is needed, and plain
Shiki fenced blocks cannot embed cross-reference links.

Formatting rules:

- Signatures with 3+ parameters (or a union of 3+ members) are "complex":
  one parameter per line, type column aligned, union members one per line.
- Optional parameters show their `@default` doc value inline.
- Methods returning their declaring type are annotated `// chainable`.

Blocks carry `v-pre` so Vue leaves brace characters in map types alone.
Token colors live in `docs/.vitepress/theme/signatures.css` as custom
properties on `:root`, shadowed in `.dark`. This applies only to generated
signatures; `@example` code samples keep using Shiki fenced blocks.

### One shared fence tokenizer for README passes

`src/docgen/fences.ts` is the single authority on fence structure.
`tokenizeFences` splits markdown into alternating prose and code spans;
`mapProse` applies a transform to prose while protecting fenced and inline
code. Every fence-aware README pass consumes it so their notions of
"fenced code" cannot diverge.

The tokenizer implements a deliberate CommonMark subset sized to published
jsii READMEs:

- A fence opens on a run of 3+ backticks or tildes after at most three
  spaces of indent, optionally inside blockquote markers. Four or more
  spaces is an indented code block, not a fence.
- It closes only on a run of the SAME marker, at least as long, at the
  same blockquote depth, whose remainder is blank.
- A fence opened inside a blockquote ends when the blockquote does, so an
  unclosed quoted fence cannot swallow following prose and fences.
- Joining span texts with `\n` reconstructs the input exactly.

Policy stays with consumers: the example lifter lifts only closed,
column-0, run-of-three fences; `closeDanglingFence` appends a closer only
for a fence dangling at end of input.

Not implemented, deliberately: full CommonMark (list-indented openers,
lazy blockquote continuation, entity handling). The corpus does not
exercise those shapes; backtick and tilde are treated alike because the
installed corpus contains zero tilde fences.

### Centralized escaping helpers

All escaping in docgen goes through `src/docgen/escape.ts`; never write an
ad-hoc `.replace()` escape chain.

- `escapeHtml(text)` — HTML text context: `&` first (so entities never
  double-encode), then `<`, `>`.
- `escapeVueText(text)` — `escapeHtml` plus `{`/`}`, for raw HTML in
  VitePress markdown where Vue would compile braces as interpolation.
- `escapeAttr(value)` — attribute context: `escapeHtml` plus `"` and `'`,
  so a value can never break out of its quoting regardless of quote style.
  Use for every attribute interpolation, even a "safe" slug — the helper
  is the invariant, not the caller's assumption.
- `removeAll(text, pattern)` — fixpoint removal for multi-character
  patterns (tags, comments): re-runs the global replace until a pass
  removes nothing, so a removal cannot re-form the pattern
  (`<scr<script>ipt>` → `<script>`). The `g`-flagged pattern must not
  match empty; terminates because each effective pass shortens the string.

When an escape inserts an escape introducer (e.g. `\|` in markdown table
cells), escape the introducer (`\`) first. `escapeProse` (prose context,
intentionally entity-preserving) stays in `layout.ts`.

### Canonical hrefs for raw-HTML cross-reference links

VitePress rewrites markdown links (applying the site `base`, resolving to
`.html`) but passes raw HTML through untouched. Docgen emits signature
type links (`<a class="sig-type">`) and inheritance-chain breadcrumbs
(`<a class="chain-item">`) as raw HTML because they carry CSS classes and
live inside `v-pre` HTML layout. Every such anchor must build its href
through `pageHref()` in `src/docgen/links.ts`, which:

- appends `.html` to match the generated page file (directory-style links
  keep their trailing `/`), removing reliance on extensionless-URL
  fallbacks, and
- prefixes the site base from `process.env.DOCS_BASE ?? '/'` — the same
  expression `docs/.vitepress/config.mts` uses for `base`. Docgen and the
  VitePress build run in the same task chain, so they stay consistent.

Markdown links keep emitting the bare site-root-relative page link:
VitePress rewrites those itself, and they double as keys for client
features (`symbols.json`, `type-summaries.json`) whose consumers already
apply `withBase()` and strip `.html`. A hand-run `docs:generate` must use
the same `DOCS_BASE` as its build.

Rejected alternatives: emitting markdown links (cannot carry CSS classes,
and markdown inside `v-pre` is not processed); client-side `withBase`
(breaks crawlers/no-JS, causes SSR hydration mismatches); absolute URLs
with a fixed hostname (hosts differ per deployment).

### Render GitHub math fences as equations

jsii READMEs contain GitHub-flavored math — ` ```math ` fences and
`` $`…`$ `` inline spans — which VitePress treats as an unknown code
language. Render them as equations (parity with github.com):

- Enable VitePress math: `markdown-it-mathjax3` (projen-managed devDep)
  and `markdown.math: true` in `config.mts`. MathJax3 typesets at build
  time into static SVG — SSR-safe, no per-page client runtime, important
  for artifact size. (Client-side KaTeX, rejected, would add a runtime to
  all ~21.9k pages for math that appears on a handful.)
- Bridge GitHub syntax in the docgen README path (`convertMathFences` in
  `src/docgen/index.ts`, inside `prepareReadme`): a `math` info-string
  fence becomes a `$$…$$` display block; a `` $`expr`$ `` span becomes
  `$expr$`. It runs after `escapeProse` so the fence interior is protected
  from brace-escaping, then the resulting TeX braces (`A_{vCpus}`) stay
  literal for MathJax.

Confining the bridge to generated READMEs (not a global markdown-it fence
rule) leaves authored `docs/**` pages untouched and makes the unknown-
language warning disappear as a side effect — the `math` fence no longer
exists by the time the highlighter runs. The `$$…$$` block sits inside the
README's `<div v-pre>`; this is safe because markdown-it (and mathjax3)
process it a layer before Vue, which then sees inert static SVG.

### Link type names inside example code

CDK type names in rendered example blocks link to their pages. The shared
`markdown.highlight` hook (`docs/.vitepress/type-links.ts`) reads a
whitespace-free `type-links=Name:href,…` fence attribute and wraps
matching identifiers in anchors after highlighting. Docgen decides which
identifiers to offer by intersecting the assembly's symbol set with
identifiers present in live code:

1. A display-name → FQN index (trailing PascalCase segment of each FQN in
   `assembly.types`), memoized per assembly so scanning one example is
   `O(identifiers)` not `O(types)`.
2. Case-sensitive matching, so a local `bucket` stays plain while the type
   `Bucket` links — no scope analysis needed.
3. Ambiguous display names (two FQNs sharing a trailing segment) are
   dropped, never guessed: a missing link is recoverable, a wrong one
   teaches something false.
4. String literals and comments are blanked in one ordered pass before the
   scan (ordered because constructs nest: `'https://x'` must not have its
   tail read as a `//` comment; `#`-to-EOL counts, since per-language
   variants share this scan and Python is one).
5. `${…}` interpolations inside template literals are preserved — they are
   source, not text.
6. Only names `linkFor` resolves to a site-relative href are emitted.

Accepted tradeoffs: a type name appearing in both live code and a
literal/comment in the same example is linked in both (the post-highlight
hook sees text runs, not token classes); `#private` fields and ambiguous
names are never linked. Both fail toward a missing link, never a wrong
one. No parser (jsii-rosetta or a per-example TS AST) is used — too costly
per page, and the result would still be per-language.

### Strip the inline README Table of Contents

`stripInlineToc()` in `src/docgen/index.ts` removes an authored
`## Table of Contents` section at generate time, before embedding, because
with the right-hand outline restored the inline list is pure redundancy
(same targets, worse placement). Done at generate time, not CSS, because
the list has no distinguishing markup to target; a text transform is
testable and visible in the emitted markdown. Fence-aware line scan:

1. A line matching `/^#{1,6}\s+table of contents\s*$/i` outside a code
   fence starts skipping (the heading itself is dropped).
2. While skipping, blank lines and list items (`-`/`*`/`+`/`1.`/`1)`) are
   dropped.
3. The first line that is neither ends the skip and is kept, so the strip
   stops at the next heading or prose and never eats content past the list.
4. A matching heading inside a fence is never touched.

The match is the literal phrase `table of contents` only (any level, any
case, trailing whitespace). Variants (`## Contents`, trailing words) keep
their list — a looser match risks deleting a genuine section. A ToC whose
section contains a non-list line half-strips (heading gone, remainder
kept); no current README has that shape and only list/blank lines are ever
dropped, so the failure mode is a leftover list, never lost prose.

## Consequences

- Type names in signatures and example blocks are real links, impossible
  with plain Shiki fenced blocks.
- Raw-HTML cross-reference links resolve on both domain-root and sub-path
  deployments without relying on `ignoreDeadLinks` or Pages URL fallbacks.
  Generated markdown becomes base-dependent when `DOCS_BASE` is set; safe
  because every docs task regenerates before building. Any future raw-HTML
  anchor must build its href via `pageHref()`.
- All escaping shares one reviewed implementation; new escape contexts add
  a named helper in `escape.ts` rather than a fresh `.replace()` chain.
- The six fence-aware passes cannot disagree about fence boundaries;
  extending the tokenizer toward full CommonMark is one function when the
  corpus demands it.
- Math typesets like github.com at build time; one build-time-only devDep
  (`markdown-it-mathjax3`). Authored docs pages may use `$…$`/`$$…$$`
  directly now that `markdown.math` is on.
- No new runtime dependencies, no Shiki grammar or post-processing
  pipeline, and canonical identity (routes, slugs, anchors) is unchanged
  by any of these transforms. Signature colors are maintained in
  `signatures.css` for both light and dark modes (see
  [brand theme and icons](./2026-10-15-brand-theme-and-icons.md)).
