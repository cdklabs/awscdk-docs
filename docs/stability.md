# API Stability

Every type in this reference carries a stability level, taken from the package
that publishes it. The level tells you how much the API can change between
releases, and therefore how much of a commitment you make by depending on it.

## Stable

Stable APIs are part of the supported AWS CDK release surface and follow
[semantic versioning](https://semver.org/): within a major version they only gain
capabilities. A construct's props, a method's signature, an enum's members — once
released as stable, none of these are removed or changed in an incompatible way
without a new major version.

Nearly all of `aws-cdk-lib` and all of `constructs` is stable. A stable type page does
not call out its stability; the absence of an indicator means stable. L1 constructs
(the `Cfn*` classes and their props) mirror the CloudFormation resource
specification and change only as that specification does.

## Experimental

Experimental APIs are still in developer preview. Most ship in separate
`@aws-cdk/*-alpha` packages, versioned and released alongside `aws-cdk-lib` but
outside its compatibility guarantee: an experimental API may change or be removed
in any release, without a major version bump. A few live inside `aws-cdk-lib` itself
and are marked experimental individually — the resource reference interfaces such
as `IBucketRef`, for example — so check the indicator rather than the package name.

Experimental APIs are the way to try new services and features before they are
finalized, and feedback on them shapes the stable API that follows. Depending on
one in production means accepting that a routine upgrade can require code changes,
so pin the alpha package's exact version and read its release notes before moving.

When an alpha module graduates, its constructs move into `aws-cdk-lib` under the
stable guarantee and the alpha package is deprecated.

## How the level is shown

An experimental type shows **Stability: Experimental** in the metadata block at
the top of its page, linking here. The module's own page opens with a warning
that says the same. Stable types show no stability indicator.

The level is read from the published package metadata: a type's own declared
stability when it has one, otherwise the stability of the module it belongs to.
