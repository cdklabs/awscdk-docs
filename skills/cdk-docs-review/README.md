# cdk-docs review skills

Skills for reviewing changes to the AWS CDK API reference site, locally or on a pull request, with any agent.

| Skill                                                                       | Reviews                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`cdk-docs-review-principles`](./cdk-docs-review-principles/SKILL.md)       | The shared base the other four apply: severity, evidence, finding format and repo conventions |
| [`cdk-docs-general-review`](./cdk-docs-general-review/SKILL.md)             | Correctness, tests, durable claims (ADRs, docstrings, PR body) and the hosting contract       |
| [`cdk-docs-a11y-review`](./cdk-docs-a11y-review/SKILL.md)                   | Accessibility and visual integrity across states, widths and themes                           |
| [`cdk-docs-performance-review`](./cdk-docs-performance-review/SKILL.md)     | Build time, page weight, client JS/CSS and search index cost                                  |
| [`cdk-docs-agent-support-review`](./cdk-docs-agent-support-review/SKILL.md) | How well the published site serves AI agents as readers                                       |

The skills follow the repository [`AGENTS.md`](../../AGENTS.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
and the decision records in [`docs/adr/`](../../docs/adr/).

## Install

Install all five together, because the other four apply `cdk-docs-review-principles`.

```sh
npx skills add cdklabs/awscdk-docs --skill '*' -g
```

`-g` installs for your user instead of into the current directory. From a cdk-docs checkout:

```sh
npx skills add ./skills/cdk-docs-review --skill '*' -g
```

The skills ask your agent to verify a finding by running the code (a mutation, a build, a test) before it
reports it. Give the agent a checkout with `npm ci` done so `npx projen test` and `npx projen docs:e2e` run.
