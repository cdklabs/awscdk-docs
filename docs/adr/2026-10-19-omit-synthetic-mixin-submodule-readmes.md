# Omit synthetic mixin submodule overview pages

## Status

Accepted

## Context

Every documented module — package root or submodule — owns one overview page at
its canonical `…-readme` URL, composed from an `overviews` config entry that
defaults to the module's own README and falls back to a type-list-only page when
the module ships no README.

The CloudFormation property mixins package documents a large tree of generated
submodules (one per service, e.g. `aws_lambda`, `aws_lakeformation`). These
submodules contain only mixin types and ship no upstream README, so each one's
overview resolves to the type-list-only fallback. The result is a `…-readme`
page per mixin submodule whose heading corresponds to no readable upstream
document and whose body duplicates the type table already reachable from the
sidebar. Those pages are noise in navigation and in search, and a reader who
lands on one learns nothing a type page would not tell them.

The overview system had no way to express "this module owns no overview page":
its kinds are `readme`, `none` (type list, no README body), `copy`, and
`generated`. `none` still emits the type-list page, which is exactly the page we
want gone.

## Decision

A submodule overview page is omitted entirely when both hold:

- every type grouped under the submodule is a mixin, by the existing `IMixin`
  marker classification (`MixinIndex` / the mixin-class index), and
- the submodule resolves no real upstream README (its overview is `generated`,
  or its resolved README body is empty).

The omission is keyed on the mixin classification rather than on the
`@aws-cdk/cfn-property-mixins` package name, so it follows the marker if the
library's mixin packaging changes, and it is deliberately conjunctive: a
submodule that has a real README of its own, or that contains any non-mixin
type, keeps its overview page unchanged.

An omitted submodule is excluded from the set of emitted submodules, so it gets
no `…-readme` page, no sidebar index link (its type entries index the package
root instead), no entry in the package root's "Submodules" list, and no search
entry — the four surfaces that would otherwise point at a page that was never
written.

The package root overview those types index is the package's page, not the
service's. So the sidebar never shows it as a service's Overview entry: a
service section lists only overview pages of its own submodules. Instead the
package is listed once in Framework, with the package root overview as its
Overview and any root-level types below it, and it nests under its Framework
parent like every other unlisted package. One entry per page means one
highlight per page.

The documented mixin packaging and version pin are covered by
`2026-10-15-docgen-sources-and-modules.md`; this decision only changes which
overview pages that tree emits, not what it documents or how mixin type pages
render.

## Consequences

- Mixin submodules with no real README no longer produce a `…-readme` overview
  page, and nothing links to one, so the navigation and search index carry only
  pages with real content.
- Mixin type pages are unaffected: they still render and still appear in the
  sidebar, indexing the package root rather than a removed submodule overview.
- Real submodule overviews — any submodule with its own README, or with a
  non-mixin type — are untouched, because the rule requires both conditions.
- The package root overview has exactly one sidebar entry, in Framework, and no
  service section repeats it, so a reader never sees a row of identical
  Overview links that all highlight together.
- The rule is automatic and needs no per-submodule `overviews` config; a new
  mixin submodule is covered the moment it is documented.
