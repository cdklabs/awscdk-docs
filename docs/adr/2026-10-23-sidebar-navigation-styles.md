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

### The reader's choice

The second step lets readers pick the grouping. The choice is a plain reader preference, held and persisted like the code theme:

- **State.** `docs/.vitepress/theme/nav-style.ts` holds a shared `navStyle` ref of `service` (the default) or `package`, stored in `localStorage` under `cdk-docs-nav-style`. An unknown stored value falls back to `service`. The style changes no attribute and no stylesheet, so it needs no pre-hydration bootstrap script: the sidebar reads it when it mounts, before it renders a tree.
- **Picker.** The Settings menu gets a `Navigation` group with `By service` and `By package`, rendered by `NavStylePicker.vue` on the same segmented `aria-pressed` track as the theme pickers, with text segments because the two styles have no recognisable glyph. The mobile nav screen keeps its direct theme picker row and no navigation control; the drawer shows whichever style the reader last chose.
- **One load, two groupings.** `ApiSidebar.vue` keeps the fetched skeleton with its loaded chunks as the service tree and derives the package tree from the same loaded chunks with `buildPackageSidebar`. The tree the reader sees is picked by style; a switch regroups at once, shows no loading state, and makes no request. The package tree is rebuilt only while the package style is showing, at most once per 250 ms while chunks stream in, and on demand when the reader switches, because a rebuild walks every loaded leaf and the filter loads hundreds of chunks at once.
- **What loads when.** Both styles fetch the skeleton and the active page's chunk on load, so a reader who never opens the picker makes no extra request. Opening a package loads the chunks its entry names (`chunks`) and no others; the filter loads every chunk in either style, as before.
- **Defaults per style.** The service style opens the generated tree's pre-opened roots (Framework, Services). The package style opens `API Reference` and, through the same additive reveal that already unfolds the active page's ancestors, the entry holding the active page; every other package starts collapsed.
- **Memory per style.** Collapse memory and scroll memory each keep one store per style. The service style keeps the existing keys (`cdk-docs:sidebar-expanded:v1`, `cdk-docs-sidebar-scroll`), so a current reader loses nothing; the package style suffixes them with `:package`. A style prunes only its own collapse store, against its own tree's live keys, so loading one style never forgets the other's choices. The open set is kept per style too, so folding a package does not fold a service and the service style comes back as it was left.
- **Everything else is shared.** The navigation filter, Favorites, Locate current page, the sticky header, keyboard navigation and the mobile drawer act on whichever tree is showing. Routes, anchors and page content do not change, and a style switch keeps the current page.

`test/nav-style.test.ts` pins the state module, the storage keys and the separation of the two collapse and scroll stores; `test/e2e/nav-style.spec.ts` pins the picker, the no-request switch, the per-style defaults and memory, the chunk-on-open rule and the filter in the package style, on the built site.

## Consequences

The picker switches views without new generated assets. The existing service tree remains canonical and unchanged in presentation. Package grouping depends on the small metadata fields, so their output shape and gzip limits are tested.

A reader's sidebar state now lives in up to four stores instead of two, one collapse and one scroll store per style. The package tree is a client-side regrouping, so its cost scales with the loaded leaves; the throttle bounds how often it is paid while chunks stream in.
