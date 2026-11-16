# Source Links for Relocated Packages

## Status

Accepted. Amends [Edit Link on Type Pages](./2026-10-23-type-page-edit-link.md) for relocated packages only: it
leaves that ADR's decision in force for every other type.

## Context

`aws-cdk-lib` re-exports the types of `@aws-cdk/cloud-assembly-schema` as its `cloud_assembly_schema`
submodule. The jsii assembly records where those types were declared as a path under
`node_modules/@aws-cdk/cloud-assembly-schema/`, inside a `.d.ts` declaration file, with the line number of
that declaration file. The `Source` row and the edit link joined that path onto the `aws-cdk` repository,
so the FeatureFlag page linked to a `node_modules` path that does not exist there and returned 404.

The package is maintained in the `aws-cdk-cli` repository, where the `.ts` file exists.

## Decision

- **A type recorded under `node_modules` links to its `.ts` file in the repository that owns the package.**
  The mapping lives in `RELOCATED_PACKAGES` in `src/docgen/provenance.ts`, which `relocatedSource()` reads. It
  currently lists only `@aws-cdk/cloud-assembly-schema`, owned by `aws/aws-cdk-cli` under `packages/@aws-cdk/cloud-assembly-schema`.
- **No source or edit link ever targets a `node_modules` path or a `.d.ts` file.** A type in an unmapped
  package gets no link, the same as a type with no recorded location.
- **The `Source` row and the edit link use the same target.** Both point at the default branch (`HEAD`)
  with no line anchor. The assembly records a range for the schema dependency, not the exact version that
  was installed when `aws-cdk-lib` was built, so no `aws-cdk-cli` tag can be named with confidence. The
  line number belongs to the `.d.ts` file and would not match the `.ts` file.
- **The `Source` row shows the file path inside the package**, for example
  `lib/cloud-assembly/artifact-schema.ts`, not the recorded `node_modules` path.

## Consequences

- The FeatureFlag source link and edit link resolve to a real file.
- A relocated type's `Source` row is not pinned to a release, unlike every other type's. A file renamed
  upstream breaks the link until a new assembly is built.
- The linked file reflects the schema on the default branch of `aws-cdk-cli`, which can be newer than the version
  bundled in the documented `aws-cdk-lib` release. A reader checking a type's shape against its Source row can see
  a declaration that differs from the reference page.
- A possible follow-up is to read the installed schema package's version and pin a matching `aws-cdk-cli` tag.
- Supporting another relocated package means adding one entry to the mapping.

### Rejected alternatives

- **Pinning to an `aws-cdk-cli` release tag.** The shipped schema version is not recorded in the assembly,
  so a tag could name a version that was never installed.
- **Keeping the link and fixing only the repository.** The path would still contain `node_modules` and end
  in `.d.ts`, which no repository holds.
