# Fold Events Submodules Under Their Service

## Status

Accepted

Extends the omission rule of
[omit synthetic mixin submodule overview pages](./2026-10-19-omit-synthetic-mixin-submodule-readmes.md)
to events submodules, and adds one placement rule to the resource grouping of
[sidebar navigation](./2026-10-15-sidebar-navigation.md). The documented
package set is recorded in
[docgen sources and modules](./2026-10-15-docgen-sources-and-modules.md).

## Context

`@aws-cdk/mixins-preview` ships, next to its per-service `mixins` submodules,
a generated `<service>.events` submodule per service — 64 of them at
2.274.0-alpha.0 — holding the service's EventBridge event patterns. Each has
the same shape: a class per event (`DLMPolicyStateChange`,
`EC2InstanceStateChangeNotification`) with a static `eventPattern()`, nested
detail structs under each class, and for 31 services a *facade* class
(`InstanceEvents`, `RepositoryEvents`, `AlarmEvents`) that fronts one
construct: `InstanceEvents.fromInstance(IInstanceRef)` already matches the
facade rule of `classification.ts` and is classified `Facade`.

The sidebar only knew two structural submodule shapes, `interfaces.*` and
`*.mixins`. Everything else is treated as a service of its own, so every
events submodule rendered as a top-level *Dlm.events*-style section after its
service, each with an *Overview* link to a generated `…-readme` page that is a
bare type list — the same noise the mixin ADR removed for `*.mixins`. Inside
the service, had the types been folded by name alone, `InstanceEvents` would
have attached to *Instance* by stem but so would any event whose name happens
to start with a resource stem, and the rest would have scattered across the
service's *Others* lists.

## Decision

`events` is the third structural submodule segment, beside `interfaces` and
`mixins`. `serviceSubmodule('aws_dlm.events')` is `aws_dlm`; the bare `events`
folds to the module root. Detection is by the reserved name, as for the other
two, and `isEventsSubmodule()` names the test. The EventBridge *service* module
(`aws_events`, `aws_events_targets`) is not an events submodule.

Inside the owning service section, a type from an events submodule is placed
by **what it is, not what it is called**:

- **Facade → its resource.** A `Facade` from an events submodule attaches to a
  construct through the existing stem rule (`InstanceEvents` → *Instance*) and
  lists under that resource's *Facades* heading. Nothing new is needed: the
  facade classification already names the resource, and the stem match already
  finds it.
- **Everything else → General › Events.** A non-facade type from an events
  submodule — the event pattern classes and their nested detail structs — never
  attaches by name, even when a resource's stem prefixes it
  (`InstanceStateChange` is an event pattern, not an *Instance* type). It lands
  in the section's *General* group under a new **Events** kind heading, after
  *Traits* and before *Others*. When a section has at most one resource and its
  wrapper collapses, *Events* sits at section level beside *Others*, by the
  existing collapse rule.

The discriminator is the `Facade` classification: a facade is the one event
type that names a connected resource; every other event type names an event.

An events submodule emits no overview page — no `…-readme`, no sidebar
*Overview* link, no root *Submodules* entry, no search entry — when it has no
real upstream README, the same four surfaces the mixin rule removes. The
omission is keyed on the reserved `events` name (every type in it is an event
type by construction) rather than on a per-type classification; a real README
keeps the page. Its type pages, URLs and cross-reference links are unchanged;
they index the package root.

## Consequences

- The 64 `<Service>.events` sections and their 64 type-list overview pages are
  gone from navigation and search. Each service now carries its events: EC2
  shows `InstanceEvents` under *Instance › Facades* and
  `EC2InstanceStateChangeNotification`, `EBSVolumeNotification` and their
  detail structs under *General › Events*; DLM shows `DLMPolicyStateChange`
  under a section-level *Events*.
- The rule is automatic: a new events submodule, or a new facade in one, is
  placed the moment it is documented. No per-service list.
- Nested detail structs stay flat inside *Events*, sorted by name under their
  class's dotted prefix; a reader opening the class page reaches them from
  its member tables.
- The real-assembly test pins both cases (`InstanceEvents` facade,
  `DLMPolicyStateChange` general), the absence of `.events` sections and
  `.events-readme` pages, and that nothing links to one.
