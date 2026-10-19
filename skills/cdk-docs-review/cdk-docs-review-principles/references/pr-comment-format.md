# Finding & Comment Format Reference

This is the disclosed detail behind "Keep the review to a tight, high-harm set" in the
`cdk-docs-review-principles` `SKILL.md`. Read it before generating any findings. Produce **structured
findings**, not hand-authored markdown.

## The structured finding contract

Produce each finding as a structured object with these fields:

- `file`: repo-relative path of the file the finding is on.
- `lineRange: { startLine, endLine }`: the line or span on the PR head. A single-line finding sets both.
- `category`: this dimension's finding type (each dimension skill names its values).
- `severity`: one of `BLOCKING` / `RECOMMENDED` / `OPTIONAL`. The only severity vocabulary.
- `ruleId`: the stable `[id]` of the rule that fired (e.g. `GEN-TEST-HOLLOW`, `CONV-ISSUE-REFERENCE`),
  verbatim from the rules lookup. A debug and trace key.
- `message`: the human-visible comment text (see below).
- `reference`: the authoritative source the finding cites: an `AGENTS.md` rule, an ADR section, an upstream
  doc URL; or null.
- `evidence`: what you ran or read to confirm it: the mutation and the test result, the built path listing,
  the measured number and which run produced it.
- `suggestedFix`: a concrete fix, or null.

The review as a whole carries a `summary` with its `text` and `commit` (the reviewed head SHA). The
summary's first line names that commit.

## `message`: write it complete and standalone

The reader sees `message` on its own. Write it as a self-contained review comment:

- **Observation**: what the issue is, referencing the code (1-2 sentences).
- **Impact**: what happens if it is not addressed.
- **Concrete fix**: the change to make, with the rule cited inline where one backs the finding.

Fold the essentials of `evidence`, `reference` and `suggestedFix` into the prose. When the evidence is a
reproduction, state it in one line ("Reverting `layout.ts:L131` leaves this test green."). `ruleId` stays
out of the prose.

## Severity vocabulary

`BLOCKING` / `RECOMMENDED` / `OPTIONAL`, defined in `SKILL.md` "Severity: rate by the harm it does when it
triggers" (authoritative).

## Evidence & References

The authority order and the verify-by-running rule live in `SKILL.md` "Make each finding land"
(authoritative). The format contract this adds: put the citation in `reference`/`evidence` AND name it
inline in `message`. A number (build time, page size, element count) always names the run that produced
it: commit, command, and fixture or full site.

## Filtering: what becomes a finding

Emit a finding only when it is:

1. **Tied to a specific code location** (`file` and `lineRange`).
2. **Actionable**.
3. **Significant enough to stand alone**.

Keep these OUT of the findings (put them in the `summary` if they matter): observations with no line,
positive feedback, clusters of related nits (consolidate into one finding on the first occurrence),
findings an automated check already reports on the PR (CodeQL, axe, Lighthouse) unless you add new
context, PR-body and template issues, and philosophical questions.

### Severity-based filtering

| Severity      | Emit as a finding? | Rule                                                       |
| ------------- | ------------------ | ---------------------------------------------------------- |
| `BLOCKING`    | Always             | Every blocking issue becomes a finding.                    |
| `RECOMMENDED` | Usually            | Emit when tied to specific code; consolidate related ones. |
| `OPTIONAL`    | Sparingly          | Only if it is a quick fix and the total count is low.      |

### Budget rule

Target **3-7 findings** per review. With more than 7 candidates:

1. Keep all `BLOCKING` findings.
2. Keep the highest-impact `RECOMMENDED` findings.
3. Drop `OPTIONAL` findings unless the total is still under 7.

## Posting

Post the findings as one pull request review: inline comments for findings, the `summary` as the review
body. Use the `COMMENT` event. `AGENTS.md` § Code Review: "Do not approve PRs — that is a human
responsibility." A verdict line in the summary (ready to merge, changes needed) is fine; the GitHub
approval is not.

## Tone Rules

The reviewer's-voice rules live in `SKILL.md` "Make each finding land" (authoritative).
