# Sidebar Resource Groups Keyed by CloudFormation Resource Type

## Status

Accepted

Supersedes the *Resource groups* bullet of
[sidebar navigation](./2026-10-15-sidebar-navigation.md), which keyed a
resource group on the construct's name stem. Everything else in that
decision — section per service, Core, conditional wrappers, kind groups,
Framework / Services split, construct level as a field — stands.

## Context

Inside a service section the sidebar groups types by the AWS resource they
wrap. The original rule derived that resource from the type's *name stem*:
strip the `Cfn` L1 prefix, the `I` interface prefix and the `Props` suffix,
then compare stems exactly and case-sensitively. `CfnBucket`, `Bucket`,
`IBucket` and `BucketProps` all stem to `Bucket`, so S3 reads well.

The stem heuristic breaks wherever the L1 and L2 spell the resource
differently, and EC2 is the prominent case: the L1 is `CfnVPC`
(stem `VPC`), the stable L2 is `Vpc` (stem `Vpc`) and the alpha L2 is
`VpcV2` (stem `VpcV2`). Three constructs that provision the same
`AWS::EC2::VPC` resource render as three unrelated groups, and a reader
comparing them has no cue that they are alternatives.

Docgen already knows the backing resource. `cfnMetadata()` in
`src/docgen/constructs.ts` resolves a construct's CloudFormation resource
type from assembly metadata — the L1's `cloudformationResource` tag, an
L2/L3's `@resource` tag, or the conventional same-submodule `Cfn<Name>`
counterpart — and the type pages use it for the *CloudFormation resource*
metadata row. The sidebar simply never received it.

The sidebar module is deliberately kept free of classification: the caller
in `src/docgen/index.ts` already supplies each entry's construct level from
the same determination that badges the page, and the sidebar only arranges
what it is given. A resource key has to arrive the same way.

## Decision

`SidebarEntry` gains an optional `resourceType` — the CloudFormation
resource type string (`AWS::EC2::VPC`) — populated by the caller from
`cfnMetadata()` for every construct it resolves one for, and absent
otherwise. The sidebar never derives it from a name.

`resourceGroups()` then keys a section's resource groups as follows:

- **Constructs with a resource type** group by that resource type. Every
  construct backed by `AWS::EC2::VPC` lands in one group, whatever its name.
- **Constructs without a resource type** keep the name-stem rule. Base
  classes, pure logical constructs and most L3 patterns resolve no
  CloudFormation resource, and they group exactly as before. Nothing drops
  out of the navigation.
- **Bridging.** A construct with no resource type whose stem equals the
  stem of a construct that does have one joins that construct's group, so an
  unleveled or untagged sibling (`VpcBase`-style helpers aside) does not
  split off a second group under the same resource.
- **Related types** (structs, interfaces, enums, mixins, facades) attach by
  stem, as before: their stem is matched exactly or as the longest prefix at
  an uppercase boundary against the stems of the section's constructs, and
  they follow that construct into its group. `VpcProps`, `IVpc`,
  `CfnVPCProps` and `VpcV2Props` therefore all attach to the VPC group
  through `Vpc`, `CfnVPC` and `VpcV2` respectively. Types matching no
  construct still land in the service-level *General* group.

**Heading rule.** A group keyed by resource type is headed by the name of
its L2 construct. When several L2s share the resource, the one whose name
spells the resource name — the last segment of the CloudFormation type,
compared case-insensitively — wins: `Vpc` heads the `AWS::EC2::VPC` group
over `VpcV2`, and `Instance` heads `AWS::EC2::Instance` over
`BastionHostLinux`, which carries that `@resource` tag upstream. When none
spells it, the alphabetically first L2 is used. A group with no L2 (L1 only,
or L3 only) is headed by the resource name itself, which is also the L1's
stem. A name-keyed group is headed by its stem, as before. Groups sort by
heading with *General* last; two groups that would share a heading merge,
since to the reader they are one resource.

Each leaf keeps its construct level and its experimental marking, so a
merged group still reads `L2 Vpc · L2 VpcV2 (experimental) · L1 CfnVPC`.

The Framework sections and the Core group are untouched: resource grouping
never applied there and still does not.

## Consequences

- Alternatives for one resource sit together: EC2 shows one *Vpc* group
  holding `Vpc`, `VpcV2` and `CfnVPC`, where it showed *VPC*, *Vpc* and
  *VpcV2*. Every service whose L1 and L2 spellings diverge gains the same
  merge for free, with no per-service list.
- A pattern construct tagged with the resource it provisions joins that
  resource's group: `BastionHostLinux` (`@resource AWS::EC2::Instance`)
  now sits under *Instance* instead of heading a group of its own. That is
  what the tag says the construct is, and the leaf keeps its own name.
- Headings change only where a merge happens or where an L1-only group's
  resource name differs from its stem; everywhere else the tree is
  byte-identical to the name-stem output. Page routes, anchors and
  cross-reference targets are unaffected — only where a type is listed
  changes.
- `SidebarEntry` carries one more field computed by the caller. The sidebar
  module still performs no classification of its own, and the unit tests can
  drive the grouping with a literal `resourceType` and no jsii assembly.
- The fallback keeps the known limits of the stem heuristic for untagged
  constructs: a construct whose name does not reference its resource and
  that resolves no CloudFormation type still lands in *General*.
