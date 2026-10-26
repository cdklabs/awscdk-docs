# API Sidebar Navigation Styles

## Status

Accepted

## Context

The API sidebar defaults to its service grouping. A later change will let readers choose a package grouping like the previous reference site. Building and serving a second tree would duplicate large generated assets and let the two views drift.

## Decision

The service view stays the default. Both views use the existing skeleton and per-section chunks under `docs/public/api-sidebar`; no package skeleton, chunks, or folder are emitted.

Each type leaf carries its jsii module FQN and one stable package kind. The skeleton carries one compact module table with the assembly, service and CloudFormation-only flags, real overview link, and section stems owning that module. The package view maps those stems to the existing hashed chunks and loads only the chunks needed by an opened package.

The package tree follows these rules:

- `API Reference` is first and contains only the existing API overview.
- `aws-cdk-lib` has one root entry and one entry per first-level submodule. Deeper modules fold into that first-level entry.
- Every other assembly has one entry. Its submodules remain inside it.
- Entries sort by FQN segments, with `aws-cdk-lib` entries first.
- Categories sort as Constructs, Mixins, Classes, Structs, Interfaces, Enums, CloudFormation Resources, then CloudFormation Property Types. Pages sort by document id.
- Facades use Classes. Traits use Interfaces. Construct-level chips remain leaf data.
- Service submodule leaves merge into the parent categories. A real submodule overview gets a category named by its full FQN.
- Non-service submodules get categories prefixed by their name after the parent. A real overview gets a category bearing that same short name.
- CloudFormation-only service entries carry structured state for an accessible superscript-one marker.
- Only top-level entries collapse. Routes, anchors, search, and the rendered service view do not change.

The skeleton and largest chunk may each grow by at most ten percent when gzipped. Generated-output tests compare all service-view page links with the regrouped package view and require each link exactly once.

## Consequences

The later picker can switch views without new generated assets. The existing service tree remains canonical and unchanged in presentation. Package grouping depends on the small metadata fields, so their output shape and gzip limits are tested.
