# Page Feedback, Cookie Consent, and the Build Stamp

## Status

Accepted

## Context

Every docs page carries community-engagement affordances — an "Edit this
page" link and a "Report an issue with this page" link — and, as an
AWS-branded property under `docs.aws.amazon.com`, AWS's standard
cookie-consent UI. Two properties of the site constrain how these work:

- Most pages are **generated** from jsii assemblies at build time and are
  gitignored, so there is no markdown file in the repo to edit and a naive
  edit link would 404.
- The site is **statically hosted** with no backend (see
  [publishing](./2026-10-15-publishing-and-hosting.md)), so feedback cannot be
  posted to a server we own, and consent must come from a third-party script.

Separately, the built site is published as a zip that a downstream pipeline
republishes and into which it injects its own version and timestamp by plain
string replacement. The displayed version and generated-at date are otherwise
unmarked in the HTML, and every value on `themeConfig`/`head` ships a second
copy in a content-hashed JS metadata chunk that the client re-renders from on
hydration — so an HTML-only edit is reverted in front of the reader.

## Decision

### Report-an-issue link

A GitHub new-issue URL on `https://github.com/cdklabs/awscdk-docs`, pre-filled with the
page title, page URL, documented `aws-cdk-lib` version, user agent, and a
`documentation` label. It is built client-side so it can capture the live URL
and user agent. The URL/body construction lives in a pure, Jest-testable module
(`docs/.vitepress/theme/feedback.ts`), shared by config and component.

### Edit-this-page link and upstream provenance

The edit link resolves from `editLinkFor(filePath, upstreamEditUrl)`:

- **Hand-written pages** link to their own markdown:
  `https://github.com/aws/aws-cdk/edit/main/docs/<filePath>`.
- **Generated overview pages** link to the upstream `README.md` the prose came
  from, not to this repo's `src/docgen`. Docgen emits `upstreamEditUrl` into the
  page frontmatter; the pure helper takes it as an argument and it wins
  outright. `isGeneratedPage()` (path prefix `v2/`) guards against ever making a
  generated page's own gitignored path an edit target.
- **Symbol pages** (class, interface, struct, enum) and table-only overviews
  render **no edit link** — a misleading link is worse than none. The footer
  still shows the report link, so footer shape differs by page kind
  deliberately, and the browser spec pins both shapes.

Provenance is resolved per-assembly from the jsii assembly, never derived from
the module name (`src/docgen/provenance.ts`):

- `assembly.repository` gives the owning repo URL and the package's directory
  within it, so standalone and alpha packages follow their own repository rather
  than a hardcoded `aws/aws-cdk`.
- A submodule's README directory is read off its `symbolId` (`aws-s3/index:` →
  `aws-s3/README.md`), the assembly's own answer, because name derivation is
  wrong for cases like `custom_resources` → `custom-resources`.
- URLs pin to **`HEAD`**, which GitHub resolves to the repo's default branch —
  an edit must land on a branch a change can be made against, and alpha
  assemblies carry versions (`2.266.0-alpha.0`) for which no upstream tag
  exists. This is deliberately unlike the version-pinned `Source` link on type
  pages.
- `repository.url` is untrusted metadata bound into an `href`, so it must match
  a strict `https://` shape (`SAFE_REPO_URL`); SSH, npm-shorthand, and
  `javascript:` forms fail closed to the no-link path.
- A `kind: "copy"` overview (one module's README on another's page) attributes
  the edit link to the source module.

### AWS cookie consent via the boot script

Load the AWS documentation platform's bootstrap — no vendoring, no dependency,
no home-grown banner — and give it the hooks it expects:

- **In `head`** on every page (`docs/.vitepress/config.mts`): the two meta tags
  it reports under — `guide-name = API Reference`,
  `service-name = AWS Cloud Development Kit (AWS CDK)` — and
  `<script src="https://docs.aws.amazon.com/assets/js/awsdocs-boot.js" async defer>`.
  Static head markup, not a mount-time append, so it never depends on hydration.
  VitePress is an SPA, so the script runs once per full page load; the banner and
  cookie are per-visit concerns and the banner lives outside the Vue root.
- **Footer link, not the legal-zone container.** `SiteFooter.vue` renders the
  legal line itself in the site's styling. Its "Cookie preferences" anchor
  carries `id="awsdocs-cookie-preferences-link"` — the only public hook the
  script exposes for reopening the Shortbread preferences modal; the script sets
  `onclick` on it at DOM-ready and the element survives hydration and
  navigation. `@click.prevent` stops the bare `#` scrolling to the top if the
  script is blocked.

The boot script bundles Shortbread, shows the banner to EU-geolocated visitors,
persists the choice in the `awsccc` cookie, and loads consent-gated AWS
analytics. No CSP is set today; if one is added it must allow `script-src`/
`connect-src` for `docs.aws.amazon.com`, `*.shortbread.aws.dev`, and the
analytics hosts.

### Marked HTML build stamp

Emit one stamp block into every page's `<head>` via the `transformHtml` hook, so
it lands outside the Vue app and no JS chunk carries a copy:

```html
<!--CDK_DOCS_STAMP_BEGIN-->
<meta name="cdk-docs-version" content="2.268.0">
<meta name="cdk-docs-generated-at" content="2026-09-10T09:47:12.000Z">
<!--CDK_DOCS_STAMP_END-->
```

- Carries the real installed `aws-cdk-lib` version and the version snapshot's
  `generatedAt` (not the clock, so two builds of one commit stay
  byte-identical). The sentinels make them findable; a site published without
  rewriting is correct as built. The downstream edit is one `re.sub` per field.
- **Authoritative at runtime.** `VersionBadge.vue`, `PageFooterLinks.vue`, and
  `docs/versions.md` read the stamp during `setup` (client-side, before first
  render). Rewriting it changes the badge, the report-issue template version,
  and the "last updated" line. `themeConfig.cdkVersion` remains only the
  fallback for unstamped output (SSR, dev server); theme code must not read it
  directly, and a unit test pins the stamp-first order in all three consumers.
- Values are attribute-escaped (`escapeAttr`) and the version is semver-validated
  (`assertValidVersion`); re-stamping an already-stamped page is a no-op.
  `versions.json` carries no markers — a consumer parses it as JSON.
  (`src/site-stamp.ts`.) New injectable values are a new field plus a reader.

### Testing

A per-page gzipped JS+CSS budget (see [quality gates](./2026-10-15-quality-gates.md))
blocks `*docs.aws.amazon.com*` in `scripts/lighthouse-run.cjs`: the ~1.2MB boot
script is AWS's shared platform baseline, not a cost this repo can move, and
counting it would fail every page. The e2e suite blocks `docs.aws.amazon.com` at
the browser level for every spec except `test/e2e/cookie-consent.spec.ts`, which
runs in its own Playwright project with network access and answers Shortbread's
geolocation probe with 200 so the EU-only banner is deterministic regardless of
runner location.

## Consequences

- Every page gets consistent feedback affordances with no backend and no new
  dependency. README-backed overview pages carry a frontmatter block (keeping
  their right-hand outline and README H1); symbol pages carry no edit link.
- Edit links point at a moving default branch, so they can go stale if an
  upstream README is renamed — the normal cost of linking another repo's file,
  preferable to a link dead for a whole package class from day one. An assembly
  with no (or an unrenderable) `repository` simply gets no edit link, no opt-out
  config needed.
- The site becomes network-dependent on `docs.aws.amazon.com` for the banner,
  preferences modal, and analytics; if it fails the rest of the site is
  unaffected and the footer link does nothing. The site now sets the `awsccc`
  cookie and, with consent, AWS analytics cookies. Analytics page views are
  recorded on full loads only, not client-side route changes.
- The stamp block is identical on every page (~130 bytes × ~21.9k pages, under
  3MB total). A reader with JavaScript disabled, or SSR output before hydration,
  sees the build-time values until the hydrated render adopts a rewritten stamp.

### Rejected alternatives

- Patching the content-hashed JS metadata chunks for downstream version
  injection — brittle: sharded hashed names, JSON-escaped values inside JS.
- Letting the boot script fill its `#awsdocs-legal-zone` container — injecting
  HTML into a Vue-managed element around hydration is a mismatch; the footer
  renders its own legal line and exposes only the preferences-link id.
