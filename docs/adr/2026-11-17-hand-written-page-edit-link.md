# Edit Link on Hand-written Pages

## Status

Accepted. Supersedes the hand-written page rule in
[page feedback, consent, and stamp — Edit-this-page link and upstream provenance](./2026-10-15-page-feedback-consent-and-stamp.md#edit-this-page-link-and-upstream-provenance),
which linked hand-written pages to `aws/aws-cdk`.

## Context

The hand-written pages with a doc footer (`skills.md`, `stability.md`,
`aws-construct-library.md`, `versions.md`) live in `docs/` of
`cdklabs/awscdk-docs`; `index.md` uses the home layout, which renders no doc
footer. Their edit link pointed at
`https://github.com/aws/aws-cdk/edit/main/docs/<filePath>`, a file that does
not exist in that repository, so every one of them opened a 404.

The versions page lists live release data. Its markdown is a page shell, so a
reader who spots a wrong version has nothing useful to edit there.

## Decision

- **A hand-written page links its own markdown in this site's repository:**
  `https://github.com/cdklabs/awscdk-docs/edit/main/docs/<filePath>`, built by
  `editLinkFor()` in `docs/.vitepress/theme/feedback.ts`.
- **A page can opt out with `editLink: false` in its frontmatter.**
  `PageFooterLinks.vue` passes the key to `editLinkFor()` next to
  `upstreamEditUrl`, and the opt-out wins over both the upstream file and the
  path rule. The key is VitePress's own name for this setting; the native edit
  link stays disabled, so the footer component is still the only one that reads
  it. `docs/versions.md` sets it.

## Consequences

- Hand-written pages open a real file editor instead of a 404.
- The versions page footer shows only the report link and the revision line,
  the same shape as a generated page with no editable source.
- Generated pages are unchanged: `upstreamEditUrl` still wins, and a generated
  page without it still gets no edit link.
