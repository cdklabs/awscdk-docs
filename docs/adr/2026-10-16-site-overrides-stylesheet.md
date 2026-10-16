# Site Overrides Stylesheet

## Status

Accepted

## Context

The publisher that deploys the built site to docs.aws.amazon.com needs to add its own styling. Rewriting the
`<head>` of every built page to add a stylesheet is fragile, and it couples the publisher to the markup this
repository happens to emit.

## Decision

Every page links one stylesheet, `site-overrides.css`, which the publisher replaces with its own file.

- **Location.** The file is `docs/public/site-overrides.css` in this repository and ships at
  `<base>/site-overrides.css` in the artifact, for example `/cdk/api/site-overrides.css`. The name carries no
  content hash, so the path stays fixed and replaceable.
- **A placeholder here.** In this repository the file contains only a comment explaining its purpose. The
  publisher's build replaces it with the real stylesheet. Site styles of this repository belong in the theme.
- **Contract: replace the file, don't edit the HTML.** The publisher overwrites the file in the artifact. The
  pages need no change.
- **Loaded last.** The link is a `head` entry in `docs/.vitepress/config.mts`, with its href built from the
  configured base. VitePress renders `head` entries after the theme stylesheets, so an override wins at equal
  specificity. Every page carries exactly one link, including the home page, `/versions` and the 404 page.
- **Plain stylesheet.** No inlining and no script: a `<link rel="stylesheet">` is all the extension point
  needs.

## Consequences

- Every page makes one extra stylesheet request. Because the name is unhashed, the file cannot be cached as an
  immutable asset the way the hashed build assets are.
- The publisher's rules win wherever specificity ties with the theme, but higher-specificity theme rules still
  win over them.
- Theme class names and CSS custom properties become an informal surface for downstream styles. Renaming them
  can break the publisher's stylesheet without breaking anything in this repository.
- This repository never sees the real stylesheet. The browser suite substitutes a stand-in file to prove a
  replacement applies and wins over the theme.
