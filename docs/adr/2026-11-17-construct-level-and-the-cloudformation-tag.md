# Construct Level and the CloudFormation Tag

## Status

Accepted

Extends the construct level rules in [API reference pages](./2026-10-15-api-reference-pages.md), which stays Accepted
and now states rule 1 as changed here, as do the sidebar ADRs that repeat it. Only rule 1 changes: the
`cloudformationResource` tag makes an L1 only on a class that also extends `aws-cdk-lib.CfnElement`. The override, L3,
L2 and `CfnElement` rules and their order stand, and a tagged `CfnElement` subclass is still L1 ahead of the L3 rule.
One consequence of the order: a tagged `Resource` subtype in a `*patterns*` namespace is now classified L3, where it
was L1 before. No type in the assemblies installed at the time of the change is affected.

## Context

Rule 1 treated the jsii `cloudformationResource` doc tag as the mark of an L1. That held for generated `CfnXxx`
classes, which are the only types in `aws-cdk-lib` that carry the tag. The alpha packages also put the tag on
hand-written constructs to name the resource they wrap. `aws-bedrock-alpha.Agent` is one: it extends `Resource`
through `AgentBase`, carries `AWS::Bedrock::Agent`, and the rule gave it the L1 badge. Rule 1 ran before the L2 rule,
so the correct answer was never reached.

Other code read the tag the same way. The metadata block showed no L1 type row for such a page, marked its source as
generated at build time, and the reverse lookup from a resource type to its L1 could return the hand-written
construct.

## Decision

- **One predicate decides whether the tag means L1.** A tagged class is an L1 when it is `CfnElement` or extends it.
  The level rule, the metadata block, the generated-source marker and the reverse lookup from resource type to L1 all
  use it, so they cannot disagree. A tagged type that is not a class keeps the old behavior.
- **A tagged hand-written construct gets the level its base class gives it.** `Agent`, `AgentAlias`,
  `ApplicationInferenceProfile`, `Guardrail` and `Prompt` extend `Resource` and become L2. Their metadata block now
  shows the L1 type row that other L2 pages show, resolved from the tag.
- **`aws-bedrock-alpha.PromptVersion` is listed by FQN as L2.** It is tagged and hand-written but extends `Construct`
  directly, so no inheritance test reaches it, and without an entry it would show no badge. It joins the other exact
  FQN entries.
- **The rule is fixed, not the page.** In the assemblies installed at `aws-cdk-lib` 2.277.0, six tagged classes were
  outside the `CfnElement` subtree: the five that extend `Resource` and `PromptVersion`. Any later tagged `Resource`
  subclass is right without a table entry. A later tagged construct that does not extend `Resource` needs an entry.

## Consequences

- The badge, the hover preview, the sidebar chip and the sidebar sort order for those six types change from L1 to L2.
- A new tagged construct outside the `CfnElement` subtree that does not extend `Resource` gets no badge until it is
  listed or a rule reaches it. That is a missing badge, not a wrong one.
