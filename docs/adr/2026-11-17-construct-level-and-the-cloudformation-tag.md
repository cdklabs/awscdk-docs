# Construct Level and the CloudFormation Tag

## Status

Accepted

Extends the construct level rules in [API reference pages](./2026-10-15-api-reference-pages.md), which stays Accepted.
Only rule 1 changes: the `cloudformationResource` tag no longer makes an L1 of a type that extends
`aws-cdk-lib.Resource`. The override, L3, L2 and `CfnElement` rules, and their order, stand.

## Context

Rule 1 treated the jsii `cloudformationResource` doc tag as the mark of an L1. That held for generated `CfnXxx`
classes, which are the only types in `aws-cdk-lib` that carry the tag. The alpha packages also put the tag on
hand-written L2 classes to name the resource they wrap. `aws-bedrock-alpha.Agent` is one: it extends `Resource`
through `AgentBase`, carries `AWS::Bedrock::Agent`, and the rule gave it the L1 badge. Rule 1 ran before the L2 rule,
so the correct answer was never reached.

## Decision

- **A type that extends `aws-cdk-lib.Resource` is never an L1 by tag.** The tag still makes an L1 of every type
  outside the `Resource` subtree, so generated `CfnXxx` classes and any type whose base chain does not resolve keep
  L1.
- **The rule is fixed, not the page.** No per-type override was added, so any other alpha L2 that tags its resource
  gets the right level without a new table entry.
- Across the `aws-cdk-lib` and alpha assemblies installed at the time of the change, five types move from L1 to L2:
  `Agent`, `AgentAlias`, `ApplicationInferenceProfile`, `Guardrail` and `Prompt`, all in `aws-bedrock-alpha`.

## Consequences

- The badge, the hover preview, the sidebar chip and the sidebar sort order for those types change from L1 to L2.
- A hand-written type that carries the tag and does not extend `Resource` is still an L1. If one appears that is not,
  it needs its own rule or an override entry, with a reason.
