# Move Alpha Modules Independently

## Status

Accepted

Supersedes the all-modules-must-publish rule in
[versions and history](./2026-10-15-versions-and-history.md).

## Context

The nightly version refresh used one `cdkAlpha` pin for every documented
alpha module. One late or retired module therefore held every alpha at the
older release. Registry absence cannot safely distinguish a late package from
a removed one, and a failed registry call is not removal evidence.

The aws-cdk source tree is the release's source of truth. Each published tag
contains one folder under `packages/@aws-cdk` for every alpha package that
release still ships.

## Decision

For the target core release, the refresh reads
`packages/@aws-cdk` at tag `v<version>`.

- A documented module with a folder at the tag and the target npm version is
  moved to the target alpha version.
- A documented module with a folder but no target npm version is late. Its
  current version is kept in `cdkAlphaOverrides` while other modules move.
- A documented module without a folder is gone. The refresh removes it from
  `docgen.config.json`; projen then removes its generated dependency.
- A failed tag read makes every module unknown. A failed npm read makes that
  module unknown. Unknown modules keep their current pins and are never
  removed.

`cdkAlpha` remains the default pin. `cdkAlphaOverrides` stores only held
exceptions and drops an entry when its module catches up. The refresh PR names
each removed module and the checked release tag.

Both nightly planners use one release-tag reader. The version refresh applies
its recorded plan offline, before projen regenerates `package.json` and the
version-history ledger.

## Consequences

Most alphas can move when one package publishes late. Removed modules no
longer stall the refresh or leave dead generated pages. Every removal has
source-tree evidence. A failed external read favors stale pins over accidental
deletion.
