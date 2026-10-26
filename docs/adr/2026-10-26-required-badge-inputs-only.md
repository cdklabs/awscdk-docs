# Required Badge on Inputs Only

## Status

Accepted

Supersedes the *emitted unconditionally for a non-optional property* rule of
[required property marker as a distinct badge](./2026-10-21-required-prop-badge.md):
the badge is now emitted for non-optional inputs only. The badge's look and
the rest of that record stand.

Narrows the `required` sentence of
[optional property marker](./2026-10-23-optional-prop-marker.md): outputs no
longer keep the badge. The `?` mark and the rest of that record stand.

## Context

Every non-optional property got a `required` badge, whatever table it sat in.
On a class page the Properties section lists outputs such as `bucketArn`: the
reader never supplies them, and the value is always set. A `required` badge
there reads as "you must pass this", which is wrong. The choices below were
settled with the maintainer before the work started.

## Decision

- **Inputs get the badge, outputs never do.** An input is a property of a
  struct (jsii `datatype: true`): a struct page, or a construct's inlined
  props. A non-optional input keeps the `required` badge. An output is a
  property of a class, a construct, a behavioral interface (no `datatype`) or
  a mixin. It never gets the badge.
- **Outputs keep the `?`.** An optional output keeps its `?`, spoken as
  `may be undefined`. An always-set output carries no mark at all.
- **One flag decides both.** Each property table already says whether it lists
  inputs or outputs (`PropsRenderOptions.optionalKind`), set by the page
  renderer from the jsii `datatype` flag. The shared row renderer in
  `src/docgen/layout.ts` reads that one value for the badge and for the `?`
  label. The outline is unchanged: it never showed the badge.

## Consequences

- A class page no longer suggests its outputs must be supplied, and a props
  table still shows what a caller must pass.
- Which properties jsii marks optional is unchanged. Only where the badge
  appears changes.
- `test/api-layout.test.ts` checks the built pages: no badge on `Bucket`
  outputs such as `bucketArn`, `Function` outputs, or `IBucket`, and the badge
  on the required `code` prop of `FunctionProps`, on its own page and inlined
  on `Function`.
