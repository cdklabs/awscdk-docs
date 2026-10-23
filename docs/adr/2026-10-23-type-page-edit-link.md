# Edit Link on Type Pages

## Status

Accepted. Supersedes the symbol-page rule in
[page feedback, consent, and stamp — Edit-this-page link and upstream provenance](./2026-10-15-page-feedback-consent-and-stamp.md#edit-this-page-link-and-upstream-provenance),
which gave class, interface, struct and enum pages no edit link.

## Context

Type pages are generated from jsii docstrings, so there is no markdown file for
them in this repository, and they rendered no edit link. A reader who spotted a
typo on one could only file a report, not propose a fix.

The docstrings do have a source: the TypeScript file the type is declared in,
which the jsii assembly records as `locationInModule`. The type page already
links that file in its `Source` metadata row, pinned to the released version.

## Decision

- **A type page links the file its docstrings are declared in.**
  `upstreamSourceUrl()` in `src/docgen/provenance.ts` builds the URL, and docgen
  writes it to the type page's frontmatter as `upstreamEditUrl`, after `title`.
  The theme renders it through the same `editLinkFor()` path and the same
  "Edit this page" label as an overview's README link, so there is one edit link
  mechanism, not two.
- **The README provenance rules apply unchanged.** The owning repository and
  package directory come from the assembly, the URL pins to `HEAD`, and a
  repository URL or path that is not plain https path data yields no link.
- **No line anchor.** The recorded line belongs to the released version; on the
  default branch it moves. The version-pinned `Source` row keeps the line.
- **No link without an editable file.** A type from build-generated code
  (`*.generated.*`, the L1 `Cfn*` types) or with no recorded location gets no
  edit link, only the report link — a misleading link is still worse than none.
- **The report link reads "Report an issue".** With two actions on most pages,
  the shorter label keeps the row readable. Its target is unchanged.

## Consequences

- Every hand-written type page carries an edit link; L1 pages do not, so the
  footer shape still differs by page kind, and the browser spec pins both.
- The link opens the whole source file, not the docstring. A reader finds the
  type by name in the file, the normal cost of linking a moving branch.
- A source file renamed upstream breaks the link until the next docs build picks
  up a new assembly, the same trade-off the README links accept.

### Rejected alternatives

- **Pinning to the release tag, like the `Source` row.** An edit must land on a
  branch a change can be made against, and alpha versions have no upstream tag.
- **A separate "Edit source" label on type pages.** It needs a second flag through
  frontmatter for the same action an overview page already calls "Edit this page".
