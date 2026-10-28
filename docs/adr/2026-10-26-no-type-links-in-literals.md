# No Type Links Inside Strings or Comments

## Status

Accepted

Supersedes the first accepted tradeoff in the "Link type names inside example
code" section of [markdown rendering](./2026-10-15-markdown-rendering.md): a
type name that appears in both live code and a string or comment of the same
example is no longer linked in the string or comment. The rest of that
section stands, including how docgen picks which names to offer and the
name and href validation in `docs/.vitepress/type-links.ts`.

## Context

Docgen offers a type name for linking only when the name appears in live code
(strings and comments are blanked before its scan). But the linker runs after
highlighting and rewrites every text run, so once a name is offered, every
copy of it is linked, including the construct id in `new s3.Bucket(this,
'Bucket')`. A name inside a string or comment is never a type reference, so the
link is wrong. The approach below was settled with the maintainer before the
work started.

## Decision

- **Decide per token, from the grammar.** The shared highlight hook in
  `docs/.vitepress/config.mts` asks Shiki for each token's scope names
  (`includeExplanation: "scopeName"`). A transformer,
  `codeNolinkTransformer` in `docs/.vitepress/type-links.ts`, adds the class
  `code-nolink` to every token that is in a string or a comment.
- **The innermost scope wins.** Walking a token's scopes from the inside out,
  the first one that says either way decides. `string.*`, `comment.*` and
  their quote or marker punctuation mean text. An embedded expression
  (`meta.embedded`, `meta.template.expression`, `meta.interpolation`,
  `meta.fstring`, a format placeholder) means code. So `${Bucket.name}` in a
  template string, a Python f-string hole and a C# interpolation still link,
  while an escaped quote or a `//` inside a string stays text.
- **Split merged tokens.** Shiki merges neighboring parts with the same
  color into one token. The transformer splits such a token at the scope
  boundary first, so code and text in one merged token are each decided on
  their own.
- **The linker skips marked tokens.** `applyTypeLinks` leaves any text run
  whose token span carries `code-nolink` as it is. Everything else about it is
  unchanged: names must be plain identifiers and hrefs site-relative.
- **The cache key stays `(lang, code)`.** The class is part of the
  highlighted HTML, so a cached fence already carries it.
- **Only where a link could land.** Reporting scope names roughly doubles the
  time to highlight a fence, so the hook asks for it only on a fence that
  offers type links and holds a quote, `#`, `//` or `/*`. A cached entry made
  without marks is redone once if the same code later arrives with type
  links, so the cache key stays `(lang, code)`.
- **Every fence goes through it**, including third-party README fences and
  signature fences. Signature fences have no strings or comments, so they
  link exactly as before.

## Consequences

- Construct ids, other string literals and comments in examples are plain
  text in every language, while constructor calls, enum members, constants
  and signature types still link.
- The build is slower: a measured docs shard (573 pages) went from about 55s
  to about 61s, roughly +12%. The issue set a 10% limit; the maintainer
  accepted the 12% for correct links.
- `test/example-nolink.test.ts` runs the real highlighter for TypeScript,
  Python, Java, C# and Go: a construct id next to a real class, comments,
  an escaped quote, a comment marker inside a string, and an interpolation
  hole, plus a signature fence. `test/e2e/example-type-links.spec.ts` checks
  the built `Queue` page.
- The highlighter requests scopes with no tokenize time limit
  (`tokenizeTimeLimit: 0`). With scopes on, Shiki tokenizes each line twice,
  once for scopes and once for colors, and times each pass on its own. If
  only one pass times out, as a cold highlighter can under a loaded test run
  or build, the two token lists disagree and Shiki throws. The grammars are
  fixed and the input is generated, so the runaway-regex guard buys nothing.
  `test/example-nolink.test.ts` reproduces the race with a mocked clock.
  Requesting scopes still roughly doubles highlight time.
