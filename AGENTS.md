# AGENTS.md

Instructions for AI agents working on this repository.

## Workflow Rules

1. **Work from issues.** Every PR must trace back to an issue. Do not create unsolicited changes.
2. **Create a feature branch.** Use `type/author/short-description` format.
3. **Open a PR.** Reference the issue with `Closes #N`. Keep PRs focused on one issue.
4. **Do not merge.** Only humans approve and merge PRs. Never force-push to main.
5. **Record technical decisions.** If your implementation involves a non-trivial choice (library, architecture, algorithm), write an ADR in `docs/adr/` before or alongside the code change.
6. **Write tests.** All code changes must include tests. No exceptions. Assert on the produced output — rendered pages, built assets, generated files after `npx projen` — rather than on configuration source. A test may assert on configuration shape only when the property it protects has no runtime output to express it (action pinning, secret handling, no-interpolation rules in workflow `run:` blocks); such a test states that reason in one line. Never reference an ADR in an expectation: assert the behavior an ADR describes, not the document's existence, status line, headings or wording. The one exception is a suite whose subject genuinely is the ADR corpus, such as `test/adr-hygiene.test.ts`, which lints the documents themselves.
7. **Browser-test interactive features.** If your change adds or modifies an interactive theme feature — the type-ahead filter, lazy API sidebar, type tooltips, favorites, feedback widget, language switcher, or site search — you must add or extend a `test/e2e/` spec, because Jest unit tests never load the rendered site and cannot catch that regression class. This is scoped to interactive features only: docgen, build, and workflow changes are covered by Jest unit tests, and you must NOT add a hollow e2e spec just to clear the rule. Run with `npx projen docs:e2e`.
8. **Keep comments minimal and concise.** Prefer self-documenting code; only comment when the code alone doesn't explain what or why. When a comment is needed, write a simple sentence explaining what the code does or why — not a history of how it got there. Avoid narrating past decisions, alternatives considered, or issue numbers — that belongs in commit messages or PR descriptions. Keep comments to 120 characters or fewer per line. This applies equally to test files: `describe`/`it` names describe the behavior under test in present tense, never a change history or an issue number.
9. **Never commit screenshots.** Visual before/after evidence is still required for visual changes, but it goes in the PR description or a PR comment via GitHub's attachment upload (drag-and-drop, which produces a `user-attachments` URL) — never as files committed to the repository. `screenshots/` is gitignored.
10. **Never mention issues outside PR bodies.** Issue numbers belong only in the PR description (rule 3's `Closes #N`) and, when truly needed, commit messages. Never cite an issue number in code, comments, tests, or ADRs — issues get renumbered, close, and lose context, so a reference in content decays into a dead pointer. ADRs must be self-contained: state the problem, decision, and consequences entirely in the ADR's own prose, without requiring a reader to open an issue to understand it.

## Code Review

- Respond to review feedback promptly.
- When a human requests changes, implement them and push a new commit.
- You may review other PRs and leave short, constructive comments.
- Do not approve PRs — that is a human responsibility.

## Commit Messages

Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.

## ADR Format

Place ADRs in `docs/adr/YYYY-MM-DD-short-title.md` (date the ADR was authored + a short kebab-case slug). Do **not** use a sequential number: parallel PRs racing for the "next" integer collide at merge time. The date+slug name needs no coordination and still sorts chronologically. With:

```markdown
# Short Title

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
Why this decision is needed.

## Decision
What we decided.

## Consequences
What follows from this decision.
```

## Spelling

Use American spelling in everything this repository authors: UI strings, code identifiers, file names, CSS class names, comments, ADRs, docs pages, and Markdown like this file. So `favorite`, `color`, `behavior`, `center`, `gray`, and `-ize`/`-ization` endings.

Content that comes from the documented packages is out of scope and must render exactly as authored upstream — jsii assembly docstrings, README text pulled from `aws-cdk-lib` and `@aws-cdk/*-alpha`, and the generated API reference built from them. Values already shipped to users are also out of scope, because renaming them breaks data rather than prose: the `cdk-docs:favourites` localStorage key keeps its spelling.

## Constraints

- Do not modify CI/CD configuration without an associated issue.
- Do not add dependencies without recording the rationale in an ADR.
- Do not push directly to `main`.
