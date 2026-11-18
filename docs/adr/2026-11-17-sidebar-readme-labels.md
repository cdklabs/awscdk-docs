# Sidebar Readme Labels

## Status

Accepted. Supersedes, for Services sections, the `Overview (<submodule>)`
labels in
[sidebar navigation — Overview entries](./2026-10-15-sidebar-navigation.md).
Framework sections keep those labels.

## Context

A Services section can fold several readme pages: S3 holds `aws_s3`,
`aws_s3_deployment` and `aws_s3_notifications`, and Amplify holds `aws_amplify`
and `@aws-cdk/aws-amplify-alpha`. Each was labeled `Overview (<module>)`, so a
section showed several "Overview" entries. The module label is the one the
reader's language uses, and in Go that is a full import path such as
`github.com/aws/aws-cdk-go/awscdk/v2/awss3deployment`, which crowds the
sidebar.

## Decision

In a Services section with more than one readme, `overviewItems()` in
`src/docgen/sidebar.ts` labels each entry by these rules, first match wins:

1. **The primary `aws-cdk-lib` service module is `Overview`.** It is the
   `aws_<service>` or `alexa_<service>` module that already sorts first. A
   section with a single readme keeps its plain `Overview`.
2. **A few readmes carry a fixed label.** `@aws-cdk/aws-iot-actions-alpha` is
   `Actions for AWS IoT Rule`, its page title.
3. **The service's own alpha package is `Developer Preview`.** That is the
   root readme of `@aws-cdk/aws-<service>-alpha`, with no further suffix after
   the service name, whose jsii assembly is `experimental`. The stability
   comes from the assembly; the name only picks out the service's own package.
   Other alpha packages in the section, such as
   `@aws-cdk/aws-lambda-python-alpha`, fall through to rule 4, so Lambda does
   not show the same label several times.
4. **Every other readme is labeled by its module name in the reader's
   language,** with no `Overview (…)` wrapper. In TypeScript that is the
   submodule or package name (`aws_s3_deployment`,
   `@aws-cdk/aws-lambda-python-alpha`). Python, Java and .NET use their module
   label (`aws_cdk.aws_s3_deployment`), which already names the package. Go
   uses the package name, the last import path segment that is not a major
   version (`awss3deployment`, `awscdklambdapythonalpha`), so no label is a Go
   import path. When two packages give one section the same module name, the
   TypeScript label is qualified as `<package>/<module>` and the Go label as
   `<go module>/<package>` (`awscdkcfnpropertymixins/awss3`).

The order of entries does not change. Links, page URLs, page titles and the
search index do not change.

## Consequences

- Each service shows at most one `Overview`, which is its primary module's
  readme, and the service's own experimental single-token alpha package reads
  as `Developer Preview`.
- A new readme with its own page title, like the IoT actions one, needs an
  entry in `FIXED_README_LABELS`; otherwise it is named by its module.
- A section whose readmes have no primary `aws-cdk-lib` module, and that holds
  more than one, shows no `Overview` entry; every entry is named by rule 2, 3
  or 4.
