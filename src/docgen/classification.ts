/**
 * Facade and Trait classification.
 *
 * The AWS CDK design guidelines (`aws/aws-cdk` DESIGN_GUIDELINES.md and
 * FACADES_AND_TRAITS_DESIGN_GUIDELINES.md) define two building blocks
 * beyond constructs and mixins:
 *
 * - A **Facade** is a resource-specific standalone class that provides
 *   integrations for a resource with *external consumers* (grants,
 *   metrics, reflections). Its defining structural pattern: a class
 *   named `{Resource}{Feature}` with a static factory `from{Resource}()`
 *   that accepts the resource reference interface (`I{Resource}Ref`)
 *   and returns the facade itself. Examples: `BucketGrants`,
 *   `TableGrants`, `KeyGrants`.
 *
 * - A **Trait** is a service-agnostic contract describing a capability
 *   any resource can have. Per the guidelines a trait consists of a
 *   *trait interface* (e.g. `IResourceWithPolicyV2`) and a *trait
 *   factory* (e.g. `IResourcePolicyFactory`) whose `forResource()`
 *   wraps an L1 `CfnResource` into an object implementing the trait
 *   interface. Both halves classify as Traits.
 *
 * Detection is driven by these structural patterns in the jsii
 * assembly — factory-method shapes and parameter/return types — not by
 * name lists, so new facades and traits classify themselves as the
 * library grows. Ordinary construct interfaces (`IBucket`), props
 * structs and enums never match either rule.
 */

import * as spec from '@jsii/spec';
import { isConstruct, TypeIndex } from './constructs.js';

/**
 * Resource reference interfaces (`I{Resource}Ref`) are the minimal
 * identity contracts facades accept, usable with L1s, L2s and imported
 * resources alike. Returns the `{Resource}` part, or undefined when the
 * type is not a reference interface.
 */
function refResourceName(fqn: string, index: TypeIndex): string | undefined {
  const entry = index.get(fqn);
  if (!entry || !spec.isInterfaceType(entry.type) || entry.type.datatype) {
    return undefined;
  }
  const match = /^I([A-Z]\w*)Ref$/.exec(entry.type.name);
  return match ? match[1] : undefined;
}

/**
 * FQNs of facade classes. A class is a facade when it carries the
 * guidelines' defining structural pattern: a static factory
 * `from{Resource}()` returning the class itself, whose first parameter
 * is a resource reference interface (`I…Ref`) naming that resource,
 * with the class itself named after the resource (`{Resource}{Feature}`,
 * e.g. `BucketGrants` — never the bare resource name, which is the L2
 * construct). Constructs never match: a facade is a standalone class
 * outside the construct hierarchy.
 */
export function buildFacadeIndex(index: TypeIndex): Set<string> {
  const facades = new Set<string>();
  for (const { type } of index.values()) {
    if (!spec.isClassType(type) || isConstruct(type.fqn, index)) {
      continue;
    }
    for (const method of type.methods ?? []) {
      if (!method.static || method.returns?.type === undefined) {
        continue;
      }
      const returns = method.returns.type;
      if (!spec.isNamedTypeReference(returns) || returns.fqn !== type.fqn) {
        continue;
      }
      const factory = /^from([A-Z]\w*)$/.exec(method.name);
      if (!factory) {
        continue;
      }
      const resource = factory[1];
      // `{Resource}{Feature}`: prefixed by the resource, but not the
      // resource name itself (that would be the L2 construct).
      if (!type.name.startsWith(resource) || type.name === resource) {
        continue;
      }
      const first = (method.parameters ?? [])[0]?.type;
      if (first === undefined || !spec.isNamedTypeReference(first)) {
        continue;
      }
      const refResource = refResourceName(first.fqn, index);
      if (refResource === undefined || !refResource.includes(resource)) {
        continue;
      }
      facades.add(type.fqn);
      break;
    }
  }
  return facades;
}

/**
 * FQNs of trait factory interfaces and the trait interfaces they
 * produce. A trait factory is a non-datatype interface with a method
 * that takes a single L1 `CfnResource` and returns a non-datatype
 * interface — the guidelines' "wraps an L1 resource into an object
 * implementing the trait interface". The returned interface is the
 * trait; both classify.
 */
export function buildTraitIndex(index: TypeIndex): Set<string> {
  const traits = new Set<string>();
  for (const { type } of index.values()) {
    if (!spec.isInterfaceType(type) || type.datatype) {
      continue;
    }
    for (const method of type.methods ?? []) {
      const params = method.parameters ?? [];
      if (params.length !== 1 || method.returns?.type === undefined) {
        continue;
      }
      if (!isCfnResource(params[0].type, index) || !spec.isNamedTypeReference(method.returns.type)) {
        continue;
      }
      const produced = index.get(method.returns.type.fqn);
      if (!produced || !spec.isInterfaceType(produced.type) || produced.type.datatype) {
        continue;
      }
      traits.add(type.fqn);
      traits.add(produced.type.fqn);
      break;
    }
  }
  return traits;
}

/**
 * Whether a parameter type is the L1 `CfnResource` base class — the
 * type every generated CloudFormation resource extends, and the input
 * every trait factory wraps. Matched by resolved class name rather
 * than a hard-coded FQN so the rule holds across assemblies.
 */
function isCfnResource(ref: spec.TypeReference, index: TypeIndex): boolean {
  if (!spec.isNamedTypeReference(ref)) {
    return false;
  }
  const entry = index.get(ref.fqn);
  return entry !== undefined && spec.isClassType(entry.type) && entry.type.name === 'CfnResource';
}
