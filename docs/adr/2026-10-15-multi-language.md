# Multi-Language API Documentation

## Status

Accepted

## Context

AWS CDK supports five target languages through jsii: TypeScript, Python,
Java, C#/.NET, and Go. A reader writing CDK in any of these needs code
examples, import/install statements, and type signatures in their own
language. The jsii assembly (`.jsii`) carries all the metadata needed —
target package names, namespace maps, naming conventions — and the
rosetta tablet (`.jsii.tabl.json.gz`) shipped beside it carries
already-translated example snippets, produced by the same translator
that renders the official AWS CDK per-language docs.

The architectural question is how "language" maps to pages and URLs.
Generating one full page tree per language ("path-per-language") makes
page *count* scale with the language count, and page count is the
binding constraint of this site: build memory is superlinear in page
count, the site artifact has a size budget, CI shard count
tracks pages, and Pagefind would index N near-identical copies of every
page. See [site generator and build](./2026-10-15-site-generator-and-build.md).

## Decision

### One canonical page per symbol (Model B)

The generator emits exactly ONE page tree. Each page embeds every
enabled language's *variant* regions (signatures, member names, type
references, imports/install, code examples); the reader's choice toggles
them client-side. Adding a language costs page *size*, not page *count*
— no new pages, sidebars, or assets, and the per-page cost is bounded
(see Consequences). Path-per-language trees were measured and rejected:
their cost multiplies CI and artifact size per language while carrying
the identical identifier variance with no offsetting benefit.

### Canonical identity, translated display

Symbol *identity* is language-stable and *display* text is language-
variant:

- URL slugs and member heading anchors always use the jsii/TypeScript
  name (`### addDependency` → `#adddependency` in every language). A deep
  link resolves regardless of, and survives, a language switch. Language
  never appears in a URL path.
- Everything the reader sees — on-page member/property names, type
  references, signatures, import/install blocks, code examples, and
  nav/sidebar labels — flips to the active language.

Display language is held in one shared reactive client state
(`docs/.vitepress/theme/language-state.ts`), persisted to `localStorage`
under key `cdk-docs-language` and reflected into a `?lang=` query param
via `history.replaceState` for shareable URLs. The path never encodes a
language.

### Enabled language set

`docgen.config.json` `languages` is `["ts", "python", "dotnet", "java",
"go"]` — the full jsii target set. All generator consumers key off this
config at build time, so enabling a language is a config flip plus any
language-specific snippet polish. Canonical display order is defined by
`LANGUAGES` in `src/docgen/languages.ts` (TypeScript, Python, Java,
C# / .NET, Golang); `DEFAULT_LANGUAGE`/`CANONICAL_URL_PREFIX` is `ts`.

### Algorithmic transliteration from jsii metadata

`src/docgen/languages.ts` transliterates identifiers from the jsii
`targets` metadata — no jsii-rosetta dependency for identifiers:

- Member casing per language (Python `snake_case`; .NET/Go exported
  `PascalCase`; Java/TS `camelCase`). .NET and jsii keep *parameters*
  `camelCase` while PascalCasing methods and properties
  (`translateParam`).
- Type names are language-stable (jsii preserves class/interface/enum
  names across targets), so type leaves never vary.
- Module/package labels genuinely differ (`aws-cdk-lib/aws_sqs` vs
  `aws_cdk.aws_sqs` vs `Amazon.CDK.AWS.SQS`) and resolve from assembly +
  submodule jsii targets via `translateModuleName`.
- Install coordinates derive from assembly metadata, never name-munging,
  and return `undefined` when the assembly declares no target for that
  language: `mavenCoordinates` (Java groupId/artifactId from
  `targets.java.maven`), `dotnetCoordinates` (NuGet `packageId` from
  `targets.dotnet.packageId`, per-assembly), `goCoordinates` (module
  path `<targets.go.moduleName>/<packageName>/v<major>`, with the
  `/v<major>` semantic-import-versioning suffix for majors ≥ 2, package
  name defaulting to the sanitized assembly name).

### Variant embedding

`src/docgen/variants.ts` routes every variant region through helpers:
`languageVariantBlocks` (one `<div class="lang-variant" data-lang="…">`
per language inside a `<LanguageTabs>` group, for signature/initializer
blocks) and `languageVariantSpans` + `wrapLanguageTabs` (inline variants
for shared single-copy structures such as props-table name/type cells).
Language-*neutral* content — summaries, remarks, property descriptions,
`@default` values, expanded details — is emitted once. With a single
enabled language the helpers return that language's rendering with no
wrapper markup, so single-language builds are byte-identical.

### One type-reference walker, structured fragments

Per-language type references must be *linked*, not just named.
`translateTypeRefParts(ref, lang)` returns a flat list of `TypeRefPart`,
each carrying `text` plus, when the fragment names a jsii type, that
type's `fqn`. Two consumers derive from it: `translateTypeRef` joins the
fragment texts (used by code fences, where anchors do not belong), and
`translatedTypeRefHtml(ref, lang, linkFor)` escapes each syntax fragment
and wraps a named fragment in an anchor when the resolver finds a page.
Links resolve from the FQN, never the displayed name (the translated
spelling shares no text with TypeScript); a named type with no generated
page stays plain text; syntax fragments are escaped because Java and
.NET generics emit `<`/`>`. A single definition per language's type
syntax avoids parallel renderers drifting.

### Code examples from the rosetta tablet

A type page's `## Example` section is a `<LanguageTabs>` group with one
fenced block per enabled language (`src/docgen/examples.ts`), highlighted
by Shiki with VitePress's copy button for free:

- **TypeScript** renders the authored `docs.example`; the TypeScript tab
  is never driven by the tablet.
- **Other languages** render the rosetta tablet's `type`-snippet
  translation keyed by fqn when present
  (`src/docgen/rosetta.ts` `translationsForType(fqn)`); otherwise a
  generated minimal instantiation snippet reusing the transliteration
  helpers. Generated forms are idiomatic: Python `Queue(self, "MyQueue")`;
  Java uses the jsii Builder pattern
  (`Queue.Builder.create(this, "MyQueue").build()`) exactly when the
  initializer's last parameter is a locally resolvable struct jsii lifts
  into builder setters, and the constructor form otherwise; Go passes
  `jsii.String()` for the id, `nil` for omitted optionals (jsii `New*`
  functions are positional), with a grouped import pulling in
  `jsii-runtime-go`. The C# tab leads with
  `// Install: dotnet add package <packageId>` and the Go tab with
  `// Install: go get <module path>`.
- Non-instantiable types (enums, structs, behavioral interfaces,
  abstract classes, classes with no public initializer) and
  property/method examples keep a bare TypeScript fence even in
  multi-language mode. A module opts out of generated examples entirely
  via `docgen.config.json` `emitExamples`.

README code examples translate the same way (`src/docgen/rosetta.ts`):
only `moduleReadme` and `type` snippets are retained at parse time
(README snippets keyed by `(moduleFqn, source)` using the fence body
itself, type snippets by fqn). A fence with a translation is lifted out
of the README's `<div v-pre>` prose shield into a `<LanguageTabs>` group;
a fence without one stays untranslated inside the shield. Only column-0
fences are lifted — a fence indented inside a list item keeps its
authored TypeScript, because lifting it would break the list structure.
A package shipping no tablet, or a symbol absent from it, degrades to the
generated/untranslated form rather than failing the build.

### Headerless tabs, single navbar control

`LanguageTabs.vue` is a headerless show/hide wrapper: it keeps the
`.lang-variant` children, the shared-state-driven active selection, the
first-embedded-language fallback for blocks missing the active language,
and the scoped CSS that hides inactive variants — but renders no per-
block tab bar, ARIA roles, or keyboard handling. Language selection is
driven solely by the navbar slider `LanguageToggle.vue`, which carries
the full WAI-ARIA radio-group keyboard pattern and renders only when the
build enables 2+ languages (compiled-in constants from
`enabled-languages.ts`). See
[navbar, footer, and layout](./2026-10-15-navbar-footer-and-layout.md).

### Sidebar labels

The generated sidebar asset carries an optional per-language `labels`
field per node, emitted only for nodes whose label differs from the
canonical `text` (module/package labels), and never emitted on a single-
language build. The client renders the active language's label while
group keys, filter matching, and link targets stay on the canonical
`text`, so a language switch relabels the tree in place with no
navigation, expansion reset, or link change. See
[sidebar navigation](./2026-10-15-sidebar-navigation.md).

### Hydration and search cost control

Inert non-canonical variants — signature blocks and property-name spans,
static transliterated markup shown or hidden purely by CSS — are marked
`v-pre` so the SSR compiler skips them instead of re-encoding them into
each page's hydration chunk (roughly a 93% per-page JS cut versus
embedding them hydrated). The canonical variant stays hydrated so its
cross-linked signatures and type tooltips work, and example variants
stay hydrated so the copy button lives on every tab. All variant content
ships eagerly in the page HTML (no runtime fetch, works offline). Only
canonical (TypeScript) identifiers are Pagefind-indexed, so the index
and search ranking are flat in the language count; non-canonical
variants carry `data-pagefind-ignore`. See
[search and filter](./2026-10-15-search-and-filter.md) and
[SEO and agent discoverability](./2026-10-15-seo-and-agent-discoverability.md).

## Consequences

- A reader selects a language once in the navbar; signatures, symbol
  names, imports, install commands, code examples, and nav labels switch
  together everywhere, and the choice is shareable via `?lang=` and
  remembered across visits. Every existing deep link and `#member`
  anchor keeps resolving identically — a language is an in-page view, not
  a route.
- Page HTML grows with each embedded language, but the growth is static,
  cacheable, gzip-friendly markup; `v-pre` keeps per-page hydration JS at
  the single-language order of magnitude, which is what keeps the merged
  artifact under its compressed-size ceiling. The lazy per-page
  `<lang>.json` payload hatch is the designated relief valve if content
  growth ever approaches the ceiling even with `v-pre` applied; it was
  not needed for the current set.
- Build memory and CI shard count track per-shard page *size* with the
  full language set enabled, not language count. Shard count is tuned at
  the build layer; see
  [site generator and build](./2026-10-15-site-generator-and-build.md).
- Future language work is idiom-fidelity polish, not new enables — every
  jsii target is on. Richer per-language cross-linked HTML signatures
  beyond the canonical TypeScript renderer remain follow-up; non-TS
  signatures render as highlighted transliterated text.
- Rejected alternatives that still guide future work: path-per-language
  trees (page count is the binding constraint); transliterating authored
  TypeScript examples with a bundled jsii-rosetta translator (the tablet
  already ships the translations, so no translator dependency is taken).
