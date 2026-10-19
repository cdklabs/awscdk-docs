# Experimental Banner on Alpha Package Pages

## Status

Accepted

## Context

Every type in the reference carries a stability level read from the package
that publishes it. Until now an experimental (alpha) package signaled that
level in two quiet places: a `Stability: Experimental` row inside the metadata
block of each type page, and a sentence inside the separate-install alert on
the module overview. Both sit below the page title and look like ordinary body
text, so a reader who lands on an alpha type page from a search engine or a
deep link can read the whole page without noticing that the API may change
under them. The [API stability guide](../stability.md) explains what the level
means; the pages did not make sure readers got as far as the indicator.

## Decision

Every page belonging to an experimental package — the module overview, each
submodule overview and each type page — opens with a banner above the page
title. The banner is the VitePress `warning` custom container the site already
uses for its alerts, so it inherits the theme's styling and reads as a distinct
block rather than a paragraph. It names the package, states that the API may
change in any release without a major version bump, and links the stability
guide.

Placement is fixed by `renderExperimentalBanner` and the shared page
assemblers in `src/docgen/index.ts`: frontmatter, then the breadcrumb, then
the banner, then the H1. The banner is a container, not a heading, so the H1
stays the page's first heading and VitePress still derives the page title from
it on overview pages.

The banner is keyed on the package's stability, not the type's. A type marked
experimental inside a stable package (the resource reference interfaces in
`aws-cdk-lib`, for example) keeps its `Stability: Experimental` metadata row
and gets no banner: the banner states a fact about the package the page
belongs to, and a banner on one page of `aws-cdk-lib` would read as a warning
about the library. Stable pages show nothing; the absence of the banner is the
stable indicator, as before.

The separate-install alert no longer repeats the stability caveat and no longer
switches to the `warning` style for alpha packages: with the banner directly
above the title, a second warning box saying the same thing two lines lower is
noise. Every standalone package now gets the same `info` install alert.

The metadata row on type pages stays. It is where a reader looks for facts
about a type, and it costs nothing next to the banner.

## Consequences

- Alpha pages are visibly experimental at a glance, including when entered
  from a deep link. Stable pages are unchanged.
- One more block above the fold on every alpha page. The banner is short and
  the theme's container styling keeps it compact.
- The install alert on alpha module pages is shorter and shares its style with
  stable standalone packages.
- Any future stability level that needs its own above-title treatment adds a
  branch to `renderExperimentalBanner`; nothing else in the page assembly
  changes.
