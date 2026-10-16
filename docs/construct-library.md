# AWS Construct Library

The AWS Construct Library is the set of classes you use to describe AWS
infrastructure in a CDK app. Every class in the reference on this site comes from
one of its modules, and most of them are *constructs*: objects you instantiate
into an app, which synthesize to CloudFormation.

This page explains how the library is organized, so the reference pages read as a
map rather than a list.

## Construct levels

Almost every question about "which class should I use?" is answered by knowing
which of three levels a class belongs to. The levels are a convention, not a type
hierarchy — nothing in the API is named `L1` — but they are the mental model the
library is designed around.

| Level | Also called | What it is | Naming |
| --- | --- | --- | --- |
| L1 | CFN resources | A direct, generated mapping of one CloudFormation resource type. Exposes exactly the properties CloudFormation does, with no defaults and no validation beyond the schema. | `Cfn` prefix, e.g. `CfnQueue` |
| L2 | Curated constructs | A hand-written construct wrapping one resource with sensible defaults, helper methods, and IAM grants. This is what you normally want. | Plain service noun, e.g. `Queue` |
| L3 | Patterns | A construct composing several resources into a solution — a load-balanced service, a scheduled job. Opinionated by design. | Descriptive, e.g. `ApplicationLoadBalancedFargateService` |

L1 classes are generated from the CloudFormation resource specification, so the
library's L1 coverage is complete by construction: if CloudFormation supports a
resource, there is a `Cfn` class for it. L2 and L3 classes are written by hand, so
their coverage is not complete — a service may have L1 classes and no L2 yet.

That asymmetry is the practical reason to know the levels. When the construct you
expected does not exist, the answer is usually that you are looking for an L2 that
has not been written, and the L1 is right there to use instead.

## From an L1 to an L2

Both levels describe the same queue. Here is the L1:

```ts
new sqs.CfnQueue(this, 'Queue', {
  queueName: 'my-queue',
  visibilityTimeout: 300,
  redrivePolicy: {
    deadLetterTargetArn: dlq.attrArn,
    maxReceiveCount: 5,
  },
});
```

Every value is one you supply, in CloudFormation's own vocabulary: seconds as a
number, the dead-letter queue referenced by ARN, the redrive policy spelled out.

The L2 for the same thing:

```ts
new sqs.Queue(this, 'Queue', {
  visibilityTimeout: Duration.minutes(5),
  deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
});
```

The differences are what an L2 buys you. `Duration.minutes(5)` cannot be
misread as milliseconds. The dead-letter queue is passed as an object rather than
an ARN string, so a typo is a compile error instead of a deployment failure. The
queue name is omitted, because CloudFormation will generate one — and a generated
name is usually the right choice, since a fixed name prevents replacement.

An L2 also carries methods an L1 has none of. `queue.grantSendMessages(handler)`
writes the IAM policy for you, which is the single largest source of hand-written
boilerplate an L2 removes.

Reach for the L1 when the L2 does not exist yet, or when it does not expose a
property you need — `node.defaultChild` gets you the L1 underneath any L2, so
this is not an either/or choice.

- L1: [`CfnQueue`](/v2/docs/aws-cdk-lib.aws_sqs.CfnQueue)
- L2: [`Queue`](/v2/docs/aws-cdk-lib.aws_sqs.Queue)
- L3, composing several resources: [`ApplicationLoadBalancedFargateService`](/v2/docs/aws-cdk-lib.aws_ecs_patterns.ApplicationLoadBalancedFargateService)

## Module names

The library ships as one package, `aws-cdk-lib`, whose submodules follow a naming
convention that tells you what a module is for before you open it.

| Shape | Means | Example |
| --- | --- | --- |
| `aws_`*service* | A service package: the constructs for one AWS service. | `aws_sqs` |
| `aws_`*service*`_targets` | An integration package: adapters letting one service act as a target of another, kept separate to avoid a dependency cycle between the two services. | `aws_events_targets` |
| Bare name | A framework module, not tied to a service — the app, stack and construct machinery itself. | `core`, `assertions` |
| `-alpha` suffix | A module still in developer preview, versioned and released separately from the stable library. Its API is [experimental](/stability). | `@aws-cdk/aws-glue-alpha` |

## What a module contains

A module's reference page groups its types into four categories, and the
distinction matters when you are scanning for something.

- **Constructs** — the classes you instantiate into an app. L2 and L3 both land
  here.
- **Other types** — everything supporting those constructs: enums, prop
  interfaces, helper classes like `Duration`, and the behavioral interfaces
  (`IQueue`) that let a construct accept either a resource it created or one
  imported from elsewhere.
- **CloudFormation resources** — the L1 `Cfn` classes.
- **CloudFormation property types** — the nested prop structures L1 classes take,
  which appear as their own types because CloudFormation defines them that way.

The split is by origin, not by usefulness: "other types" is where most of a
module's vocabulary lives, and a prop interface such as `QueueProps` is usually
the page you actually want when you are trying to configure something.

## Reading a type page

Every generated type page follows the same shape: the signature and construct
level at the top, then the properties table, then methods. The metadata block under
the signature names the CloudFormation resource, the L1 counterpart and the source
file, and marks an [experimental](/stability) type as such. A construct's
constructor takes `(scope, id, props)` — `scope` is the construct that owns it,
almost always `this`, and `id` is a string unique among that scope's children,
which the CDK uses to derive the logical ID CloudFormation sees.

The properties table marks each entry required or optional and gives its type,
linked to that type's own page. Following those links is the fastest way through
an unfamiliar service: start at the construct, open its props interface, and the
enums and helper classes it references are one hop further.
