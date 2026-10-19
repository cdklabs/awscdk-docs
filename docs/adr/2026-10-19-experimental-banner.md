# Experimental Banner on Alpha Type Pages

## Status

Accepted

## Context

Every type in the reference carries a stability level read from the package
that publishes it. An experimental (alpha) package's module overview already
says so twice above the fold: the package README opens with its own
experimental notice, and the separate-install alert repeats the caveat. Its
type pages did not. Their only signal was a `Stability: Experimental` row
inside the metadata block, below the title and easy to read past, so a reader
who lands on an alpha type page from a search engine or a deep link can read
the whole page without noticing that the API may change under them. The
[API stability guide](../stability.md) explains what the level means; the type
pages did not make sure readers got as far as the indicator.

## Decision

Every type page of an experimental package opens with a banner above the page
title. The banner is the VitePress `warning` custom container the site already
uses for its alerts, so it inherits the theme's styling and reads as a distinct
block rather than a paragraph. It names the package, states that the API may
change in any release without a major version bump, and links the stability
guide.

Placement is fixed where type pages are assembled in `src/docgen/index.ts`:
frontmatter, then the breadcrumb, then the banner from
`renderExperimentalBanner`, then the H1. The banner is a container, not a
heading, so the H1 stays the page's first heading.

Module and submodule overview pages get no banner. The module overview already
opens with the README's own experimental notice and the separate-install alert;
a third box saying the same thing would be noise. The install alert is
unchanged.

The banner is keyed on the package's stability, not the type's. A type marked
experimental inside a stable package (the resource reference interfaces in
`aws-cdk-lib`, for example) keeps its `Stability: Experimental` metadata row
and gets no banner: the banner states a fact about the package the page
belongs to, and a banner on one page of `aws-cdk-lib` would read as a warning
about the library. Stable pages show nothing; the absence of the banner is the
stable indicator, as before.

The metadata row on type pages stays. It is where a reader looks for facts
about a type, and it costs nothing next to the banner.

## Consequences

- Alpha type pages are visibly experimental at a glance, including when
  entered from a deep link. Stable pages and all overview pages are unchanged.
- One more block above the fold on every alpha type page. The banner is short
  and the theme's container styling keeps it compact.
- Any future stability level that needs its own above-title treatment adds a
  branch to `renderExperimentalBanner`; nothing else in the page assembly
  changes.
