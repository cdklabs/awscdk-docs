# Agent Skills

The **AWS CDK agent skill** teaches a coding agent how to work in a CDK codebase:
bootstrapping and project setup, construct patterns, compliance and drift,
importing and migrating existing resources, safe refactors, troubleshooting, and
v1-to-v2 migration. It is published by AWS in the agent toolkit under
Apache-2.0, and it is maintained there rather than here.

## Install

```bash
npx skills add https://github.com/aws/agent-toolkit-for-aws --skill aws-cdk
```

## Where it comes from

The skill lives in
[`aws/agent-toolkit-for-aws` → `skills/core-skills/aws-cdk`](https://github.com/aws/agent-toolkit-for-aws/tree/main/skills/core-skills/aws-cdk):
one `SKILL.md` plus a set of reference bundles it pulls in as needed.

The command above is the one-line path. For the other install routes — plugin
install, per-agent skills directories, and MCP runtime discovery — see the
upstream [skills README](https://github.com/aws/agent-toolkit-for-aws/tree/main/skills).

This site links to the skill rather than shipping a copy of it, so what you
install is always what AWS currently publishes.
